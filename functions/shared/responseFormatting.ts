const THINK_TAG_NAMES = ['think', 'thinking', 'reasoning', 'analysis', 'reflection', 'planning', 'step'];
const THINK_BLOCK_RE = new RegExp(
  `<(${THINK_TAG_NAMES.join('|')})>([\\s\\S]*?)(?:<\\/[a-zA-Z][\\w-]*>|$)`,
  'gi'
);

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
  // Thinking has its own UI surface; do not duplicate it in the final answer.
  const text = input.replace(THINK_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, thinking };
}

export function buildImageResponseText(imageCount: number): string {
  if (imageCount <= 0) return '';
  return imageCount === 1 ? 'Generated image.' : `Generated ${imageCount} images.`;
}
