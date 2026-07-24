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
 * Model selection rules:
 * - flux-realism: for photorealism, portraits, landscapes, natural lighting
 * - flux-anime: for anime, manga, illustrations, comics
 * - flux-3d: for 3D renders, CGI, game assets, Pixar style
 * - turbo: for quick drafts, previews, fast generation
 * - kontext: for style transfer, character consistency
 * - flux: default for general requests (high precision, text rendering, logos)
 */
export function analyzePromptForModel(prompt: string): 'flux' | 'flux-realism' | 'flux-anime' | 'flux-3d' | 'turbo' | 'kontext' {
  const promptLower = prompt.toLowerCase();
  
  // flux-realism patterns
  if (/\b(photo|realistic|photograph|portrait|macro|landscape|natural lighting|real|authentic|genuine|candid|person|people|human|face|body)\b/i.test(promptLower)) {
    return 'flux-realism';
  }
  
  // flux-anime patterns
  if (/\b(anime|manga|drawn|illustration|comic|chibi|cartoon|manga style|anime style|character design)\b/i.test(promptLower)) {
    return 'flux-anime';
  }
  
  // flux-3d patterns
  if (/\b(3d|render|cgi|pixar style|claymation|isometric|game asset|3d model|voxel|blender|maya|c4d)\b/i.test(promptLower)) {
    return 'flux-3d';
  }
  
  // turbo patterns
  if (/\b(quick|fast|draft|preview|low-res|thumbnail|minimal|simple)\b/i.test(promptLower)) {
    return 'turbo';
  }
  
  // kontext patterns
  if (/\b(style transfer|character consistency|thematic|stylized|art style|consistent)\b/i.test(promptLower)) {
    return 'kontext';
  }
  
  // Default: flux for general requests (best for complex spatial descriptions, text, logos)
  return 'flux';
}
