const THINK_BLOCK_RE = /<think>([\s\S]*?)<\/think>/gi;

export function splitThinkingAndText(rawText: string): { text: string; thinking: string } {
  const input = (rawText || '').trim();
  if (!input) {
    return { text: '', thinking: '' };
  }

  const matches = [...input.matchAll(THINK_BLOCK_RE)];
  if (matches.length === 0) {
    return { text: input, thinking: '' };
  }

  const thinking = matches.map(m => m[1].trim()).filter(Boolean).join('\n\n');
  const text = input.replace(THINK_BLOCK_RE, '').trim();
  return { text, thinking };
}

export function buildImageResponseText(imageCount: number): string {
  if (imageCount <= 0) return '';
  return imageCount === 1 ? 'Generated image.' : `Generated ${imageCount} images.`;
}