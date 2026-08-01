import { AttachmentItem } from '../types';

export const FILE_PARSER_LIMITS = Object.freeze({
  imageBytes: 10 * 1024 * 1024,
  imageHeaderBytes: 256 * 1024,
  imagePixels: 25_000_000,
  imageDimension: 16_384,
  imageOperationTimeoutMs: 10_000,
  documentBytes: 25 * 1024 * 1024,
  docxEntries: 2_048,
  docxPathLength: 1_024,
  docxPathDepth: 64,
  docxEntryUncompressedBytes: 32 * 1024 * 1024,
  docxTotalUncompressedBytes: 64 * 1024 * 1024,
  textBytes: 5 * 1024 * 1024,
  extractedTextCharacters: 500_000,
  pdfPages: 5,
  pdfPagePixels: 4_000_000,
});

const EXTRACTION_TRUNCATED = '\n[extracted text truncated]';

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isWordDocument(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    isDocx(file) ||
    name.endsWith('.doc')
  );
}

function isDocx(file: File): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx')
  );
}

function assertWithinByteLimit(file: File): void {
  const limit = file.type.startsWith('image/')
    ? FILE_PARSER_LIMITS.imageBytes
    : isPdf(file) || isWordDocument(file)
      ? FILE_PARSER_LIMITS.documentBytes
      : FILE_PARSER_LIMITS.textBytes;
  if (file.size > limit) {
    throw new RangeError(
      `${file.name} is ${file.size} bytes; this browser parser accepts at most ${limit} bytes for that file type.`
    );
  }
}

function limitExtractedText(value: string): string {
  const limit = FILE_PARSER_LIMITS.extractedTextCharacters;
  if (value.length <= limit) return value;
  return value.slice(0, limit - EXTRACTION_TRUNCATED.length) + EXTRACTION_TRUNCATED;
}

type RasterFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

interface RasterDimensions {
  format: RasterFormat;
  width: number;
  height: number;
}

const RASTER_MIME_TYPES: Record<RasterFormat, ReadonlySet<string>> = {
  png: new Set(['image/png']),
  jpeg: new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']),
  gif: new Set(['image/gif']),
  webp: new Set(['image/webp']),
  bmp: new Set(['image/bmp', 'image/x-bmp', 'image/x-ms-bmp']),
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32Be(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function uint32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function int32Le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function inspectPng(bytes: Uint8Array): RasterDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  return { format: 'png', width: uint32Be(bytes, 16), height: uint32Be(bytes, 20) };
}

function inspectGif(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 10 || !['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return null;
  return { format: 'gif', width: uint16Le(bytes, 6), height: uint16Le(bytes, 8) };
}

const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function inspectJpeg(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = uint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (JPEG_START_OF_FRAME.has(marker) && segmentLength >= 7) {
      return {
        format: 'jpeg',
        width: uint16Be(bytes, offset + 5),
        height: uint16Be(bytes, offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function inspectWebp(bytes: Uint8Array): RasterDimensions | null {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  ) {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    return {
      format: 'webp',
      width: uint24Le(bytes, 24) + 1,
      height: uint24Le(bytes, 27) + 1,
    };
  }
  if (
    chunk === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      format: 'webp',
      width: uint16Le(bytes, 26) & 0x3fff,
      height: uint16Le(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      format: 'webp',
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  return null;
}

function inspectBmp(bytes: Uint8Array): RasterDimensions | null {
  if (bytes.length < 26 || ascii(bytes, 0, 2) !== 'BM') return null;
  const dibSize = uint32Le(bytes, 14);
  if (dibSize === 12) {
    return { format: 'bmp', width: uint16Le(bytes, 18), height: uint16Le(bytes, 20) };
  }
  if (dibSize >= 40) {
    return {
      format: 'bmp',
      width: Math.abs(int32Le(bytes, 18)),
      height: Math.abs(int32Le(bytes, 22)),
    };
  }
  return null;
}

function inspectRasterHeader(bytes: Uint8Array): RasterDimensions | null {
  return (
    inspectPng(bytes) ??
    inspectJpeg(bytes) ??
    inspectGif(bytes) ??
    inspectWebp(bytes) ??
    inspectBmp(bytes)
  );
}

function assertSafeRasterDimensions(
  fileName: string,
  dimensions: Pick<RasterDimensions, 'width' | 'height'>
): void {
  const { width, height } = dimensions;
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > FILE_PARSER_LIMITS.imageDimension ||
    height > FILE_PARSER_LIMITS.imageDimension ||
    !Number.isSafeInteger(pixels) ||
    pixels > FILE_PARSER_LIMITS.imagePixels
  ) {
    throw new RangeError(
      `${fileName} declares unsafe image dimensions (${width} x ${height}); ` +
        `the browser parser accepts at most ${FILE_PARSER_LIMITS.imagePixels} decoded pixels.`
    );
  }
}

async function inspectRasterFile(file: File): Promise<RasterDimensions> {
  const prefix = new Uint8Array(
    await file.slice(0, FILE_PARSER_LIMITS.imageHeaderBytes).arrayBuffer()
  );
  const dimensions = inspectRasterHeader(prefix);
  if (!dimensions) {
    throw new TypeError(
      `${file.name} claims to be an image, but its raster header is unsupported or malformed.`
    );
  }

  const claimedMime = file.type.toLowerCase().split(';', 1)[0].trim();
  if (!RASTER_MIME_TYPES[dimensions.format].has(claimedMime)) {
    throw new TypeError(
      `${file.name} claims MIME type ${JSON.stringify(file.type)}, but contains ${dimensions.format} data.`
    );
  }
  assertSafeRasterDimensions(file.name, dimensions);
  return dimensions;
}

function assertSafeArchivePath(
  path: string,
  limits: Pick<typeof FILE_PARSER_LIMITS, 'docxPathLength' | 'docxPathDepth'> =
    FILE_PARSER_LIMITS
): void {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
  const parts = normalized.split('/');
  if (
    normalized === '' ||
    normalized.length > limits.docxPathLength ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('//') ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.length > limits.docxPathDepth ||
    parts.some((part) => part === '' || part === '.' || part === '..' || part.length > 255)
  ) {
    throw new RangeError(`DOCX archive contains an unsafe entry path: ${JSON.stringify(path)}.`);
  }
}

interface ZipEntryMetadata {
  name: string;
  dir: boolean;
  unsafeOriginalName?: string;
  _data?: {
    compressedSize?: number;
    uncompressedSize?: number;
  };
  internalStream(type: 'uint8array'): {
    on(event: 'data', callback: (chunk: Uint8Array) => void): unknown;
    on(event: 'end', callback: () => void): unknown;
    on(event: 'error', callback: (error: Error) => void): unknown;
    pause(): unknown;
    resume(): unknown;
  };
}

type DocxArchiveLimits = Pick<
  typeof FILE_PARSER_LIMITS,
  | 'docxEntries'
  | 'docxPathLength'
  | 'docxPathDepth'
  | 'docxEntryUncompressedBytes'
  | 'docxTotalUncompressedBytes'
>;

function measureInflatedEntry(
  entry: ZipEntryMetadata,
  totalBeforeEntry: number,
  limits: DocxArchiveLimits
): Promise<number> {
  return new Promise((resolve, reject) => {
    let entryBytes = 0;
    let settled = false;
    const stream = entry.internalStream('uint8array');

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };

    stream.on('data', (chunk) => {
      if (settled) return;
      entryBytes += chunk.byteLength;
      if (entryBytes > limits.docxEntryUncompressedBytes) {
        fail(
          new RangeError(
            `DOCX archive entry ${JSON.stringify(entry.name)} actually expands beyond the per-entry limit.`
          )
        );
      } else if (totalBeforeEntry + entryBytes > limits.docxTotalUncompressedBytes) {
        fail(new RangeError('DOCX archive actually expands beyond the total uncompressed-size limit.'));
      }
    });
    stream.on('error', (error) => {
      fail(
        error instanceof RangeError
          ? error
          : new TypeError(
              `DOCX archive entry ${JSON.stringify(entry.name)} could not be safely inflated.`
            )
      );
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(entryBytes);
    });
    stream.resume();
  });
}

export async function validateDocxArchive(
  arrayBuffer: ArrayBuffer,
  limitOverrides: Partial<DocxArchiveLimits> = {}
): Promise<void> {
  const limits: DocxArchiveLimits = { ...FILE_PARSER_LIMITS, ...limitOverrides };
  const jszipModule = await import('jszip');
  const JSZip = jszipModule.default;
  let archive: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    // loadAsync reads central-directory metadata, but does not inflate file
    // bodies. A Promise timeout would not preempt JSZip's synchronous parsing,
    // so the compressed-byte ceiling remains the meaningful bound here.
    archive = await JSZip.loadAsync(arrayBuffer, { createFolders: false });
  } catch {
    throw new TypeError('The selected DOCX is not a readable ZIP archive.');
  }

  const entries = Object.values(archive.files) as unknown as ZipEntryMetadata[];
  if (entries.length > limits.docxEntries) {
    throw new RangeError(
      `DOCX archive has ${entries.length} entries; at most ${limits.docxEntries} are allowed.`
    );
  }

  let declaredTotalUncompressedBytes = 0;
  for (const entry of entries) {
    assertSafeArchivePath(entry.unsafeOriginalName ?? entry.name, limits);
    if (entry.dir) continue;
    const uncompressedBytes = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(uncompressedBytes) || (uncompressedBytes ?? -1) < 0) {
      throw new RangeError(`DOCX archive entry ${JSON.stringify(entry.name)} has invalid size metadata.`);
    }
    if (uncompressedBytes! > limits.docxEntryUncompressedBytes) {
      throw new RangeError(
        `DOCX archive entry ${JSON.stringify(entry.name)} expands beyond the per-entry limit.`
      );
    }
    declaredTotalUncompressedBytes += uncompressedBytes!;
    if (declaredTotalUncompressedBytes > limits.docxTotalUncompressedBytes) {
      throw new RangeError('DOCX archive expands beyond the total uncompressed-size limit.');
    }
  }

  if (!archive.file('[Content_Types].xml') || !archive.file('word/document.xml')) {
    throw new TypeError('The selected ZIP does not contain the required DOCX document parts.');
  }

  // Central-directory sizes are attacker-controlled. Inflate every body as a
  // stream and count emitted bytes so forged metadata cannot make Mammoth
  // allocate an unbounded result. Processing sequentially also bounds the
  // amount of decompressed data JSZip has live at one time.
  let actualTotalUncompressedBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    actualTotalUncompressedBytes += await measureInflatedEntry(
      entry,
      actualTotalUncompressedBytes,
      limits
    );
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => {
      reader.abort();
      reject(new DOMException(`Reading ${file.name} timed out.`, 'TimeoutError'));
    }, FILE_PARSER_LIMITS.imageOperationTimeoutMs);
    reader.onload = (event) => {
      clearTimeout(timer);
      resolve((event.target?.result as string) || '');
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    };
    reader.onabort = () => {
      clearTimeout(timer);
      reject(new DOMException(`Reading ${file.name} was aborted.`, 'AbortError'));
    };
    reader.readAsDataURL(file);
  });
}

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

/**
 * Exported so other readers share this loader rather than wiring the worker
 * again. The worker URL is the security-sensitive part — it must stay
 * same-origin — and one caller getting it wrong would defeat the CSP.
 */
export async function loadPdfjs(): Promise<PdfjsModule> {
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
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      reject(new DOMException('Image decoding timed out.', 'TimeoutError'));
    }, FILE_PARSER_LIMITS.imageOperationTimeoutMs);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        assertSafeRasterDimensions('Decoded image', { width, height });
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
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new TypeError('The selected image could not be decoded safely.'));
    };
    img.src = dataUrl;
  });
}

/**
 * Parses uploaded files (images, PDFs, DOCX, text/code) into structured AttachmentItems with
 * optimized base64 DataURLs for multimodal vision models and extracted text for document context.
 */
export async function parseUploadedFile(file: File): Promise<AttachmentItem> {
  assertWithinByteLimit(file);
  const fileId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const fileName = file.name;
  const fileSize = file.size;

  // 1. Image Files
  if (file.type.startsWith('image/')) {
    await inspectRasterFile(file);
    const rawDataUrl = await readFileAsDataUrl(file);
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
  if (isPdf(file)) {
    try {
      const pdfjsLib = await loadPdfjs();
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      let fullExtractedText = '';
      const pageImages: string[] = [];

      const maxPages = Math.min(pdf.numPages, FILE_PARSER_LIMITS.pdfPages);

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const page = await pdf.getPage(pageNum);

        // Extract text content from PDF page
        const textContent = await page.getTextContent();
        const remainingCharacters =
          FILE_PARSER_LIMITS.extractedTextCharacters - fullExtractedText.length;
        let pageText = '';
        if (remainingCharacters > 0) {
          for (const item of textContent.items) {
            if (!item || typeof item !== 'object' || !('str' in item)) continue;
            const text = String((item as { str: unknown }).str);
            const separator = pageText ? ' ' : '';
            const available = remainingCharacters - pageText.length - separator.length;
            if (available <= 0) break;
            pageText += separator + text.slice(0, available);
          }
        }

        if (pageText.trim()) {
          fullExtractedText += `[Page ${pageNum}]\n${pageText.trim()}\n\n`;
        }

        // Render PDF page to HTML5 Canvas for visual multimodal payload
        try {
          const viewport = page.getViewport({ scale: 1.0 });
          const pixels = viewport.width * viewport.height;
          if (!Number.isFinite(pixels) || pixels <= 0 || pixels > FILE_PARSER_LIMITS.pdfPagePixels) {
            continue;
          }
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
        content:
          limitExtractedText(fullExtractedText.trim()) ||
          `[PDF Document: ${fileName} (${pdf.numPages} pages)]`,
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
  if (isWordDocument(file)) {
    const arrayBuffer = await file.arrayBuffer();
    if (isDocx(file)) await validateDocxArchive(arrayBuffer);
    try {
      const mammoth = await loadMammoth();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const extractedText = result.value || '';

      return {
        id: fileId,
        name: fileName,
        type: 'docx',
        content: limitExtractedText(extractedText.trim()) || `[Word Document: ${fileName}]`,
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
