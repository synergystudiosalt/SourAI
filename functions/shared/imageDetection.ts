const IMAGE_REQUEST_RE = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:generate|create|make|draw|paint|illustrate|design|give(?:\s+me)?|show(?:\s+me)?|get|render)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|photo|art|illustration|visual)(?:\s+(?:of|for|showing))?\s*(.+)$/i;
const IMAGE_WANT_RE = /^(?:please\s+)?(?:i\s+want|i\s+need|i(?:'d|\s+would)\s+like)\s+(?:an?\s+)?(?:image|picture|photo|art|illustration|visual)(?:\s+(?:of|for|showing))?\s*(.+)$/i;

/**
 * Enhanced image request detection
 * Supports Pollinations AI model routing based on prompt analysis
 */
export function detectImageRequest(text: string): { shouldGenerate: boolean; prompt: string } {
  const input = text.trim();
  const match = input.match(IMAGE_REQUEST_RE) || input.match(IMAGE_WANT_RE);
  if (!match || !match[1].trim()) return { shouldGenerate: false, prompt: input };
  return { shouldGenerate: true, prompt: match[1].trim() };
}

/**
 * Identity request detection
 * Checks if user is asking about sour.ai
 */
export function isIdentityRequest(text: string): boolean {
  return /\b(?:who are you|what are you|who made you|who created you|who built you|are you sour(?:\.ai)?|what is sour(?:\.ai)?)\b/i.test(text);
}

/**
 * Analyze prompt and suggest optimal Pollinations model
 * 
 * Model selection rules (verified against Pollinations API):
 * - flux: default for general requests, photos, anime, 3D, high quality
 * - turbo: for quick drafts, previews, fast generation
 * - kontext: for style transfer, character consistency
 */
export function analyzePromptForModel(prompt: string): 'flux' | 'turbo' | 'kontext' {
  const promptLower = prompt.toLowerCase();
  
  // turbo patterns
  if (/\b(quick|fast|draft|preview|low-res|thumbnail|minimal|simple)\b/i.test(promptLower)) {
    return 'turbo';
  }
  
  // kontext patterns
  if (/\b(style transfer|character consistency|thematic|stylized|art style|consistent)\b/i.test(promptLower)) {
    return 'kontext';
  }
  
  // Default: flux for all requests (best general-purpose model)
  return 'flux';
}
