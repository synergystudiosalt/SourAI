import { generateImageForChat } from '../shared/imageGenerator';

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check if Pollination API key is configured
    const env = context.env as Record<string, string>;
    const POLLINATION_API_KEY = env.POLLINATIONS_API_KEY || env.POLLINATION_API_KEY;
    const POLLINATION_IMAGE_MODEL = env.POLLINATIONS_IMAGE_MODEL || env.POLLINATION_IMAGE_MODEL || 'flux-schnell';
    if (!POLLINATION_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Image generation not available', code: 'NO_API_KEY' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json() as {
      prompt: string;
    };

    const { prompt } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const base64Image = await generateImageForChat(prompt, POLLINATION_API_KEY, POLLINATION_IMAGE_MODEL);

    return new Response(
      JSON.stringify({
        success: true,
        image: base64Image,
        prompt: prompt,
        model: POLLINATION_IMAGE_MODEL,
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Image generation error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Image generation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
