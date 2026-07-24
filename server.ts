import express from 'express';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ---------------------------------------------------------------------------
// Multi-key, multi-provider AI backend
//
// Supports rotating across a *pool* of Gemini API keys (comma-separated in
// GEMINI_API_KEYS, falls back to a single GEMINI_API_KEY for convenience),
// and falls back to a pool of Groq keys (GROQ_API_KEYS / GROQ_API_KEY) if
// every Gemini key/model is exhausted (rate-limited, quota'd out, etc).
// Every call rotates to the next key first, spreading load across the pool,
// then walks the rest of the pool on failure before giving up.
// ---------------------------------------------------------------------------

function parseKeyList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

const GEMINI_KEYS = parseKeyList(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY);
const GROQ_KEYS = parseKeyList(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY);

let geminiKeyCursor = 0;
let groqKeyCursor = 0;

function takeGeminiKey(): string | null {
  if (GEMINI_KEYS.length === 0) return null;
  const key = GEMINI_KEYS[geminiKeyCursor % GEMINI_KEYS.length];
  geminiKeyCursor++;
  return key;
}

function takeGroqKey(): string | null {
  if (GROQ_KEYS.length === 0) return null;
  const key = GROQ_KEYS[groqKeyCursor % GROQ_KEYS.length];
  groqKeyCursor++;
  return key;
}

function buildGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

/** Tries every configured Gemini key in rotation for a single model before giving up. */
async function generateWithGemini(contents: any, systemInstruction: string, model: string): Promise<string> {
  if (GEMINI_KEYS.length === 0) throw new Error('No Gemini API keys configured');
  let lastErr: unknown;
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = takeGeminiKey()!;
    try {
      const ai = buildGeminiClient(key);
      const response = await ai.models.generateContent({ model, contents, config: { systemInstruction } });
      return response.text || '';
    } catch (err: any) {
      lastErr = err;
      console.warn(`Gemini key #${attempt + 1}/${GEMINI_KEYS.length} failed on ${model}:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Gemini API keys failed');
}

/** Groq's chat-completions API is OpenAI-compatible; used as a last-resort fallback provider. */
async function generateWithGroq(
  messages: { role: string; content: string }[],
  systemInstruction: string,
  model: string = 'llama-3.3-70b-versatile'
): Promise<string> {
  if (GROQ_KEYS.length === 0) throw new Error('No Groq API keys configured');
  const body = {
    model,
    messages: [{ role: 'system', content: systemInstruction }, ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    }))],
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const key = takeGroqKey()!;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      lastErr = err;
      console.warn(`Groq key #${attempt + 1}/${GROQ_KEYS.length} failed:`, err?.message || err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Groq API keys failed');
}

// ---------------------------------------------------------------------------
// Per-tier model routing
//
// Each sour.ai model tier (persona) is pinned to a specific underlying
// provider + model. If the tier's primary route fails (rate limit, quota,
// transient error, etc.) every tier falls back to the SAME global fallback
// model before finally trying Groq's default model as a last resort.
// ---------------------------------------------------------------------------

type Provider = 'gemini' | 'groq';
interface ModelRoute { provider: Provider; model: string; }

const MODEL_ROUTES: Record<string, ModelRoute> = {
  'sour-omni-flash': { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  'sour-intelligence': { provider: 'groq', model: 'llama-4-scout-17b-16e-instruct' },
  'sour-ultra': { provider: 'gemini', model: 'gemma-4-31b-it' },
  'sour-overclock': { provider: 'gemini', model: 'gemma-4-31b-it' },
};

const DEFAULT_ROUTE: ModelRoute = MODEL_ROUTES['sour-omni-flash'];

/** Applied across every tier, after the tier's own primary route fails. */
const GLOBAL_FALLBACK_MODEL = 'gemma-4-31b-it';

function resolveModelRoute(model: unknown): ModelRoute {
  if (typeof model === 'string' && MODEL_ROUTES[model]) return MODEL_ROUTES[model];
  return DEFAULT_ROUTE;
}

/**
 * Generates a text response for a resolved model tier, trying (in order):
 * the tier's own primary provider/model, then the shared global fallback
 * model on Gemini, then Groq's default model as a last resort.
 * `plainMessages` is a text-only view of the conversation used for any Groq
 * attempt (Gemini's richer multimodal `contents` are used against Gemini).
 */
async function generateText(opts: {
  contents: any;
  plainMessages: { role: string; content: string }[];
  systemInstruction: string;
  route: ModelRoute;
}): Promise<string> {
  const { route, contents, plainMessages, systemInstruction } = opts;
  try {
    if (route.provider === 'groq') {
      return await generateWithGroq(plainMessages, systemInstruction, route.model);
    }
    return await generateWithGemini(contents, systemInstruction, route.model);
  } catch (primaryErr) {
    console.warn(`Primary ${route.provider} model "${route.model}" exhausted, trying global fallback "${GLOBAL_FALLBACK_MODEL}"...`, primaryErr);
    try {
      return await generateWithGemini(contents, systemInstruction, GLOBAL_FALLBACK_MODEL);
    } catch (fallbackErr) {
      console.warn('Global fallback model exhausted, falling back to Groq default...', fallbackErr);
      return await generateWithGroq(plainMessages, systemInstruction);
    }
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: GEMINI_KEYS.length > 0 || GROQ_KEYS.length > 0,
    geminiKeys: GEMINI_KEYS.length,
    groqKeys: GROQ_KEYS.length,
  });
});

// ---------------------------------------------------------------------------
// sour.ai Agent (workspace/IDE) - system prompt + file-context helpers
// ---------------------------------------------------------------------------

const AGENT_SYSTEM_PROMPT_BASE = [
  'You are the sour.ai Agent, an expert AI pair-programmer built directly into the sour.ai code workspace (IDE).',
  'You are given the current project file tree and, for files that are open or @-mentioned, their contents.',
  '',
  'LANGUAGE RESTRICTIONS: Only use languages supported by the IDE: HTML, CSS, JavaScript, Python, Java, C/C++, C#, Go, Rust, Ruby, PHP, SQL, YAML, TOML, JSON, Markdown, Bash/Shell, XML, SVG, and other languages exposed by CodeMirror. Do NOT generate TypeScript, JSX, TSX, Vue, Svelte, or any other framework-specific syntax.',
  '',
  'When you want to CREATE or MODIFY a file, output the entire resulting content of that file inside a',
  'fenced code block formatted EXACTLY like this, including the path attribute:',
  '',
  '```tsx path="src/components/Button.tsx"',
  'export default function Button() {',
  '  return <button>Click me</button>;',
  '}',
  '```',
  '',
  'Rules for file blocks:',
  '- Always include the COMPLETE file content, never a diff or a partial snippet with "..." placeholders.',
  '- Use forward-slash relative paths from the project root (e.g. "src/App.tsx"), never absolute paths.',
  '- You may output multiple file blocks in one response to change several files at once.',
  '- Pick a language tag that matches the file extension (js, css, html, json, py, md, etc). Never use tsx, ts, jsx, or other unsupported formats.',
  '',
  'To DELETE a file, add a standalone line (outside any code block) exactly like:',
  '@@delete: path/to/file.ext',
  '',
  'SUB-AGENTS: For large or multi-part requests that naturally split into independent chunks of work',
  '(e.g. "build the backend AND the frontend AND the tests"), you may autonomously delegate a chunk to a',
  'sub-agent by adding a standalone line (outside any code block) exactly like:',
  '@@subagent: <a short, self-contained description of the sub-task>',
  'You may emit several of these in one response, one per independent chunk of work. The workspace enforces',
  'a hard cap of 4 sub-agents running at once, so only request one when it genuinely reduces the amount of',
  'sequential back-and-forth needed, and never for simple, single-file requests.',
  '',
  'TOOL — Read file: When you need to examine a file whose contents were not provided, request it with:',
  '@@readfile: path/to/file',
  'You may request multiple files at once, one line per file.',
  '',
  'TOOL — Find in all files: When you need to search for a symbol, pattern, or string across the whole',
  'project (e.g. to find all usages of a function, locate where a variable is defined, or audit a string),',
  'use:',
  '@@findall: search term or regex',
  'The workspace searches every loaded file and returns matching lines with file paths and line numbers.',
  'You may issue several @@findall: lines in one response for different queries.',
  '',
  'Both tools resolve before your final answer is generated. Use them freely and in combination.',
  'Never guess at file contents or symbol locations - always call the appropriate tool first.',
  '',
  'REASONING: Before your final answer, you MUST think step by step inside <think>...</think> tags. Write',
  'the thinking in plain text only (no markdown, no bullet symbols), as short, clear sentences. Your output',
  'must start with <think>, then your reasoning, then </think>, followed by your normal response (prose,',
  'file blocks, @@delete lines, and/or @@subagent lines).',
  '',
  'General guidelines:',
  '- Keep prose explanations brief, clear, and outside of code blocks.',
  '- If the user is only asking a question and no file changes are needed, answer normally with no file',
  '  blocks and no @@delete lines.',
  '- Never invent file contents you were not shown - if you need to see a file that was not provided, say',
  '  so, or make a clearly-labeled reasonable assumption.',
  '- Match the existing code style, language, and conventions visible in the files you can see.',
].join('\n');

const AGENT_WRITE_MODE_NOTE =
  'The user currently has "Write" mode selected: when changes are needed, go ahead and output the file blocks directly so they can be applied immediately.';
const AGENT_ASK_MODE_NOTE =
  'The user currently has "Ask" mode selected: it is still fine to include file blocks when they help, since the user reviews every change before it is applied.';

function buildAgentContextBlock(
  projectFiles: string[],
  activeFile: { path: string; content: string } | null | undefined,
  mentionedFiles: { path: string; content: string }[]
): string {
  const lines: string[] = [];

  if (projectFiles.length > 0) {
    lines.push(`Project files (${projectFiles.length}):`);
    lines.push(projectFiles.slice(0, 300).map((p) => `- ${p}`).join('\n'));
  } else {
    lines.push('The project currently has no files yet.');
  }

  if (activeFile && activeFile.path) {
    lines.push('');
    lines.push(`Currently open file: ${activeFile.path}`);
    lines.push('```');
    lines.push(activeFile.content || '');
    lines.push('```');
  }

  for (const f of mentionedFiles) {
    if (!f || !f.path) continue;
    lines.push('');
    lines.push(`Referenced file: ${f.path}`);
    lines.push('```');
    lines.push(f.content || '');
    lines.push('```');
  }

  return lines.join('\n');
}

// API endpoint for sour.ai chat
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Route to the underlying provider/model configured for the selected
    // sour.ai model tier (Omni-Flash / Intelligence / Ultra / Overclock).
    const route = resolveModelRoute(model);

    // Format chat history for Gemma/Gemini with multimodal attachments support
    const contents = messages.map((m: { role: string; content: string; attachments?: any[] }) => {
      const parts: any[] = [];
      let textContent = m.content || '';

      if (m.attachments && Array.isArray(m.attachments)) {
        m.attachments.forEach((att) => {
          const imageUrlsToProcess: string[] = [];

          // Standard image_url schema check: { type: "image_url", image_url: { url: "data:image/png;base64,..." } }
          if (att.type_schema?.image_url?.url && typeof att.type_schema.image_url.url === 'string') {
            imageUrlsToProcess.push(att.type_schema.image_url.url);
          } else if (att.dataUrl && typeof att.dataUrl === 'string') {
            imageUrlsToProcess.push(att.dataUrl);
          } else if (att.url && typeof att.url === 'string' && att.url.startsWith('data:image/')) {
            imageUrlsToProcess.push(att.url);
          }

          // PDF page images array check
          if (att.pageImages && Array.isArray(att.pageImages)) {
            att.pageImages.forEach((imgUrl: string) => {
              if (imgUrl && typeof imgUrl === 'string' && !imageUrlsToProcess.includes(imgUrl)) {
                imageUrlsToProcess.push(imgUrl);
              }
            });
          }

          // Validate and push image inlineData parts
          imageUrlsToProcess.forEach((url) => {
            const matches = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1].toLowerCase();
              const base64Data = matches[2];
              // Input validation: ensure raw non-image MIME types are strictly excluded from inlineData
              const validImageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
              if (validImageTypes.includes(mimeType)) {
                parts.push({
                  inlineData: {
                    mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
                    data: base64Data,
                  },
                });
              }
            }
          });

          // Process extracted document text (from PDFs, DOCX, TXT, Code)
          if (att.content && typeof att.content === 'string' && att.content.trim()) {
            textContent = `[Attached Document: ${att.name}]\n\`\`\`\n${att.content.trim()}\n\`\`\`\n\n${textContent}`;
          } else if (att.name && !imageUrlsToProcess.length) {
            textContent = `[Attached File: ${att.name}]\n\n${textContent}`;
          }
        });
      }

      parts.push({ text: textContent });

      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

    const systemInstruction = `You are sour.ai powered by Google AI.

CRITICAL MANDATE:
Before answering, you MUST write out your step-by-step reasoning inside <think>...</think> tags.
Your output MUST start immediately with <think> followed by your thinking process, then </think>, followed by your final response text.

FORMATTING RULES FOR THINKING:
- Inside <think>...</think>, write in plain text ONLY.
- Do NOT use markdown formatting inside <think> (no bold **text**, no asterisks *, no hashtags #, no bullet point symbols).
- Keep each thinking step as a clear, plain sentence.

Example format:
<think>
Analyzing the user request and breaking it down into steps.
Evaluating potential answers and verifying correctness.
Formulating a concise response.
</think>
Here is the answer...`;

    const plainMessages = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    }));

    const rawText = (await generateText({ contents, plainMessages, systemInstruction, route })) || "I couldn't process that response.";
    let thinking = "";
    let text = rawText;

    const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      text = rawText.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    } else {
      thinking = "";
      text = rawText.trim();
    }

    let thinkingLabel = "Analyzing request";
    if (thinking) {
      try {
        const firstLines = thinking.split('\n').filter(Boolean).slice(0, 3).join('\n');
        const labelText = await generateWithGemini(
          `Based on this thinking process:\n${firstLines}\n\nReturn ONLY a 2-4 word action label describing what this reasoning step was doing (e.g., "Planning the approach", "Analyzing the problem", "Comparing options", "Breaking down steps"). Do not include quotes, punctuation, or any other text.`,
          "You are a concise label generator. Output ONLY a 2 to 4 word phrase with no quotes or punctuation.",
          route.provider === 'gemini' ? route.model : GLOBAL_FALLBACK_MODEL
        );
        const generatedLabel = (labelText || "").trim().replace(/['"]/g, '');
        if (generatedLabel && generatedLabel.split(/\s+/).length >= 1 && generatedLabel.split(/\s+/).length <= 5) {
          thinkingLabel = generatedLabel;
        }
      } catch (labelErr) {
        console.warn("Failed to generate dynamic thinking label:", labelErr);
      }
    }

    return res.json({ text, thinking, thinkingLabel });
  } catch (error: any) {
    console.error('Chat error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate response',
      text: `Error: ${error.message || 'Failed to generate response'}`
    });
  }
});

// API endpoint for the sour.ai Agent (the workspace/IDE's AI pair-programmer).
// Unlike /api/chat, this is aware of the user's project file tree and can
// propose file creates/edits/deletes using the fenced-code-block protocol
// described in AGENT_SYSTEM_PROMPT_BASE, which the client then parses and
// applies to the in-browser workspace (and to disk, for real local folders).
app.post('/api/agent', async (req, res) => {
  try {
    const { messages, activeFile, projectFiles, mentionedFiles, mode, model } = req.body as {
      messages?: { role: string; content: string }[];
      activeFile?: { path: string; content: string } | null;
      projectFiles?: string[];
      mentionedFiles?: { path: string; content: string }[];
      mode?: 'write' | 'ask';
      // Persona picked in the agent panel (Omni-Flash / Intelligence / Ultra / Overclock).
      model?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const route = resolveModelRoute(model);

    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));

    const contextBlock = buildAgentContextBlock(
      Array.isArray(projectFiles) ? projectFiles : [],
      activeFile || null,
      Array.isArray(mentionedFiles) ? mentionedFiles : []
    );
    const modeNote = mode === 'ask' ? AGENT_ASK_MODE_NOTE : AGENT_WRITE_MODE_NOTE;
    const systemInstruction = [AGENT_SYSTEM_PROMPT_BASE, '', modeNote, '', contextBlock].join('\n');

    const plainMessages = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    }));

    const rawText = ((await generateText({ contents, plainMessages, systemInstruction, route })) || '').trim();

    let thinking = '';
    let text = rawText;
    const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      text = rawText.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    }

    let thinkingLabel = '';
    if (thinking) {
      try {
        const firstLines = thinking.split('\n').filter(Boolean).slice(0, 3).join('\n');
        const labelText = await generateWithGemini(
          `Based on this thinking process:\n${firstLines}\n\nReturn ONLY a 2-4 word action label describing what this reasoning step was doing (e.g., "Planning the fix", "Scanning project files", "Drafting the component"). Do not include quotes, punctuation, or any other text.`,
          'You are a concise label generator. Output ONLY a 2 to 4 word phrase with no quotes or punctuation.',
          route.provider === 'gemini' ? route.model : GLOBAL_FALLBACK_MODEL
        );
        const generatedLabel = (labelText || '').trim().replace(/['"]/g, '');
        if (generatedLabel && generatedLabel.split(/\s+/).length <= 5) thinkingLabel = generatedLabel;
      } catch (labelErr) {
        console.warn('Failed to generate dynamic thinking label for agent:', labelErr);
      }
    }

    return res.json({ text, thinking, thinkingLabel });
  } catch (error: any) {
    console.error('Agent error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate a response from the sour.ai Agent',
    });
  }
});



// Fallback 404 for any unmatched /api routes so they return JSON instead of HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
});

// Express error handler for API routes
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/api')) {
    console.error('Express API error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
  next(err);
});

// Always use static files from dist (works for both dev and prod)
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅ sour.ai server running on http://127.0.0.1:${PORT}`);
  console.log(`Gemini keys: ${GEMINI_KEYS.length}, Groq keys: ${GROQ_KEYS.length}`);
  console.log(`Note: Image generation requires Cloudflare Pages deployment with POLLINATION_API_KEY\n`);
});
