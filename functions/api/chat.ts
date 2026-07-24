import { generateText, resolveModelRoute, getApiKeys } from '../shared/ai';
import { processImageRequests } from '../shared/imageGenerator';

type PagesFunction = (context: any) => Promise<Response>;

// Function to generate images via Pollination AI
async function generateImageForChat(prompt: string, pollinationKey: string): Promise<string | null> {
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

    if (!response.ok) return null;
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Image generation failed:', error);
    return null;
  }
}

async function convertAttachmentsToGeminiContents(
  attachments: any[] = []
): Promise<any[]> {
  const contents: any[] = [];

  for (const att of attachments) {
    if (att.type === 'image') {
      if (att.dataUrl) {
        const [headerPart, dataPart] = att.dataUrl.split(',');
        const mimeMatch = headerPart.match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        contents.push({
          type: 'image',
          source: {
            type: 'base64',
            mediaType: mimeType,
            data: dataPart,
          },
        });
      }
    } else if (att.type === 'pdf' && att.dataUrl) {
      const [, dataPart] = att.dataUrl.split(',');
      contents.push({
        type: 'document',
        source: {
          type: 'base64',
          mediaType: 'application/pdf',
          data: dataPart,
        },
      });
    }
  }

  return contents;
}

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const env = context.env as Record<string, string>;
    const { geminiKeys, groqKeys } = getApiKeys(env);

    if (geminiKeys.length === 0 && groqKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No API keys configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json() as {
      messages?: any[];
      attachments?: any[];
      model?: string;
    };

    const { messages = [], attachments = [], model } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const route = resolveModelRoute(model);

    // Convert attachments to Gemini format
    const attachmentContents = await convertAttachmentsToGeminiContents(
      attachments
    );

    // Build contents for Gemini (multimodal support)
    const contents = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [
        { text: m.content || '' },
        ...(m.role === 'user' && attachmentContents.length > 0
          ? attachmentContents
          : []),
      ],
    }));

    const plainMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content || '',
    }));

    const systemInstruction = `You are a helpful AI assistant. Provide clear, concise, and accurate responses.

You have access to an image generation function. When a user asks for ANY visual content, use the image generation function by including this in your response:
[GENERATE_IMAGE: detailed description of what to generate]

Examples of images you can create:
- Technical: [GENERATE_IMAGE: flowchart showing user registration process with login, email verification, and profile setup steps]
- Diagrams: [GENERATE_IMAGE: UML class diagram for e-commerce system with Product, Order, and Customer classes]
- Mockups: [GENERATE_IMAGE: mobile app landing page mockup with header, hero section, and feature cards]
- Architecture: [GENERATE_IMAGE: microservices architecture diagram with API gateway, user service, product service, and database]
- Artwork: [GENERATE_IMAGE: watercolor painting of a serene mountain landscape at sunset with lake reflection]
- Logos: [GENERATE_IMAGE: modern, minimalist logo for a tech startup called TechFlow with blue and white colors]
- Illustrations: [GENERATE_IMAGE: cartoon illustration of a friendly robot helping people with code]
- UI/UX: [GENERATE_IMAGE: dark mode dashboard design for a cryptocurrency trading platform with charts]
- Infographics: [GENERATE_IMAGE: infographic showing the water cycle with evaporation, condensation, and precipitation]
- Characters: [GENERATE_IMAGE: fantasy character design of an elf wizard with purple robes and magical staff]
- Abstract: [GENERATE_IMAGE: abstract geometric art with vibrant colors, circles and triangles in modern style]

The image will be automatically generated and displayed in the response. Be creative and detailed in your descriptions to get better results.`;

    const text = await generateText({
      geminiKeys,
      groqKeys,
      contents,
      plainMessages,
      systemInstruction,
      route,
    });

    // Process image generation requests in the response
    const pollinationKey = env.POLLINATION_API_KEY;
    const { text: processedText, images } = await processImageRequests(text, pollinationKey);

    return new Response(JSON.stringify({ text: processedText, images }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Chat error:', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
