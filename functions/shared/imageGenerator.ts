import { buildImageResponseText } from './responseFormatting';

/**
 * Image generation helper for AI responses with Pollinations AI
 * Converts text descriptions to images using the free legacy endpoint
 * 
 * Uses the free endpoint: https://image.pollinations.ai/prompt/{prompt}
 * No API key required - anonymous free usage
 */

export interface ImageGenerationOptions {
  model?: 'flux' | 'turbo' | 'kontext';
  seed?: number;
  width?: number;
  height?: number;
  enhance?: boolean;
  safe?: boolean;
}

/**
 * Determine the optimal Pollinations model based on prompt keywords
 * Routing Table (all models verified against Pollinations API):
 * - flux: General purpose, complex prompts, text/logos, high quality (default)
 * - turbo: Low-latency previews/drafts
 * - kontext: Style transfer, thematic renders
 */
export function selectOptimalModel(prompt: string): ImageGenerationOptions['model'] {
  const promptLower = prompt.toLowerCase();
  
  // turbo: Low-latency previews/drafts
  if (/\b(quick|fast|draft|preview|low-res|thumbnail)\b/i.test(promptLower)) {
    return 'turbo';
  }
  
  // kontext: Style transfer, thematic renders
  if (/\b(style transfer|thematic|stylized|consistency)\b/i.test(promptLower)) {
    return 'kontext';
  }
  
  // Default: flux for all other requests (high quality, best general model)
  return 'flux';
}

/**
 * Build complete Pollinations image generation URL with parameters
 * Uses the free legacy endpoint: https://image.pollinations.ai/prompt/{PROMPT}
 * No API key required for anonymous usage
 */
export function buildPollinationsUrl(
  prompt: string,
  options: ImageGenerationOptions = {}
): string {
  // Build parameter list (legacy endpoint supports these params)
  const params: Record<string, string> = {
    nologo: 'true',
  };
  
  // Add seed if provided
  if (options.seed !== undefined) {
    params.seed = options.seed.toString();
  }
  
  // Width/Height with bounds checking (512-2048)
  if (options.width !== undefined && options.width >= 512 && options.width <= 2048) {
    params.width = options.width.toString();
  }
  
  if (options.height !== undefined && options.height >= 512 && options.height <= 2048) {
    params.height = options.height.toString();
  }
  
  // Build query string
  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  
  // Build final URL with encoded prompt
  const encodedPrompt = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?${queryString}`;
}

export async function generateImageForChat(
  prompt: string,
  options?: ImageGenerationOptions,
  _pollinationKey?: string
): Promise<string> {
  // Pollinations' direct image endpoint generates the image on request.
  // It does not require an API key and returns an image URL that the browser
  // can render directly.
  return buildPollinationsUrl(prompt, options);
}

/**
 * Parse image generation requests from AI responses
 * Detects patterns like: [GENERATE_IMAGE: prompt text]
 */
export function extractImageRequests(
  text: string
): Array<{ fullMatch: string; prompt: string }> {
  const regex = /\[GENERATE_IMAGE:\s*([^\]]+)\]/g;
  const matches: Array<{ fullMatch: string; prompt: string }> = [];

  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      prompt: match[1].trim(),
    });
  }

  return matches;
}

/**
 * Replace image placeholders with actual generated images
 * Images are returned separately, not embedded in text
 */
export async function processImageRequests(
  text: string,
  options?: ImageGenerationOptions
): Promise<{ text: string; images: Array<{ prompt: string; url: string }>; errors: string[] }> {
  const requests = extractImageRequests(text);
  const images: Array<{ prompt: string; url: string }> = [];
  const errors: string[] = [];
  let processedText = text;

  for (const req of requests) {
    try {
      const imageUrl = await generateImageForChat(req.prompt, options);
      images.push({ prompt: req.prompt, url: imageUrl });
      // Remove placeholder from text (don't embed as markdown)
      processedText = processedText.replace(req.fullMatch, '');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed';
      errors.push(message);
      // Remove placeholder if generation failed
      processedText = processedText.replace(req.fullMatch, '');
    }
  }

  // Clean up any extra whitespace left by removed placeholders
  processedText = processedText.replace(/\n\n+/g, '\n\n').trim();
  if (!processedText && images.length > 0) {
    processedText = buildImageResponseText(images.length);
  }

  return { text: processedText, images, errors };
}
