import { generateText, resolveModelRoute, getApiKeys } from '../shared/ai';
import { AGENT_SYSTEM_PROMPT, AGENT_WRITE_MODE_NOTE, AGENT_ASK_MODE_NOTE, buildAgentContextBlock } from '../shared/systemPrompts';

const AGENT_SYSTEM_PROMPT_BASE = AGENT_SYSTEM_PROMPT;

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
      model?: string;
      mode?: string;
      activeFile?: { path: string; content: string } | null;
      projectFiles?: string[];
      mentionedFiles?: { path: string; content: string }[];
    };

    const {
      messages = [],
      model,
      mode = 'ask',
      activeFile,
      projectFiles = [],
      mentionedFiles = [],
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const route = resolveModelRoute(model);

    // Build the context block with file information
    const contextBlock = buildAgentContextBlock(projectFiles, activeFile, mentionedFiles);

    // Build the full prompt with system instruction
    const systemInstruction = [
      AGENT_SYSTEM_PROMPT,
      mode === 'write' ? AGENT_WRITE_MODE_NOTE : AGENT_ASK_MODE_NOTE,
      '',
      'File context:',
      contextBlock,
    ].join('\n\n');

    // Prepare message content for Gemini format
    const contents = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content || '' }],
    }));

    const plainMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content || '',
    }));

    const text = await generateText({
      geminiKeys,
      groqKeys,
      contents,
      plainMessages,
      systemInstruction,
      route,
    });

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Agent error:', err);
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
