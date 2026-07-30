import { describe, expect, it } from 'vitest';
import { extractReplaceRequests } from './agentProtocol';

describe('extractReplaceRequests', () => {
  it('reads a single-line edit', () => {
    const { requests, text } = extractReplaceRequests(
      '@@replace: a.js ||| const x = 1; ||| const x = 2;'
    );
    expect(requests).toEqual([{ path: 'a.js', search: 'const x = 1;', replace: 'const x = 2;' }]);
    expect(text.trim()).toBe('');
  });

  // The previous single regex captured only the first line of a multi-line
  // replacement, so the edit applied and silently discarded the rest while the
  // remainder leaked into the visible reply.
  it('keeps every line of a multi-line replacement', () => {
    const search = '<head>\n  <title>Old</title>\n</head>';
    const replace = '<head>\n  <title>New</title>\n  <meta charset="utf-8">\n</head>';
    const { requests, text } = extractReplaceRequests(
      `@@replace: index.html ||| ${search} ||| ${replace}`
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].search).toBe(search);
    expect(requests[0].replace).toBe(replace);
    // Nothing is left behind to render as prose.
    expect(text.trim()).toBe('');
  });

  it('reads several edits in one reply', () => {
    const { requests } = extractReplaceRequests(
      ['@@replace: a.js ||| one ||| ONE', '@@replace: b.css ||| two ||| TWO'].join('\n')
    );
    expect(requests.map((r) => r.path)).toEqual(['a.js', 'b.css']);
    expect(requests.map((r) => r.replace)).toEqual(['ONE', 'TWO']);
  });

  it('stops a block at the next directive rather than swallowing it', () => {
    const { requests } = extractReplaceRequests(
      '@@replace: a.js ||| old ||| new\n@@readfile: b.js'
    );
    expect(requests).toEqual([{ path: 'a.js', search: 'old', replace: 'new' }]);
  });

  it('stops a block at a file fence', () => {
    const { requests, text } = extractReplaceRequests(
      '@@replace: a.js ||| old ||| new\n```js path="c.js"\nbody\n```'
    );
    expect(requests[0].replace).toBe('new');
    // The fence survives so the file block still parses.
    expect(text).toContain('```js path="c.js"');
  });

  it('leaves a directive with no closing separator visible instead of half-applying it', () => {
    const source = '@@replace: a.js ||| old but never closed';
    const { requests, text } = extractReplaceRequests(source);
    expect(requests).toEqual([]);
    expect(text).toBe(source);
  });

  it('ignores an edit with no search text, which would match anywhere', () => {
    const { requests } = extractReplaceRequests('@@replace: a.js |||    ||| something');
    expect(requests).toEqual([]);
  });

  it('normalises the path', () => {
    const { requests } = extractReplaceRequests('@@replace: ./src/a.js ||| old ||| new');
    expect(requests[0].path).toBe('src/a.js');
  });

  it('allows an empty replacement, which deletes the matched text', () => {
    const { requests } = extractReplaceRequests('@@replace: a.js ||| remove me |||');
    expect(requests).toEqual([{ path: 'a.js', search: 'remove me', replace: '' }]);
  });

  it('returns the text untouched when there is no directive', () => {
    const source = 'Just prose about ||| pipes.';
    expect(extractReplaceRequests(source)).toEqual({ requests: [], text: source });
  });
});
