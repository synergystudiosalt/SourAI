/**
 * Image generation helper for AI responses
 * Converts text descriptions to images that can be embedded in chat
 */

export async function generateImageForChat(
  prompt: string,
  pollinationKey: string
): Promise<string | null> {
  if (!pollinationKey) return null;

  try {
    const response = await fetch('https://api.pollinations.ai/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pollinationKey}`,
      },
      body: JSON.stringify({
        prompt: prompt,
        model: 'flux-schnell',
        width: 1024,
        height: 1024,
        steps: 4,
      }),
    });

    if (!response.ok) {
      console.error('Pollination API error:', response.status);
      return null;
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Image generation error:', error);
    return null;
  }
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
  pollinationKey: string
): Promise<{ text: string; images: Array<{ prompt: string; url: string }> }> {
  const requests = extractImageRequests(text);
  const images: Array<{ prompt: string; url: string }> = [];
  let processedText = text;

  for (const req of requests) {
    const imageUrl = await generateImageForChat(req.prompt, pollinationKey);
    if (imageUrl) {
      images.push({ prompt: req.prompt, url: imageUrl });
      // Remove placeholder from text (don't embed as markdown)
      processedText = processedText.replace(req.fullMatch, '');
    } else {
      // Remove placeholder if generation failed
      processedText = processedText.replace(req.fullMatch, '');
    }
  }

  // Clean up any extra whitespace left by removed placeholders
  processedText = processedText.replace(/\n\n+/g, '\n\n').trim();

  return { text: processedText, images };
}
