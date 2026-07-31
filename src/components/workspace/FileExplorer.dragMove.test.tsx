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

/** The row element carrying the drag handlers for a given label. */
function rowFor(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const row = labelNode.closest('[draggable]');
  if (!row) throw new Error(`no draggable row for ${label}`);
  return row as HTMLElement;
}

const dataTransfer = () => ({
  effectAllowed: '',
  dropEffect: '',
  setData: vi.fn(),
  getData: vi.fn(),
});

describe('file explorer drag-to-move', () => {
  it('moves a file into a folder it is dropped on', () => {
    const onMoveNode = renderExplorer();

    fireEvent.dragStart(rowFor('top.ts'), { dataTransfer: dataTransfer() });
    fireEvent.dragOver(rowFor('src'), { dataTransfer: dataTransfer() });
    fireEvent.drop(rowFor('src'), { dataTransfer: dataTransfer() });

    expect(onMoveNode).toHaveBeenCalledWith('top.ts', 'src');
  });

  // The move that would detach a whole subtree: a folder cannot land inside
  // itself, so dropping src onto its own descendant must be refused outright.
  it('refuses to drop a folder into its own descendant', () => {
    const onMoveNode = renderExplorer();

    fireEvent.click(screen.getByText('src'));           // expand to reveal inner
    fireEvent.dragStart(rowFor('src'), { dataTransfer: dataTransfer() });
    fireEvent.drop(rowFor('inner'), { dataTransfer: dataTransfer() });

    expect(onMoveNode).not.toHaveBeenCalled();
  });

  it('ignores a drop back onto the folder the item already sits in', () => {
    const onMoveNode = renderExplorer();

    fireEvent.click(screen.getByText('src'));
    fireEvent.dragStart(rowFor('a.ts'), { dataTransfer: dataTransfer() });
    fireEvent.drop(rowFor('src'), { dataTransfer: dataTransfer() });

    expect(onMoveNode).not.toHaveBeenCalled();
  });
});
