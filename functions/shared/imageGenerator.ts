import { buildImageResponseText } from './responseFormatting';

/**
 * Image generation helper for AI responses
 * Converts text descriptions to images that can be embedded in chat
 */

export async function generateImageForChat(
  prompt: string,
  _pollinationKey?: string
): Promise<string> {
  // Pollinations' direct image endpoint generates the image on request. It
  // does not require an API key and returns an image URL that the browser can
  // render directly.
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
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
  text: string
): Promise<{ text: string; images: Array<{ prompt: string; url: string }>; errors: string[] }> {
  const requests = extractImageRequests(text);
  const images: Array<{ prompt: string; url: string }> = [];
  const errors: string[] = [];
  let processedText = text;

  for (const req of requests) {
    try {
      const imageUrl = await generateImageForChat(req.prompt);
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
