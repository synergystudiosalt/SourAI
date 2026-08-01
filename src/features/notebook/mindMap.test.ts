import { describe, expect, it } from 'vitest';

import { countMindMapNodes, mindMapToOutline, parseMindMap } from './mindMap';

describe('parseMindMap', () => {
  it('nests branches by indentation', () => {
    const tree = parseMindMap(
      ['- Photosynthesis', '  - Inputs', '    - Light', '    - Water', '  - Outputs'].join('\n')
    );

    expect(tree.label).toBe('Photosynthesis');
    expect(tree.children.map((child) => child.label)).toEqual(['Inputs', 'Outputs']);
    expect(tree.children[0].children.map((child) => child.label)).toEqual(['Light', 'Water']);
  });

  it('reads four-space nesting the same as two-space nesting', () => {
    // Models mix indentation widths inside a single reply; counting raw spaces
    // would read the wider style as a much deeper branch than it is.
    const two = parseMindMap(['- Root', '  - A', '    - A1'].join('\n'));
    const four = parseMindMap(['- Root', '    - A', '        - A1'].join('\n'));

    expect(mindMapToOutline(four)).toBe(mindMapToOutline(two));
  });

  it('keeps a synthetic root when the outline has several top-level branches', () => {
    const tree = parseMindMap(['- One', '- Two'].join('\n'), 'My notebook');

    expect(tree.label).toBe('My notebook');
    expect(tree.children).toHaveLength(2);
  });

  it('strips citation markers and emphasis from node labels', () => {
    const tree = parseMindMap('- **Key idea** [2]\n  - detail `x`');

    expect(tree.label).toBe('Key idea');
    expect(tree.children[0].label).toBe('detail x');
  });

  it('accepts numbered lists and headings as levels', () => {
    const tree = parseMindMap(['## Topic', '1. First', '2. Second'].join('\n'));

    expect(countMindMapNodes(tree)).toBe(3);
  });

  it('yields an empty map for prose rather than throwing', () => {
    const tree = parseMindMap('The model refused to produce an outline.', 'Notebook');
    expect(tree.children).toHaveLength(0);
  });
});
