import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileNode } from '../../types';
import { FileExplorer } from './FileExplorer';

const TREE: WorkspaceFileNode[] = [
  {
    id: 'src',
    name: 'src',
    path: 'src',
    type: 'folder',
    children: [
      { id: 'src/a.ts', name: 'a.ts', path: 'src/a.ts', type: 'file', content: 'a' },
      {
        id: 'src/inner',
        name: 'inner',
        path: 'src/inner',
        type: 'folder',
        children: [
          { id: 'src/inner/b.ts', name: 'b.ts', path: 'src/inner/b.ts', type: 'file', content: 'b' },
        ],
      },
    ],
  },
  { id: 'top.ts', name: 'top.ts', path: 'top.ts', type: 'file', content: 'top' },
];

function renderExplorer(onMoveNode = vi.fn()) {
  render(
    <FileExplorer
      projectName="drag-test"
      tree={TREE}
      activePath=""
      dirtyPaths={new Set()}
      isRealProject={false}
      onOpenFile={vi.fn()}
      onCreateFile={vi.fn()}
      onCreateFolder={vi.fn()}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onDownload={vi.fn()}
      onUploadFiles={vi.fn()}
      onMoveNode={onMoveNode}
    />
  );
  return onMoveNode;
}

/** The row element carrying the pointer handlers for a given label. */
function rowFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const row = labelNode.closest('[data-explorer-row]');
  if (!row) throw new Error(`no explorer row for ${label}`);
  return row as HTMLElement;
}

function pointerDrag(source: HTMLElement, target: HTMLElement) {
  fireEvent.pointerDown(source, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(target, { pointerId: 1, isPrimary: true, buttons: 1, clientX: 30, clientY: 30 });
  fireEvent.pointerUp(target, { pointerId: 1, isPrimary: true, button: 0, clientX: 30, clientY: 30 });
}

describe('file explorer drag-to-move', () => {
  it('moves a file into a folder it is dropped on', () => {
    const onMoveNode = renderExplorer();

    pointerDrag(rowFor('top.ts'), rowFor('src'));

    expect(onMoveNode).toHaveBeenCalledWith('top.ts', 'src');
  });

  // The move that would detach a whole subtree: a folder cannot land inside
  // itself, so dropping src onto its own descendant must be refused outright.
  it('refuses to drop a folder into its own descendant', () => {
    const onMoveNode = renderExplorer();

    fireEvent.click(screen.getByText('src'));           // expand to reveal inner
    pointerDrag(rowFor('src'), rowFor('inner'));

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it('ignores a drop back onto the folder the item already sits in', () => {
    const onMoveNode = renderExplorer();

    fireEvent.click(screen.getByText('src'));
    pointerDrag(rowFor('a.ts'), rowFor('src'));

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it('moves a nested file back to the project root', () => {
    const onMoveNode = renderExplorer();
    fireEvent.click(screen.getByText('src'));
    const explorer = document.querySelector('.zed-file-explorer');
    if (!explorer) throw new Error('no explorer root');

    pointerDrag(rowFor('a.ts'), explorer as HTMLElement);

    expect(onMoveNode).toHaveBeenCalledWith('src/a.ts', '');
  });

  it('outdents a child by dragging left after its folder was closed and reopened', () => {
    const onMoveNode = renderExplorer();
    const folderLabel = screen.getByText('src');
    fireEvent.click(folderLabel); // open
    fireEvent.click(folderLabel); // close
    fireEvent.click(folderLabel); // reopen
    const child = rowFor('a.ts');

    fireEvent.pointerDown(child, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 30,
      clientY: 30,
    });
    fireEvent.pointerMove(child, {
      pointerId: 1,
      isPrimary: true,
      buttons: 1,
      clientX: 10,
      clientY: 30,
    });

    expect(document.querySelector('[data-explorer-tree]')).toHaveClass('ws-file-root-drop-target');

    fireEvent.pointerUp(child, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 30,
    });

    expect(onMoveNode).toHaveBeenCalledWith('src/a.ts', '');
  });

  it('outdents one level at a time in a deeply nested folder', () => {
    const onMoveNode = renderExplorer();
    fireEvent.click(screen.getByText('src'));
    fireEvent.click(screen.getByText('inner'));
    const child = rowFor('b.ts');

    fireEvent.pointerDown(child, {
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: 44,
      clientY: 30,
    });
    fireEvent.pointerMove(child, {
      pointerId: 2,
      isPrimary: true,
      buttons: 1,
      clientX: 24,
      clientY: 30,
    });
    fireEvent.pointerUp(child, {
      pointerId: 2,
      isPrimary: true,
      button: 0,
      clientX: 24,
      clientY: 30,
    });

    expect(onMoveNode).toHaveBeenCalledWith('src/inner/b.ts', 'src');
  });

  it('shows an indented snap line while a folder is the valid destination', () => {
    renderExplorer();
    const source = rowFor('top.ts');
    const folder = rowFor('src');

    fireEvent.pointerDown(source, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(folder, { pointerId: 1, isPrimary: true, buttons: 1, clientX: 30, clientY: 30 });

    expect(folder).toHaveClass('ws-file-drop-target');
    expect(folder.style.getPropertyValue('--file-drop-indent')).toBe('22px');
  });

  it('does not collapse the destination on the click synthesized after a drag', () => {
    renderExplorer();
    const folder = rowFor('src');

    pointerDrag(rowFor('top.ts'), folder);
    expect(screen.getByText('a.ts')).toBeInTheDocument();

    fireEvent.click(folder);
    expect(screen.getByText('a.ts')).toBeInTheDocument();
  });
});
