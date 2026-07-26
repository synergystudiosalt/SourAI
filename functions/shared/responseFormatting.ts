const THINK_TAG_NAMES = ['think', 'thinking', 'reasoning', 'analysis', 'reflection', 'planning', 'step'];
const THINK_BLOCK_RE = new RegExp(`<(${THINK_TAG_NAMES.join('|')})>([\\s\\S]*?)<\\/\\1>`, 'gi');

export function splitThinkingAndText(rawText: string): { text: string; thinking: string } {
  const input = (rawText || '').trim();
  if (!input) {
    return { text: '', thinking: '' };
  }

  const matches = [...input.matchAll(THINK_BLOCK_RE)];
  if (matches.length === 0) {
    return { text: input, thinking: '' };
  }

  const thinking = matches.map(m => m[2].trim()).filter(Boolean).join('\n\n');
  // Preserve think tags in display text so they render in the UI
  const text = input.trim();
  return { text, thinking };
}

export function buildImageResponseText(imageCount: number): string {
  if (imageCount <= 0) return '';
  return imageCount === 1 ? 'Generated image.' : `Generated ${imageCount} images.`;
}