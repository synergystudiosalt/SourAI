import { blobToDataUrl } from '../shared/imageGenerator';

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

    // Call Pollination AI API
    const response = await fetch('https://api.pollinations.ai/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${POLLINATION_API_KEY}`,
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
      const errorText = await response.text();
      console.error('Pollination API error:', errorText);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to generate image',
          details: errorText 
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get the image as a data URL using a runtime-safe base64 conversion.
    const imageBlob = await response.blob();
    const base64Image = await blobToDataUrl(imageBlob, imageBlob.type || response.headers.get('content-type') || 'image/png');

    return new Response(
      JSON.stringify({
        success: true,
        image: base64Image,
        prompt: prompt,
        model: 'flux-schnell',
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
