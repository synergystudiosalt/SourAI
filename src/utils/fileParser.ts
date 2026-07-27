import { AttachmentItem } from '../types';

/**
 * Document parsers are loaded on first use, not at startup.
 *
 * `pdfjs-dist` and `mammoth` together are a large share of the entry chunk, and
 * most sessions never attach a document. Deferring the import keeps them out of
 * the initial payload measured by `scripts/check-bundle-budget.mjs`.
 *
 * The pdf.js worker is served from our own origin. It used to be fetched from
 * a public CDN, which meant a third party could execute script inside the
 * application origin — the one thing that defeats every other credential
 * protection (see docs/adr/0005-credential-handling.md). Vite emits the worker
 * as a same-origin asset, so no external host is contacted and a strict
 * `script-src 'self'` CSP holds.
 */

type PdfjsModule = typeof import('pdfjs-dist');
type MammothModule = typeof import('mammoth');

let pdfjsPromise: Promise<PdfjsModule> | null = null;
let mammothPromise: Promise<MammothModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjsLib, workerUrl] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((module) => module.default),
      ]);
      if (pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })().catch((err) => {
      // Allow a later attachment to retry rather than caching the failure.
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

async function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    mammothPromise = (async () => {
      const module = await import('mammoth');
      // `mammoth` is CommonJS, so interop may hand back either the namespace
      // itself or a `default` wrapper depending on the bundler.
      const interop = module as unknown as { default?: MammothModule };
      return interop.default ?? (module as MammothModule);
    })().catch((err) => {
      mammothPromise = null;
      throw err;
    });
  }
  return mammothPromise;
}

/**
 * Helper to compress and downscale base64 image DataURLs to prevent excessive payload sizes.
 * Scales down images to max 1200px width/height and encodes as optimized JPEG.
 */
async function compressImage(dataUrl: string, maxDim = 1200, quality = 0.82): Promise<string> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && dataUrl.length < 500000) {
        // Already reasonably small
        resolve(dataUrl);
        return;
      }
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Parses uploaded files (images, PDFs, DOCX, text/code) into structured AttachmentItems with
 * optimized base64 DataURLs for multimodal vision models and extracted text for document context.
 */
export async function parseUploadedFile(file: File): Promise<AttachmentItem> {
  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const fileName = file.name;
  const fileSize = file.size;

  // 1. Image Files
  if (file.type.startsWith('image/')) {
    const rawDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });

    const dataUrl = await compressImage(rawDataUrl, 1200, 0.82);

    return {
      id: fileId,
      name: fileName,
      type: 'image',
      dataUrl,
      size: fileSize,
      type_schema: {
        type: 'image_url',
        image_url: {
          url: dataUrl,
        },
      },
    };
  }

  // 2. PDF Files
  if (file.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
    try {
      const pdfjsLib = await loadPdfjs();
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      let fullExtractedText = '';
      const pageImages: string[] = [];

      const maxPages = Math.min(pdf.numPages, 5);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        // Extract text content from PDF page
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ');

        if (pageText.trim()) {
          fullExtractedText += `[Page ${pageNum}]\n${pageText.trim()}\n\n`;
        }

        // Render PDF page to HTML5 Canvas for visual multimodal payload
        try {
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            context.fillStyle = '#FFFFFF';
            context.fillRect(0, 0, viewport.width, viewport.height);
            await page.render({ canvasContext: context, viewport, canvas } as any).promise;
            const rawPageDataUrl = canvas.toDataURL('image/jpeg', 0.75);
            const optimizedPageDataUrl = await compressImage(rawPageDataUrl, 1000, 0.75);
            pageImages.push(optimizedPageDataUrl);
          }
        } catch (canvasErr) {
          console.warn(`Could not render PDF page ${pageNum} to canvas:`, canvasErr);
        }
      }

      const mainDataUrl = pageImages.length > 0 ? pageImages[0] : undefined;

      return {
        id: fileId,
        name: fileName,
        type: 'pdf',
        dataUrl: mainDataUrl,
        content: fullExtractedText.trim() || `[PDF Document: ${fileName} (${pdf.numPages} pages)]`,
        size: fileSize,
        pageImages,
        type_schema: mainDataUrl
          ? {
              type: 'image_url',
              image_url: {
                url: mainDataUrl,
              },
            }
          : undefined,
      };
    } catch (pdfErr) {
      console.error('Error parsing PDF file:', pdfErr);
      return {
        id: fileId,
        name: fileName,
        type: 'file',
        content: `[Attached PDF File: ${fileName}]`,
        size: fileSize,
      };
    }
  }

  // 3. DOCX / Word Documents
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileName.toLowerCase().endsWith('.docx') ||
    fileName.toLowerCase().endsWith('.doc')
  ) {
    try {
      const mammoth = await loadMammoth();
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const extractedText = result.value || '';

      return {
        id: fileId,
        name: fileName,
        type: 'docx',
        content: extractedText.trim() || `[Word Document: ${fileName}]`,
        size: fileSize,
      };
    } catch (docxErr) {
      console.error('Error parsing DOCX file:', docxErr);
      return {
        id: fileId,
        name: fileName,
        type: 'file',
        content: `[Word Document: ${fileName}]`,
        size: fileSize,
      };
    }
  }

  // 4. Plain Text, Markdown, Code, CSV, JSON, HTML, etc.
  try {
    const textContent = await file.text();
    const isCode = /\.(js|ts|tsx|jsx|json|py|html|htm|css|scss|less|cpp|c|cs|java|go|rs|rb|php|sql|sh|yaml|yml|xml|svg|md|txt|csv|tsv|env|toml|ini|log|vue|svelte|graphql|gql)$/i.test(fileName);
    return {
      id: fileId,
      name: fileName,
      type: isCode ? 'code' : 'file',
      content: textContent,
      size: fileSize,
    };
  } catch (textErr) {
    console.error('Error reading text file:', textErr);
    return {
      id: fileId,
      name: fileName,
      type: 'file',
      content: `[Attached File: ${fileName}]`,
      size: fileSize,
    };
  }
}
