import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileDiff, RotateCcw, X } from 'lucide-react';

import type { PendingReview, ReviewSelection } from '../../agent/mutations/reviewer';

/**
 * The review surface.
 *
 * Everything a decision depends on is visible before the buttons: which files,
 * what kind of change, how many lines, whether anything already conflicts, and
 * the diff itself. Selection is per file and per hunk, because approving a
 * change wholesale when you only wanted part of it is the thing this phase
 * exists to prevent.
 */

interface ApprovalCardProps {
  readonly review: PendingReview;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onApprove: (selection: ReviewSelection) => void;
  readonly onDeny: () => void;
  readonly onOpenFile?: (path: string) => void;
}

const KIND_LABEL: Record<string, string> = {
  create: 'new file',
  modify: 'modified',
  delete: 'deleted',
  move: 'renamed',
  directory: 'new folder',
};

/** Added and removed lines are marked with a glyph, never colour alone. */
const MARKER: Record<string, string> = { added: '+', removed: '−', context: ' ' };

export function ApprovalCard({
  review,
  busy,
  error,
  onApprove,
  onDeny,
  onOpenFile,
}: ApprovalCardProps) {
  const applicableFiles = useMemo(
    () => review.files.filter((file) => file.conflict === undefined),
    [review.files]
  );
  const [keptPaths, setKeptPaths] = useState<ReadonlySet<string>>(
    () => new Set(applicableFiles.map((file) => file.path))
  );
  const [rejectedHunks, setRejectedHunks] = useState<ReadonlySet<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setKeptPaths(new Set(applicableFiles.map((file) => file.path)));
    setRejectedHunks(new Set());
    // Focus moves to the card when a new change needs review, so a keyboard
    // user lands on it without hunting for it.
    headingRef.current?.focus();
  }, [applicableFiles, review.approvalId]);

  const hunkKey = (path: string, hunkId: string) => `${path}\u0000${hunkId}`;

  const selection = (): ReviewSelection => {
    const hunks: Record<string, string[]> = {};
    for (const file of review.files) {
      if (!keptPaths.has(file.path) || file.hunks.length === 0) continue;
      const kept = file.hunks
        .filter((hunk) => !rejectedHunks.has(hunkKey(file.path, hunk.id)))
        .map((hunk) => hunk.id);
      if (kept.length !== file.hunks.length) hunks[file.path] = kept;
    }
    return {
      paths: [...keptPaths],
      ...(Object.keys(hunks).length > 0 ? { hunks } : {}),
    };
  };

  const keptCount = review.files.filter((file) => keptPaths.has(file.path)).length;
  const nothingKept =
    keptCount === 0 ||
    review.files.every(
      (file) =>
        !keptPaths.has(file.path) ||
        (file.hunks.length > 0 &&
          file.hunks.every((hunk) => rejectedHunks.has(hunkKey(file.path, hunk.id))))
    );

  return (
    <section
      aria-label="Review proposed changes"
      className="rounded-lg border border-[#4776d5]/40 bg-[#4776d5]/5 p-2 text-[11px]"
    >
      <header className="mb-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-1.5 text-xs font-semibold outline-none"
        >
          <FileDiff size={13} /> {review.summary}
        </h3>
        <p className="mt-0.5 opacity-70">
          {review.files.length} file{review.files.length === 1 ? '' : 's'} ·{' '}
          <span>+{review.totalAdded}</span> / <span>−{review.totalRemoved}</span> lines · project
          revision {review.projectRevision}
        </p>
        {review.proposal.verification.length > 0 && (
          <p className="mt-0.5 opacity-70">
            Suggested checks: {review.proposal.verification.join(', ')}
          </p>
        )}
      </header>

      {review.hasConflict && (
        <p role="alert" className="mb-2 flex items-start gap-1 text-blue-700 dark:text-blue-500">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Some files changed after this was proposed. Those files cannot be applied; ask for a
            fresh proposal.
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="mb-2 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {review.files.map((file) => {
          const blocked = file.conflict !== undefined;
          const kept = keptPaths.has(file.path);
          return (
            <li key={file.path} className="rounded border border-current/15">
              <div className="flex items-center gap-2 border-b border-current/10 px-2 py-1">
                <input
                  type="checkbox"
                  id={`keep-${review.approvalId}-${file.path}`}
                  checked={kept && !blocked}
                  disabled={blocked || busy}
                  onChange={(event) =>
                    setKeptPaths((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(file.path);
                      else next.delete(file.path);
                      return next;
                    })
                  }
                />
                <label
                  htmlFor={`keep-${review.approvalId}-${file.path}`}
                  className="min-w-0 flex-1 truncate"
                >
                  <span className="mr-1 rounded bg-black/10 px-1 text-[9px] uppercase dark:bg-white/10">
                    {KIND_LABEL[file.kind] ?? file.kind}
                  </span>
                  <code>{file.path}</code>
                  {file.destination && <code> → {file.destination}</code>}
                </label>
                <span className="shrink-0 opacity-60">
                  +{file.added} −{file.removed}
                </span>
                {onOpenFile && !blocked && file.kind !== 'directory' && (
                  <button
                    type="button"
                    onClick={() => onOpenFile(file.path)}
                    className="shrink-0 underline"
                  >
                    Open
                  </button>
                )}
              </div>

              {blocked ? (
                <p role="alert" className="px-2 py-1 text-blue-700 dark:text-blue-500">
                  {file.conflict}
                </p>
              ) : file.truncated ? (
                <p className="px-2 py-1 opacity-70">
                  This file is too large to review line by line. It is applied whole or not at all.
                </p>
              ) : (
                file.hunks.map((hunk) => {
                  const rejected = rejectedHunks.has(hunkKey(file.path, hunk.id));
                  return (
                    <div key={hunk.id} className="border-b border-current/5 last:border-b-0">
                      <div className="flex items-center gap-2 px-2 py-0.5 opacity-70">
                        <code className="flex-1 truncate">{hunk.header}</code>
                        <button
                          type="button"
                          aria-pressed={!rejected}
                          disabled={busy}
                          onClick={() =>
                            setRejectedHunks((current) => {
                              const next = new Set(current);
                              const key = hunkKey(file.path, hunk.id);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                          className={`rounded px-1.5 py-0.5 text-[9px] ${rejected ? 'bg-black/10 dark:bg-white/10' : 'bg-[#4776d5] text-white'}`}
                        >
                          {rejected ? 'Rejected' : 'Keep'}
                        </button>
                      </div>
                      <pre
                        aria-label={`Diff for ${file.path} at ${hunk.header}`}
                        className={`max-h-52 overflow-auto px-2 pb-1 text-[10px] leading-snug ${rejected ? 'opacity-40' : ''}`}
                      >
                        {hunk.lines.map((line, index) => (
                          <div
                            key={index}
                            className={
                              line.kind === 'added'
                                ? 'text-green-700 dark:text-green-400'
                                : line.kind === 'removed'
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'opacity-60'
                            }
                          >
                            {MARKER[line.kind]} {line.text}
                          </div>
                        ))}
                      </pre>
                    </div>
                  );
                })
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onApprove(selection())}
          disabled={busy || nothingKept || review.hasConflict}
          className="flex items-center gap-1 rounded bg-[#4776d5] px-2 py-1 text-white disabled:opacity-40"
        >
          <Check size={12} /> Approve {keptCount === review.files.length ? 'all' : 'selected'}
        </button>
        <button
          type="button"
          onClick={onDeny}
          disabled={busy}
          className="flex items-center gap-1 rounded border border-current/20 px-2 py-1"
        >
          <X size={12} /> Deny
        </button>
        <span className="ml-auto opacity-60">
          {busy ? 'Applying…' : nothingKept ? 'Nothing selected' : 'Nothing changes until you approve'}
        </span>
      </div>
    </section>
  );
}

interface AppliedCardProps {
  readonly summary: string;
  readonly changedPaths: readonly string[];
  readonly revision: number;
  readonly checkpointId: string;
  readonly verification: readonly {
    readonly id: string;
    readonly label: string;
    readonly status: 'passed' | 'failed' | 'skipped' | 'unavailable';
    readonly detail: string;
  }[];
  readonly onRestore?: () => void;
  readonly onOpenFile?: (path: string) => void;
  readonly restoring?: boolean;
}

const STATUS_GLYPH: Record<string, string> = {
  passed: '✓',
  failed: '✗',
  skipped: '–',
  unavailable: '?',
};

/** Evidence for what was applied, built from recorded facts rather than prose. */
export function AppliedCard({
  summary,
  changedPaths,
  revision,
  checkpointId,
  verification,
  onRestore,
  onOpenFile,
  restoring,
}: AppliedCardProps) {
  return (
    <section aria-label="Applied change" className="rounded-lg border border-current/15 p-2 text-[11px]">
      <h3 className="text-xs font-semibold">{summary}</h3>
      <p className="mt-0.5 opacity-70">
        Revision {revision} · checkpoint {checkpointId.slice(0, 8)}
      </p>
      <ul className="mt-1">
        {changedPaths.map((path) => (
          <li key={path} className="truncate">
            <code>{path}</code>
            {onOpenFile && (
              <button type="button" onClick={() => onOpenFile(path)} className="ml-1 underline">
                Open
              </button>
            )}
          </li>
        ))}
      </ul>
      {verification.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {verification.map((check) => (
            <li key={check.id}>
              <span aria-hidden="true">{STATUS_GLYPH[check.status]}</span>{' '}
              <span className="sr-only">{check.status}:</span>
              {check.label} — {check.detail}
            </li>
          ))}
        </ul>
      )}
      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          disabled={restoring}
          className="mt-2 flex items-center gap-1 rounded border border-current/20 px-2 py-1 disabled:opacity-40"
        >
          <RotateCcw size={12} /> {restoring ? 'Restoring…' : 'Undo this change'}
        </button>
      )}
    </section>
  );
}
