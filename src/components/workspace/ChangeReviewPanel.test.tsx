import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChangeReviewPanel } from './ChangeReviewPanel';

describe('ChangeReviewPanel', () => {
  it('shows a diff and applies reviewed changes', () => {
    const apply = vi.fn();
    render(
      <ChangeReviewPanel
        changes={[{ path: 'src/a.ts', kind: 'modify', before: 'old', after: 'new' }]}
        onApply={apply}
        onReject={vi.fn()}
      />
    );
    expect(screen.getByText('- old')).toBeInTheDocument();
    expect(screen.getByText('+ new')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Apply changes'));
    expect(apply).toHaveBeenCalledOnce();
  });

  it('blocks apply while a conflict needs resolution', () => {
    render(
      <ChangeReviewPanel
        changes={[{ path: 'src/a.ts', kind: 'modify', conflict: 'File changed externally.' }]}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('changed externally');
    expect(screen.getByTitle('Apply changes')).toBeDisabled();
  });
});
