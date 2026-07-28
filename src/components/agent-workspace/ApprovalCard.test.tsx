import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import { workspacePath } from '../../filesystem';
import { MutationReviewer, type PendingReview } from '../../agent/mutations/reviewer';
import { ApprovalCard, AppliedCard } from './ApprovalCard';

const SEED = [{ path: 'src/app.ts', content: 'a\nb\nc\nd\ne\nf\ng\n' }];

async function reviewFor(changes: unknown[], summary = 'Change the app'): Promise<PendingReview> {
  const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
  const reviewer = new MutationReviewer({ filesystem });
  return reviewer.prepare({
    approvalId: 'approval-1',
    proposalId: 'proposal-1',
    runId: 'run-1',
    threadId: 'thread-1',
    projectId: 'project-1',
    toolCallId: 'call-1',
    proposal: { summary, changes },
  });
}

async function patchReview(): Promise<PendingReview> {
  const filesystem = await MemoryWorkspaceFileSystem.fromFiles(SEED);
  const hash = (await filesystem.stat(workspacePath('src/app.ts'))).contentHash ?? '';
  return reviewFor([
    {
      operation: 'patch_file',
      path: 'src/app.ts',
      expectedHash: hash,
      reason: 'r',
      hunks: [
        { startLine: 1, originalLines: ['a'], replacementLines: ['A'] },
        { startLine: 7, originalLines: ['g'], replacementLines: ['G'] },
      ],
    },
  ]);
}

describe('ApprovalCard', () => {
  it('shows what will change before any decision is possible', async () => {
    const review = await patchReview();
    render(
      <ApprovalCard review={review} onApprove={vi.fn()} onDeny={vi.fn()} />
    );

    expect(screen.getByText('Change the app')).toBeInTheDocument();
    expect(screen.getByText(/1 file/)).toBeInTheDocument();
    expect(screen.getByText(/project revision 0/)).toBeInTheDocument();
    expect(screen.getByText('+2 −2')).toBeInTheDocument();
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Diff for src\/app\.ts/)).toHaveLength(2);
  });

  it('approves everything by default', async () => {
    const review = await patchReview();
    const onApprove = vi.fn();
    render(<ApprovalCard review={review} onApprove={onApprove} onDeny={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Approve all/ }));

    expect(onApprove).toHaveBeenCalledWith({ paths: ['src/app.ts'] });
  });

  it('passes only the kept hunks when one is rejected', async () => {
    const review = await patchReview();
    const onApprove = vi.fn();
    render(<ApprovalCard review={review} onApprove={onApprove} onDeny={vi.fn()} />);

    const [firstKeep] = screen.getAllByRole('button', { name: 'Keep' });
    fireEvent.click(firstKeep);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));

    expect(onApprove).toHaveBeenCalledWith({
      paths: ['src/app.ts'],
      hunks: { 'src/app.ts': [review.files[0].hunks[1].id] },
    });
  });

  it('marks a rejected hunk with a semantic pressed state', async () => {
    const review = await patchReview();
    render(<ApprovalCard review={review} onApprove={vi.fn()} onDeny={vi.fn()} />);

    const [firstKeep] = screen.getAllByRole('button', { name: 'Keep' });
    expect(firstKeep).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(firstKeep);

    expect(screen.getByRole('button', { name: 'Rejected' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('excludes a file the user unticks', async () => {
    const review = await reviewFor([
      { operation: 'write_file', path: 'src/one.ts', content: 'one\n', reason: 'r' },
      { operation: 'write_file', path: 'src/two.ts', content: 'two\n', reason: 'r' },
    ]);
    const onApprove = vi.fn();
    render(<ApprovalCard review={review} onApprove={onApprove} onDeny={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /src\/one\.ts/ }));
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));

    expect(onApprove).toHaveBeenCalledWith({ paths: ['src/two.ts'] });
  });

  it('cannot approve when nothing is selected', async () => {
    const review = await reviewFor([
      { operation: 'write_file', path: 'src/one.ts', content: 'one\n', reason: 'r' },
    ]);
    render(<ApprovalCard review={review} onApprove={vi.fn()} onDeny={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /src\/one\.ts/ }));

    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled();
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
  });

  it('announces a conflict and refuses to include the conflicted file', async () => {
    const review = await reviewFor([
      {
        operation: 'patch_file',
        path: 'src/app.ts',
        expectedHash: 'f'.repeat(64),
        reason: 'r',
        hunks: [{ startLine: 1, originalLines: ['a'], replacementLines: ['A'] }],
      },
    ]);
    render(<ApprovalCard review={review} onApprove={vi.fn()} onDeny={vi.fn()} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((alert) => /changed after/.test(alert.textContent ?? ''))).toBe(true);
    expect(screen.getByRole('checkbox', { name: /src\/app\.ts/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeDisabled();
  });

  it('denies without a selection', async () => {
    const review = await patchReview();
    const onDeny = vi.fn();
    render(<ApprovalCard review={review} onApprove={vi.fn()} onDeny={onDeny} />);

    fireEvent.click(screen.getByRole('button', { name: /Deny/ }));

    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the card so a keyboard user lands on the decision', async () => {
    const review = await patchReview();
    render(<ApprovalCard review={review} onApprove={vi.fn()} onDeny={vi.fn()} />);

    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Change the app/ }));
  });

  it('marks diff lines with a glyph, not colour alone', async () => {
    const review = await patchReview();
    render(<ApprovalCard review={review} onApprove={vi.fn()} onDeny={vi.fn()} />);

    const diff = screen.getAllByLabelText(/^Diff for src\/app\.ts/)[0];
    expect(diff.textContent).toContain('+ A');
    expect(diff.textContent).toContain('− a');
  });

  it('reports an error from a failed application', async () => {
    const review = await patchReview();
    render(
      <ApprovalCard
        review={review}
        error="The project changed after this change was approved."
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/project changed/);
  });
});

describe('AppliedCard', () => {
  const verification = [
    {
      id: 'applied-content',
      label: 'Applied content matches the approved change',
      status: 'passed' as const,
      detail: '1 file verified.',
    },
    {
      id: 'recommended-1',
      label: 'npm test',
      status: 'unavailable' as const,
      detail: 'Needs the in-browser runtime.',
    },
  ];

  it('lists the exact files changed with verification evidence', () => {
    render(
      <AppliedCard
        summary="Applied the change"
        changedPaths={['src/app.ts']}
        revision={3}
        checkpointId="checkpoint-abcdef12"
        verification={verification}
      />
    );

    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(screen.getByText(/Revision 3/)).toBeInTheDocument();
    expect(screen.getByText(/Applied content matches/)).toBeInTheDocument();
    expect(screen.getByText(/Needs the in-browser runtime/)).toBeInTheDocument();
  });

  it('offers an undo that restores the checkpoint', () => {
    const onRestore = vi.fn();
    render(
      <AppliedCard
        summary="Applied"
        changedPaths={['src/app.ts']}
        revision={3}
        checkpointId="checkpoint-1"
        verification={verification}
        onRestore={onRestore}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Undo this change/ }));

    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
