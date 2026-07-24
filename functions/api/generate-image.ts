import { generateImageForChat } from '../shared/imageGenerator';

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // Check if Pollination API key is configured
    const POLLINATION_API_KEY = (context.env as Record<string, string>).POLLINATION_API_KEY;
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

    const base64Image = await generateImageForChat(prompt, POLLINATION_API_KEY);
    if (!base64Image) {
      return new Response(
        JSON.stringify({ error: 'Failed to generate image' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        image: base64Image,
        prompt: prompt,
        model: 'flux',
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
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
