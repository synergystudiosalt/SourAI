/**
 * Wraps untrusted project markup in a preview-only security boundary.
 *
 * The iframe sandbox allows project scripts but keeps them in an opaque origin
 * without storage, opener, popup, form, or top-navigation privileges. This
 * document CSP separately blocks arbitrary network requests while allowing
 * inline project code and the three runtime CDNs used by the preview builders.
 * Keeping the builder free of React/browser state lets Playwright exercise the
 * exact production policy.
 */
function indexOfAsciiMetaTag(source: string, fromIndex: number): number {
  const expected = [0x3c, 0x6d, 0x65, 0x74, 0x61]; // "<meta"
  for (let index = fromIndex; index <= source.length - expected.length; index++) {
    let matches = true;
    for (let offset = 0; offset < expected.length; offset++) {
      const code = source.charCodeAt(index + offset);
      const asciiLower = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
      if (asciiLower !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

export function stripUntrustedMetaElements(source: string): string {
  let output = '';
  let cursor = 0;

  while (cursor < source.length) {
    const candidate = indexOfAsciiMetaTag(source, cursor);
    if (candidate === -1) {
      output += source.slice(cursor);
      break;
    }

    const boundary = source[candidate + 5];
    if (boundary !== undefined && !/[\t\n\f\r />]/.test(boundary)) {
      output += source.slice(cursor, candidate + 5);
      cursor = candidate + 5;
      continue;
    }

    // Rename the tag instead of deleting source bytes. Deletion can join two
    // previously separate fragments into new markup; inserting `x-` leaves
    // every surrounding byte in place and turns the element into an inert
    // custom element. HTML character references are not re-tokenized as tag
    // openers, and an actual meta tag name is necessarily the contiguous ASCII
    // sequence matched above.
    output += `${source.slice(cursor, candidate)}<x-meta`;
    cursor = candidate + 5;
  }

  return output;
}

/** Endpoint that serves the preview document with its own CSP. */
export const PREVIEW_ENDPOINT = '/api/preview';

/** Runtime CDNs the preview may load libraries from. */
export const PREVIEW_SCRIPT_SOURCES = [
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com',
  'https://esm.sh',
] as const;

const PREVIEW_POLICY_DIRECTIVES = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  `script-src 'unsafe-inline' ${PREVIEW_SCRIPT_SOURCES.join(' ')}`,
  "worker-src 'none'",
];

export const PREVIEW_DOCUMENT_POLICY = PREVIEW_POLICY_DIRECTIVES.join('; ');

/**
 * Policy for the served preview response.
 *
 * `sandbox allow-scripts` is the load-bearing part: it drops the document into
 * an opaque origin no matter how the URL is reached. The endpoint echoes
 * caller-supplied HTML from our own origin, so without it a direct navigation
 * would be reflected XSS against the app. With it, the response can never read
 * app storage or cookies, exactly like the srcdoc frame it replaces.
 */
export const PREVIEW_RESPONSE_POLICY = ['sandbox allow-scripts', ...PREVIEW_POLICY_DIRECTIVES].join('; ');

/** Marks a postMessage as preview console output rather than page traffic. */
export const PREVIEW_LOG_MESSAGE = 'sour:preview-log';

export interface PreviewLogEntry {
  readonly level: 'error' | 'warn' | 'log' | 'info';
  readonly text: string;
}

/**
 * Forwards the preview's console and uncaught errors to the parent.
 *
 * The frame runs in an opaque origin, so the app cannot read its console
 * directly; the frame has to volunteer it. Injected ahead of the project's own
 * markup so a syntax error or a throw during initial evaluation is still
 * reported — those are exactly the failures worth catching, and they happen
 * before any project code could report itself.
 *
 * Kept to ES5 and wrapped in try/catch: it runs inside untrusted project code
 * and must never be the thing that breaks the page.
 */
const PREVIEW_CONSOLE_BRIDGE = `<script>(function(){
try{
var MAX=2000,SENT=0,CAP=200;
var send=function(level,parts){
  if(SENT++>CAP)return;
  var text='';
  try{
    for(var i=0;i<parts.length;i++){
      var a=parts[i];
      text+=(i?' ':'')+(typeof a==='string'?a:(a&&a.stack)?a.stack:JSON.stringify(a));
    }
  }catch(e){text=String(parts[0]);}
  try{parent.postMessage({type:'${PREVIEW_LOG_MESSAGE}',level:level,text:String(text).slice(0,MAX)},'*');}catch(e){}
};
var levels=['error','warn','log','info'];
for(var i=0;i<levels.length;i++){(function(level){
  var orig=console[level];
  console[level]=function(){send(level,arguments);if(orig)try{orig.apply(console,arguments);}catch(e){}};
})(levels[i]);}
window.addEventListener('error',function(e){
  send('error',[(e.message||'Error')+' ('+(e.filename||'inline')+':'+(e.lineno||0)+')']);
});
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;send('error',['Unhandled promise rejection: '+((r&&(r.stack||r.message))||r)]);
});
}catch(e){}
})();</script>`;

/** Recognises a preview log message. Callers must also check event.source. */
export function parsePreviewLog(data: unknown): PreviewLogEntry | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (record.type !== PREVIEW_LOG_MESSAGE) return null;
  const level = record.level;
  if (level !== 'error' && level !== 'warn' && level !== 'log' && level !== 'info') return null;
  return { level, text: typeof record.text === 'string' ? record.text : '' };
}

export function buildSandboxedPreviewDocument(source: string): string {
  const policy = PREVIEW_DOCUMENT_POLICY;

  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    PREVIEW_CONSOLE_BRIDGE,
    '</head><body>',
    stripUntrustedMetaElements(source),
    '</body></html>',
  ].join('');
}
