const IMAGE_REQUEST_RE = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|illustrate|design|give(?:\s+me)?|show(?:\s+me)?|get)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|art|illustration|visual)(?:\s+(?:of|for|showing))?\s*(.+)$/i;
const IMAGE_WANT_RE = /^(?:please\s+)?(?:i\s+want|i\s+need|i(?:'d|\s+would)\s+like)\s+(?:an?\s+)?(?:image|picture|photo|art|illustration|visual)(?:\s+(?:of|for|showing))?\s*(.+)$/i;

export function detectImageRequest(text: string): { shouldGenerate: boolean; prompt: string } {
  const input = text.trim();
  const match = input.match(IMAGE_REQUEST_RE) || input.match(IMAGE_WANT_RE);
  if (!match || !match[1].trim()) return { shouldGenerate: false, prompt: input };
  return { shouldGenerate: true, prompt: match[1].trim() };
}

export function isIdentityRequest(text: string): boolean {
  return /\b(?:who are you|what are you|who made you|who created you|who built you|are you sour(?:\.ai)?|what is sour(?:\.ai)?)\b/i.test(text);
}
