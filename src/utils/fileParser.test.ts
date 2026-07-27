import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const parserMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  extractRawText: vi.fn(),
  workerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: parserMocks.workerOptions,
  getDocument: parserMocks.getDocument,
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: '/assets/pdf.worker.mock.mjs',
}));

vi.mock('mammoth', () => ({
  default: { extractRawText: parserMocks.extractRawText },
  extractRawText: parserMocks.extractRawText,
}));

function fileLike(name: string, type: string, size = 1): File {
  return {
    name,
    type,
    size,
    arrayBuffer: async () => new ArrayBuffer(Math.min(size, 16)),
    text: async () => 'plain text',
  } as File;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function createDocxFile(
  extraEntries: Record<string, string> = {},
  name = 'sample.docx'
): Promise<File> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types><Override PartName="/word/document.xml"/></Types>'
  );
  zip.file('word/document.xml', '<w:document><w:body/></w:document>');
  for (const [path, contents] of Object.entries(extraEntries)) zip.file(path, contents);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new File([buffer], name, { type: DOCX_MIME });
}

function patchZipEntryUncompressedSize(
  source: Uint8Array,
  entryName: string,
  uncompressedSize: number
): Uint8Array {
  const bytes = source.slice();
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (
      bytes[offset] !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x01 ||
      bytes[offset + 3] !== 0x02
    ) {
      continue;
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === entryName) {
      view.setUint32(offset + 24, uncompressedSize, true);
      return bytes;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error(`Could not find ZIP central-directory entry ${entryName}`);
}

async function createDocxWithDeclaredSizes(sizes: Record<string, number>): Promise<File> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', 'types');
  zip.file('word/document.xml', 'document');
  for (const name of Object.keys(sizes)) {
    if (name !== '[Content_Types].xml' && name !== 'word/document.xml') zip.file(name, 'x');
  }
  let bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  for (const [name, size] of Object.entries(sizes)) {
    bytes = patchZipEntryUncompressedSize(bytes, name, size);
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new File([buffer], 'declared-size.docx', { type: DOCX_MIME });
}

beforeEach(() => {
  vi.resetModules();
  parserMocks.getDocument.mockReset();
  parserMocks.extractRawText.mockReset();
  parserMocks.workerOptions.workerSrc = '';
});

describe('parseUploadedFile resource limits', () => {
  it('rejects oversized input before loading a document parser', async () => {
    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    const file = fileLike(
      'oversized.pdf',
      'application/pdf',
      FILE_PARSER_LIMITS.documentBytes + 1
    );

    await expect(parseUploadedFile(file)).rejects.toThrow(/accepts at most/);
    expect(parserMocks.getDocument).not.toHaveBeenCalled();
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
  });

  it('caps PDF pages and skips unsafe canvas allocations', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve() }));
    const getPage = vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({ items: [{ str: `page-${pageNumber}` }] }),
      getViewport: () => ({ width: 10_000, height: 10_000 }),
      render,
    }));
    parserMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 8, getPage }),
    });

    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    const result = await parseUploadedFile(fileLike('sample.pdf', 'application/pdf'));

    expect(getPage).toHaveBeenCalledTimes(FILE_PARSER_LIMITS.pdfPages);
    expect(render).not.toHaveBeenCalled();
    expect(result.type).toBe('pdf');
    expect(result.content).toContain('[Page 1]');
    expect(result.content).toContain('[Page 5]');
    expect(result.content).not.toContain('[Page 6]');
    expect(parserMocks.workerOptions.workerSrc).toBe('/assets/pdf.worker.mock.mjs');
  });

  it('caps extracted DOCX text while preserving an explicit marker', async () => {
    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    parserMocks.extractRawText.mockResolvedValue({
      value: 'x'.repeat(FILE_PARSER_LIMITS.extractedTextCharacters + 100),
    });

    const result = await parseUploadedFile(await createDocxFile());

    expect(parserMocks.extractRawText).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('docx');
    expect(result.content).toHaveLength(FILE_PARSER_LIMITS.extractedTextCharacters);
    expect(result.content).toMatch(/\[extracted text truncated\]$/);
  });

  it('rejects a DOCX entry whose central-directory size exceeds the inflate ceiling', async () => {
    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    const file = await createDocxWithDeclaredSizes({
      'word/document.xml': FILE_PARSER_LIMITS.docxEntryUncompressedBytes + 1,
    });

    await expect(parseUploadedFile(file)).rejects.toThrow(/per-entry limit/);
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
  });

  it('rejects a DOCX whose declared total expansion exceeds the archive ceiling', async () => {
    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    const partSize = Math.floor(FILE_PARSER_LIMITS.docxTotalUncompressedBytes / 3) + 1;
    const file = await createDocxWithDeclaredSizes({
      'word/document.xml': partSize,
      'word/one.xml': partSize,
      'word/two.xml': partSize,
    });

    await expect(parseUploadedFile(file)).rejects.toThrow(/total uncompressed-size limit/);
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
  });

  it('streams DOCX bodies and rejects actual expansion that exceeds forged metadata', async () => {
    const { validateDocxArchive } = await import('./fileParser');
    const largeContents = 'A'.repeat(256 * 1024);
    const file = await createDocxFile({ 'word/large.xml': largeContents });
    const original = new Uint8Array(await file.arrayBuffer());
    const forged = patchZipEntryUncompressedSize(original, 'word/large.xml', 1);
    const buffer = forged.buffer.slice(
      forged.byteOffset,
      forged.byteOffset + forged.byteLength
    ) as ArrayBuffer;

    await expect(
      validateDocxArchive(buffer, {
        docxEntryUncompressedBytes: 64 * 1024,
        docxTotalUncompressedBytes: 512 * 1024,
      })
    ).rejects.toThrow(/actually expands beyond the per-entry limit/);
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
  });

  it('rejects excessive DOCX entry counts and unsafe archive paths before Mammoth', async () => {
    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    const manyEntries: Record<string, string> = {};
    for (let index = 0; index < FILE_PARSER_LIMITS.docxEntries; index++) {
      manyEntries[`word/parts/${index}.xml`] = '';
    }
    await expect(parseUploadedFile(await createDocxFile(manyEntries))).rejects.toThrow(
      /at most \d+ are allowed/
    );

    await expect(
      parseUploadedFile(await createDocxFile({ '../outside.xml': 'unsafe' }))
    ).rejects.toThrow(/unsafe entry path/);
    expect(parserMocks.extractRawText).not.toHaveBeenCalled();
  });

  it('rejects oversized or uninspectable raster headers before browser image decode', async () => {
    const { FILE_PARSER_LIMITS, parseUploadedFile } = await import('./fileParser');
    const pngHeader = new Uint8Array(24);
    pngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    pngHeader.set([0x49, 0x48, 0x44, 0x52], 12);
    const headerView = new DataView(pngHeader.buffer);
    headerView.setUint32(16, FILE_PARSER_LIMITS.imageDimension, false);
    headerView.setUint32(20, FILE_PARSER_LIMITS.imageDimension, false);

    await expect(
      parseUploadedFile(new File([pngHeader], 'huge.png', { type: 'image/png' }))
    ).rejects.toThrow(/unsafe image dimensions/);
    await expect(
      parseUploadedFile(new File([new Uint8Array([1, 2, 3])], 'unknown.png', { type: 'image/png' }))
    ).rejects.toThrow(/unsupported or malformed/);
  });
});
