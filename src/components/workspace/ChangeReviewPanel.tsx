import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';

export interface ReviewableChange {
  readonly path: string;
  readonly kind: 'create' | 'modify' | 'delete' | 'move';
  readonly before?: string;
  readonly after?: string;
  readonly conflict?: string;
}

export interface ChangeReviewPanelProps {
  readonly changes: readonly ReviewableChange[];
  readonly checkpointId?: string;
  readonly onApply: () => void;
  readonly onReject: () => void;
  readonly onRestore?: () => void;
}

function lines(value = ''): string[] {
  return value === '' ? [] : value.split('\n');
}

export function ChangeReviewPanel({
  changes,
  checkpointId,
  onApply,
  onReject,
  onRestore,
}: ChangeReviewPanelProps) {
  const hasConflict = changes.some((change) => Boolean(change.conflict));
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-review-title"
      className="space-y-3 rounded-lg border p-3"
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 id="change-review-title" className="text-sm font-semibold">Review changes</h2>
          <p className="text-xs text-[#706c62]">
            {changes.length} file{changes.length === 1 ? '' : 's'} · apply or restore safely
          </p>
        </div>
        <div className="flex gap-2">
          {checkpointId && onRestore && (
            <button type="button" onClick={onRestore} title="Restore checkpoint">
              <RotateCcw size={15} />
            </button>
          )}
          <button type="button" onClick={onReject} title="Reject changes" autoFocus>
            <X size={15} />
          </button>
          <button type="button" onClick={onApply} disabled={hasConflict} title="Apply changes">
            <Check size={15} />
          </button>
        </div>
      </header>
      {changes.map((change) => (
        <article key={`${change.kind}:${change.path}`} className="overflow-hidden rounded border">
          <div className="flex items-center gap-2 bg-black/5 px-2 py-1 text-xs">
            <span className="uppercase">{change.kind}</span>
            <code>{change.path}</code>
          </div>
          {change.conflict ? (
            <p role="alert" className="flex items-center gap-2 p-2 text-xs text-amber-700">
              <AlertTriangle size={14} /> {change.conflict}
            </p>
          ) : (
            <pre className="max-h-64 overflow-auto p-2 text-xs">
              {lines(change.before).map((line, index) => (
                <div className="text-red-700" key={`before-${index}`}>
                  - {line}
                </div>
              ))}
              {lines(change.after).map((line, index) => (
                <div className="text-green-700" key={`after-${index}`}>
                  + {line}
                </div>
              ))}
            </pre>
          )}
        </article>
      ))}
    </section>
  );
}
