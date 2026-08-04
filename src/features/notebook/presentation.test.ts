import { describe, expect, it } from 'vitest';

import { buildPptx, parsePresentation } from './presentation';

describe('parsePresentation', () => {
  it('turns the generated Markdown contract into slides', () => {
    const result = parsePresentation([
      '# Deep Work',
      '## Slide 1: Why focus matters',
      '- Focus creates valuable output. [1]',
      '- Distraction carries a switching cost. [2]',
      '## Slide 2: Takeaways',
      '- Protect blocks of uninterrupted time. [1]',
    ].join('\n'));

    expect(result.title).toBe('Deep Work');
    expect(result.slides).toEqual([
      {
        title: 'Why focus matters',
        bullets: ['Focus creates valuable output. [1]', 'Distraction carries a switching cost. [2]'],
      },
      { title: 'Takeaways', bullets: ['Protect blocks of uninterrupted time. [1]'] },
    ]);
  });

  it('still creates a usable fallback slide for an imperfect model response', () => {
    expect(parsePresentation('A short unstructured summary', 'Research')).toEqual({
      title: 'Research',
      slides: [{ title: 'Overview', bullets: ['A short unstructured summary'] }],
    });
  });

  it('builds a real PowerPoint package', async () => {
    const blob = await buildPptx('# Research\n## Slide 1: Finding\n- A grounded result. [1]', 'Research');
    expect(blob.type).toContain('presentation');
    expect(blob.size).toBeGreaterThan(10_000);
  });
});
