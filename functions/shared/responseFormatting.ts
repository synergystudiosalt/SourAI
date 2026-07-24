const THINK_BLOCK_RE = /<think>([\s\S]*?)<\/think>/i;

export function splitThinkingAndText(rawText: string): { text: string; thinking: string } {
  const input = (rawText || '').trim();
  if (!input) {
    return { text: '', thinking: '' };
  }

  const match = input.match(THINK_BLOCK_RE);
  if (!match) {
    return { text: input, thinking: '' };
  }

  const thinking = (match[1] || '').trim();
  const text = input.replace(THINK_BLOCK_RE, '').trim();
  return { text, thinking };
}

export function buildImageResponseText(imageCount: number): string {
  if (imageCount <= 0) return '';
  return imageCount === 1 ? 'Generated image.' : `Generated ${imageCount} images.`;
}
