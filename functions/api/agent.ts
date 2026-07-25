import { generateText, resolveModelRoute, getApiKeys } from '../shared/ai';
import { AGENT_SYSTEM_PROMPT, AGENT_WRITE_MODE_NOTE, AGENT_PLAN_MODE_NOTE, buildAgentContextBlock } from '../shared/systemPrompts';
import { splitThinkingAndText } from '../shared/responseFormatting';

const AGENT_SYSTEM_PROMPT_BASE = AGENT_SYSTEM_PROMPT;

export const onRequest: PagesFunction = async (context) => {
  if (context.request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const env = context.env as Record<string, string>;
    const { geminiKeys, groqKeys, cerebrasKeys, mistralKeys } = getApiKeys(env);

    if (geminiKeys.length === 0 && groqKeys.length === 0 && cerebrasKeys.length === 0 && mistralKeys.length === 0) {
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
      mode = 'plan',
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
      mode === 'write' ? AGENT_WRITE_MODE_NOTE : AGENT_PLAN_MODE_NOTE,
      '',
      'File context:',
      contextBlock,
      '',
      'Reasoning format:',
      '- Use MULTIPLE  thinking... response blocks throughout your response (one per logical step).',
      '- Each  thinking block: 1-2 sentences, plain text only, no markdown.',
      '- Example:  thinkingPlanning the fix... responseHere is the implementation.',
    ].join('\n');

    // Prepare message content for Gemini format
    const contents = messages.map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content || '' }],
    }));

    const plainMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content || '',
    }));

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
    let thinkingLabel = '';
    if (thinking) {
      try {
        const firstLines = thinking.split('\n').filter(Boolean).slice(0, 3).join('\n');
        const labelPrompt = `Based on this thinking process:\n${firstLines}\n\nReturn ONLY a 2-4 word action label describing what this reasoning step was doing (e.g., "Planning the fix", "Scanning project files", "Drafting the component"). Do not include quotes, punctuation, or any other text.`;
        const labelText = await generateText({
          geminiKeys,
          groqKeys,
          cerebrasKeys,
          mistralKeys,
          contents: [{ role: 'user', parts: [{ text: labelPrompt }] }],
          plainMessages: [{ role: 'user', content: labelPrompt }],
          systemInstruction: 'You are a concise label generator. Output ONLY a 2 to 4 word phrase with no quotes or punctuation.',
          route,
        });
        const generatedLabel = (labelText || '').trim().replace(/['"]/g, '');
        if (generatedLabel && generatedLabel.split(/\s+/).length <= 5) {
          thinkingLabel = generatedLabel;
        }
      } catch (labelErr) {
        console.warn('Failed to generate dynamic thinking label for agent:', labelErr);
      }
    }

    return new Response(JSON.stringify({
      text: text || "I'm sour.ai, created by Synergy Studios. The AI provider returned no text for this request.",
      thinking: thinking || 'I reviewed the workspace context and prepared an answer.',
      thinkingLabel: thinkingLabel || 'Reviewing workspace',
    }), {
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
