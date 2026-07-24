/**
 * Detects if user is asking for image generation
 */
export function detectImageRequest(text: string): {
  shouldGenerate: boolean;
  prompt: string;
} {
  const text_lower = text.toLowerCase();

  // Keywords that indicate image generation request
  const imageKeywords = [
    'generate image',
    'create image',
    'draw',
    'paint',
    'create a picture',
    'make an image',
    'generate a picture',
    'design',
    'create design',
    'illustrate',
    'visualize',
    'show me a picture',
    'generate visual',
    'create visual',
    'imagine',
    'design me',
    'make me a picture',
    'generate art',
    'create art',
  ];

  let shouldGenerate = false;
  
  for (const keyword of imageKeywords) {
    if (text_lower.includes(keyword)) {
      shouldGenerate = true;
      break;
    }
  }

  // Extract the prompt by removing common prefixes
  let prompt = text;
  const prefixes = [
    'generate image of ',
    'create image of ',
    'generate a picture of ',
    'create a picture of ',
    'draw ',
    'paint ',
    'design ',
    'illustrate ',
    'visualize ',
    'imagine ',
  ];

  for (const prefix of prefixes) {
    if (text_lower.includes(prefix)) {
      const index = text_lower.indexOf(prefix);
      prompt = text.slice(index + prefix.length).trim();
      break;
    }
  }

  return {
    shouldGenerate,
    prompt: shouldGenerate ? prompt : text,
  };
}
