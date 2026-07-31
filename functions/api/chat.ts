import { generateText, resolveModelRoute, getApiKeys } from '../shared/ai';
import { processImageRequests } from '../shared/imageGenerator';
import { CHAT_SYSTEM_PROMPT } from '../shared/systemPrompts';
import { splitThinkingAndText, buildImageResponseText } from '../shared/responseFormatting';
import { detectImageRequest, isIdentityRequest } from '../shared/imageDetection';

type PagesFunction = (context: any) => Promise<Response>;

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

        contents.push({ inlineData: { mimeType, data: dataPart } });
      }
    } else if (att.type === 'pdf' && att.dataUrl) {
      const [, dataPart] = att.dataUrl.split(',');
      contents.push({ inlineData: { mimeType: 'application/pdf', data: dataPart } });
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

    const body = await context.request.json() as {
      messages?: any[];
      attachments?: any[];
      model?: string;
      purpose?: 'chat' | 'compaction';
    };

    const { messages = [], attachments = [], model, purpose = 'chat' } = body;

    if (purpose !== 'chat' && purpose !== 'compaction') {
      return new Response(
        JSON.stringify({ error: 'Unsupported request purpose' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const lastUserText = [...messages]
      .reverse()
      .find((message: any) => message?.role === 'user')?.content || '';

    if (purpose === 'chat' && isIdentityRequest(lastUserText)) {
      return new Response(JSON.stringify({
        text: "I'm sour.ai, an AI coding assistant created by Synergy Studios.",
        thinking: 'I recognized an identity question.',
        thinkingLabel: 'Identifying sour.ai',
        images: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const imageRequest = purpose === 'chat'
      ? detectImageRequest(lastUserText)
      : { shouldGenerate: false, prompt: '' };
    if (imageRequest.shouldGenerate) {
      const { text: imageText, images, errors } = await processImageRequests(
        `[GENERATE_IMAGE: ${imageRequest.prompt}]`
      );
      if (images.length === 0) {
        return new Response(JSON.stringify({
          error: `sour.ai could not generate that image: ${errors[0] || 'Pollinations returned no image.'}`,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        text: imageText || buildImageResponseText(images.length),
        images,
        thinking: 'I recognized an image-generation request and sent it to the image model.',
        thinkingLabel: 'Generating image',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const { geminiKeys, groqKeys, cerebrasKeys, mistralKeys } = getApiKeys(env);
    if (geminiKeys.length === 0 && groqKeys.length === 0 && cerebrasKeys.length === 0 && mistralKeys.length === 0) {
      return new Response(JSON.stringify({
        error: 'No AI API keys are configured in Cloudflare Pages environment variables.',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const route = resolveModelRoute(model);

    // Convert attachments to Gemini format
    const attachmentContents = purpose === 'chat'
      ? await convertAttachmentsToGeminiContents(attachments)
      : [];

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

    const systemInstruction = purpose === 'compaction'
      ? 'Write the requested faithful conversation summary. Preserve decisions, paths, failures, and unfinished work. Return only the summary.'
      : `${CHAT_SYSTEM_PROMPT}

Reasoning format:
- Use <think> tags for internal reasoning when solving complex problems.
- Keep thinking brief (1-2 sentences). Do NOT use <check_for_errors>, <planning>, or any other XML tags.
- Do NOT use @@readfile, @@findall, @@context_store, or any @@ tool commands. Those are agent-only.
- Just answer directly after thinking.

Only if the user explicitly asks you to generate an image, picture, or photo (using words like "image", "picture", "photo", "draw", "paint"), include a single [GENERATE_IMAGE: ...] directive for the image description. Do NOT generate images for flowcharts, diagrams, charts, graphs, mind maps, wireframes, or other diagrams — describe those in text/code instead.`;

    const rawText = (await generateText({
      geminiKeys,
      groqKeys,
      cerebrasKeys,
      mistralKeys,
      contents,
      plainMessages,
      systemInstruction,
      route,
    })) || '';

    const { text, thinking } = splitThinkingAndText(rawText);

    if (purpose === 'compaction') {
      const summary = text.trim();
      return new Response(JSON.stringify({ text: summary }), {
        status: summary ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Process image generation requests in the response
    const { text: processedText, images } = await processImageRequests(text);
    const responseText = processedText || buildImageResponseText(images.length) ||
      "I'm sour.ai, created by Synergy Studios. I received the request but the AI provider returned no text. Please check the configured Cloudflare API keys.";

    return new Response(JSON.stringify({
      text: responseText,
      images,
      thinking: thinking || 'I identified the request and prepared a response.',
      thinkingLabel: thinking ? 'Analyzing request' : 'Preparing response',
    }), {
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
