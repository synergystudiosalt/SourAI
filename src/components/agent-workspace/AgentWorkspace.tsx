import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Archive, CircleStop, FileCode2, MessageSquarePlus, Play, Search, ShieldCheck,
} from 'lucide-react';

import { AGENT_COMMAND_VERSION, type RunMode } from '../../contracts/commands';
import { normalizeError } from '../../contracts/errors';
import { parseAgentEventV1, type AgentEventV1 } from '../../contracts/events';
import { RepositoryEventSink } from '../../agent/replay';
import { ContextScope } from '../../agent/context/scope';
import {
  buildWorkspaceSnapshot,
  type WorkspaceSnapshotV1,
} from '../../agent/context/snapshot';
import { buildPromptMessages, type EgressPlan } from '../../agent/composition/prompt';
import type { AgentCapabilityReportV1 } from '../../agent/composition/capabilities';
import { findCatalogEntry } from '../../agent/providers/catalog';
import { MemoryWorkspaceFileSystem } from '../../filesystem/memory/MemoryWorkspaceFileSystem';
import {
  MutationReviewer,
  type PendingReview,
  type ReviewSelection,
} from '../../agent/mutations/reviewer';
import { ProposalStore } from '../../agent/mutations/proposalStore';
import { recordCheckpointRestore } from '../../agent/mutations/restoreLog';
import { canonicalJson, proposalDigest } from '../../agent/mutations/proposal';
import type { VerificationCheck } from '../../agent/mutations/applier';
import type { MutationReviewMessageV1 } from '../../agent/worker/protocol';
import { getClientPersistence } from '../../storage/clientPersistence';
import { RECORD_SCHEMA_VERSION } from '../../storage/schema';
import type { WorkspaceFileNode } from '../../types';
import { ApprovalCard, AppliedCard } from './ApprovalCard';
import { ProviderSelector, type ProviderSelection } from './ProviderSelector';

interface AppliedChange {
  readonly summary: string;
  readonly changedPaths: readonly string[];
  readonly revision: number;
  readonly checkpointId: string;
  readonly verification: readonly VerificationCheck[];
}

export interface ProfessionalAgentMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'status';
  readonly content: string;
  readonly createdAt: number;
}

export interface ProfessionalRunRequest {
  readonly message: string;
  readonly mode: RunMode;
  readonly providerId: string;
  readonly modelId: string;
  readonly contextPaths: readonly string[];
}

interface AgentWorkspaceProps {
  readonly projectId: string;
  readonly projectName: string;
  readonly files: readonly WorkspaceFileNode[];
  readonly activeFile: { readonly path: string; readonly content: string } | null;
  readonly isDarkMode: boolean;
  readonly onRun?: (request: ProfessionalRunRequest) => Promise<void>;
  readonly onCancel?: () => void;
  /**
   * Applies an approved change to the real project. Without it the agent has
   * no reviewer, so no mutation tool is offered at all.
   */
  readonly onApplyChanges?: (
    files: readonly { readonly path: string; readonly content: string }[],
    changedPaths: readonly string[]
  ) => void | Promise<void>;
  readonly onOpenFile?: (path: string) => void;
}

const MODES: readonly RunMode[] = ['ask', 'plan', 'write'];
const threadIdFor = (projectId: string, suffix = 'current') => `agent:${projectId}:${suffix}`;
const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} kB`;

function messagesFromEvents(events: readonly AgentEventV1[]): ProfessionalAgentMessage[] {
  const output: ProfessionalAgentMessage[] = [];
  const drafts = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'run.created') {
      output.push({
        id: `user:${event.runId}`,
        role: 'user',
        content: event.payload.input.message,
        createdAt: event.createdAt,
      });
    } else if (event.type === 'provider.output_delta') {
      const index = drafts.get(event.runId);
      if (index === undefined) {
        drafts.set(event.runId, output.length);
        output.push({
          id: `stream:${event.runId}`,
          role: 'assistant',
          content: event.payload.delta,
          createdAt: event.createdAt,
        });
      } else {
        output[index] = {
          ...output[index],
          content: output[index].content + event.payload.delta,
        };
      }
    } else if (event.type === 'assistant.message_completed') {
      const index = drafts.get(event.runId);
      const message = {
        id: `stream:${event.runId}`,
        role: 'assistant' as const,
        content: event.payload.content,
        createdAt: event.createdAt,
      };
      if (index === undefined) output.push(message);
      else output[index] = message;
    } else if (event.type === 'run.failed') {
      output.push({
        id: `failed:${event.runId}`,
        role: 'status',
        content: event.payload.error.message,
        createdAt: event.createdAt,
      });
    } else if (event.type === 'run.cancelled') {
      output.push({
        id: `cancelled:${event.runId}`,
        role: 'status',
        content: event.payload.reason ?? 'Run cancelled.',
        createdAt: event.createdAt,
      });
    }
  }
  return output;
}

/**
 * Finds an approval that was requested but never settled.
 *
 * Replay is the source of truth here: a resolution, an expiry, or a cancelled
 * run all close the approval, and only a genuinely open one is restored.
 */
export function pendingApprovalFromEvents(
  events: readonly AgentEventV1[]
): { readonly approvalId: string; readonly proposalId: string } | undefined {
  const open = new Map<string, string>();
  const cancelledRuns = new Set<string>();
  for (const event of events) {
    if (event.type === 'approval.requested' && event.payload.proposalId) {
      open.set(event.payload.approvalId, event.payload.proposalId);
    } else if (
      event.type === 'approval.resolved' ||
      event.type === 'approval.expired' ||
      event.type === 'approval.consumed'
    ) {
      open.delete(event.payload.approvalId);
    } else if (event.type === 'run.cancelled' || event.type === 'run.failed') {
      cancelledRuns.add(event.runId);
    }
  }
  for (const event of events) {
    if (event.type !== 'approval.requested') continue;
    if (!open.has(event.payload.approvalId)) continue;
    if (cancelledRuns.has(event.runId)) continue;
    return {
      approvalId: event.payload.approvalId,
      proposalId: open.get(event.payload.approvalId)!,
    };
  }
  return undefined;
}

function collectFiles(nodes: readonly WorkspaceFileNode[]): WorkspaceFileNode[] {
  const output: WorkspaceFileNode[] = [];
  const walk = (items: readonly WorkspaceFileNode[]) => {
    for (const item of items) {
      if (item.type === 'file') output.push(item);
      if (item.children) walk(item.children);
    }
  };
  walk(nodes);
  return output;
}

export function AgentWorkspace({
  projectId,
  projectName,
  files,
  activeFile,
  isDarkMode,
  onRun,
  onCancel,
  onApplyChanges,
  onOpenFile,
}: AgentWorkspaceProps) {
  const [mode, setMode] = useState<RunMode>('ask');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [workerReady, setWorkerReady] = useState(Boolean(onRun));
  const [capabilities, setCapabilities] = useState<AgentCapabilityReportV1 | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [hasCredential, setHasCredential] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshotV1 | null>(null);
  const [threadSearch, setThreadSearch] = useState('');
  const [showInspector, setShowInspector] = useState(false);
  const [showEgress, setShowEgress] = useState(false);
  /** What the worker reported it actually sent, as opposed to the preview. */
  const [lastSent, setLastSent] = useState<EgressPlan | null>(null);
  const [messages, setMessages] = useState<ProfessionalAgentMessage[]>([]);
  const [threads, setThreads] = useState([
    { id: threadIdFor(projectId), title: 'New agent task', status: 'idle' },
  ]);
  const [selectedThread, setSelectedThread] = useState(threadIdFor(projectId));
  const workerRef = useRef<Worker | null>(null);
  const currentRunRef = useRef<string | null>(null);
  const selectedThreadRef = useRef(selectedThread);
  const cancelRequestedRef = useRef(false);
  const hydrationEpochRef = useRef(0);
  /** Memory only: never written to state, storage, events, or a command. */
  const credentialRef = useRef<string | undefined>(undefined);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [applied, setApplied] = useState<AppliedChange | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  /** True when the pending review was restored after a reload. */
  const [resumedReview, setResumedReview] = useState(false);
  /** Mirrors `pendingReview` for the worker message handler, which is not re-created per render. */
  const pendingReviewRef = useRef<PendingReview | null>(null);
  /** Last revision reported by the authoritative workspace. */
  const workspaceRevisionRef = useRef(0);
  const reviewerRef = useRef<MutationReviewer | null>(null);
  const canReviewMutations = Boolean(onApplyChanges);
  const publishRevision = useCallback((revision: number) => {
    workspaceRevisionRef.current = revision;
    setSnapshot((current) =>
      current && current.revision !== revision
        ? Object.freeze({ ...current, revision })
        : current
    );
  }, []);

  useEffect(() => {
    selectedThreadRef.current = selectedThread;
  }, [selectedThread]);

  useEffect(() => {
    pendingReviewRef.current = pendingReview;
  }, [pendingReview]);

  useEffect(() => {
    const defaultId = threadIdFor(projectId);
    setSelectedThread(defaultId);
    setThreads([{ id: defaultId, title: 'New agent task', status: 'idle' }]);
    setMessages([]);
    setRunning(false);
    currentRunRef.current = null;
    hydrationEpochRef.current += 1;

    let cancelled = false;
    void getClientPersistence()
      .then((persistence) => persistence.threads.listByProject(projectId))
      .then((records) => {
        if (cancelled) return;
        const restored = records
          .filter((record) => record.metadata?.professionalAgent === true)
          .map((record) => ({ id: record.id, title: record.title, status: record.status }));
        if (restored.length) {
          setThreads(restored);
          setSelectedThread(restored[0].id);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /**
   * Rebuilds the thread, including a review that was still open when the page
   * went away.
   *
   * The events say an approval is pending; the stored proposal supplies the
   * content, so the user sees the same diff rather than an unexplained gap.
   */
  useEffect(() => {
    const epoch = ++hydrationEpochRef.current;
    void getClientPersistence()
      .then(async (persistence) => {
        const events = await new RepositoryEventSink(persistence.events).listThread(selectedThread);
        if (hydrationEpochRef.current !== epoch) return;
        setMessages(messagesFromEvents(events));

        const pending = pendingApprovalFromEvents(events);
        if (!pending) return;
        const stored = await new ProposalStore(persistence.database).load(pending.approvalId);
        if (!stored) return;
        const recomputedDigest = await proposalDigest(stored.proposal);
        if (
          stored.projectId !== projectId ||
          stored.threadId !== selectedThread ||
          stored.digest !== recomputedDigest ||
          hydrationEpochRef.current !== epoch
        ) return;
        const reviewer = reviewerRef.current;
        if (!reviewer) return;
        const review = await reviewer.prepare({
          approvalId: pending.approvalId,
          proposalId: pending.proposalId,
          runId: stored.runId,
          threadId: stored.threadId,
          projectId: stored.projectId,
          toolCallId: stored.toolCallId,
          proposal: JSON.parse(canonicalJson(stored.proposal)),
        });
        if (hydrationEpochRef.current !== epoch) return;
        setPendingReview(review);
        setResumedReview(true);
      })
      .catch(() => undefined);
  }, [selectedThread, projectId, canReviewMutations]);

  const scope = useMemo(() => ContextScope.projectDefault(), []);
  const allFiles = useMemo(() => collectFiles(files), [files]);
  // The caller rebuilds the active-file object on every render; depend on the
  // path so context and worker configuration do not churn with it.
  const activePath = activeFile?.path ?? null;

  /**
   * The snapshot is filtered here, on the host: excluded and credential-shaped
   * files never enter the worker, so no tool and no provider can reach them.
   */
  useEffect(() => {
    let cancelled = false;
    // Hashing every file on each keystroke would be wasteful, so settle first.
    const timer = setTimeout(() => {
      void buildWorkspaceSnapshot(
        projectId,
        // The reviewer's workspace is authoritative for revisions; without one
        // this session cannot mutate, so zero is the honest value.
        workspaceRevisionRef.current,
        allFiles.map((file) => ({
          path: file.path,
          ...(file.content === undefined ? {} : { content: file.content }),
          ...(file.isLoaded === undefined ? {} : { isLoaded: file.isLoaded }),
        })),
        scope
      )
        .then((built) => {
          if (!cancelled) setSnapshot(built);
        })
        .catch(() => {
          if (!cancelled) setSnapshot(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, allFiles, scope]);

  const projectFiles = useMemo(
    () =>
      allFiles
        .filter((file) => file.content !== undefined && file.isLoaded !== false)
        .map((file) => ({ path: file.path, content: file.content ?? '' })),
    [allFiles]
  );

  /**
   * The reviewer owns an authoritative copy of the project.
   *
   * Editor edits are folded in as they happen, which advances the revision. An
   * approval taken before such an edit therefore fails its revision check
   * rather than overwriting whatever the user just typed.
   */
  useEffect(() => {
    if (!canReviewMutations) {
      reviewerRef.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!reviewerRef.current) {
        const filesystem = await MemoryWorkspaceFileSystem.fromFiles(projectFiles);
        if (cancelled) return;
        reviewerRef.current = new MutationReviewer({ filesystem });
        publishRevision(await filesystem.revision());
        return;
      }
      const changed = await reviewerRef.current.filesystem.syncFromHost(projectFiles);
      if (cancelled || changed === 0) return;
      publishRevision(await reviewerRef.current.filesystem.revision());
    })();
    return () => {
      cancelled = true;
    };
  }, [projectFiles, canReviewMutations]);

  useEffect(() => {
    reviewerRef.current = null;
    setPendingReview(null);
    setApplied(null);
  }, [projectId]);

  const contextPaths = useMemo(() => {
    if (!snapshot) return [];
    const available = new Set(snapshot.files.map((file) => String(file.path)));
    if (activePath && available.has(activePath)) return [activePath];
    return snapshot.files.slice(0, 3).map((file) => String(file.path));
  }, [activePath, snapshot]);

  /** The exact request preview: same builder the worker uses before sending. */
  const egress: EgressPlan | null = useMemo(() => {
    if (!snapshot) return null;
    const entry = selection ? findCatalogEntry(selection.providerId) : undefined;
    const built = buildPromptMessages({
      mode,
      message: input || '(your message)',
      snapshot,
      contextPaths,
      scope,
      tools: [],
    });
    const host = selection?.consent?.host ?? entry?.host;
    return {
      ...built.plan,
      destination:
        entry && (entry.kind === 'byok' || entry.kind === 'custom')
          ? { kind: 'remote', ...(host ? { host } : {}), label: host ?? entry.label }
          : { kind: 'local', label: 'this browser' },
    };
  }, [snapshot, selection, mode, input, contextPaths, scope]);

  const postInit = useCallback(
    (worker: Worker) => {
      if (!snapshot || !selection?.providerId || !selection.modelId) return;
      worker.postMessage({
        kind: 'init',
        init: {
          projectId,
          providerId: selection.providerId,
          modelId: selection.modelId,
          snapshot,
          scope: scope.toConfig(),
          contextPaths,
          openFiles: activePath ? [activePath] : [],
          canReviewMutations,
          ...(selection.consent ? { consent: selection.consent } : {}),
        },
      });
    },
    [snapshot, selection, projectId, scope, contextPaths, activePath, canReviewMutations]
  );

  useEffect(() => {
    if (onRun) {
      setWorkerReady(true);
      return;
    }
    if (typeof Worker !== 'function') {
      setWorkerReady(false);
      setDegraded('This browser does not support Web Workers, and there is no server fallback.');
      return;
    }
    setWorkerReady(false);
    const worker = new Worker(
      new URL('../../agent/worker/clientAgent.worker.ts', import.meta.url),
      { type: 'module', name: 'sourai-agent-runtime' }
    );
    workerRef.current = worker;
    worker.addEventListener('message', (message: MessageEvent<unknown>) => {
      const envelope = message.data as {
        kind?: string;
        event?: unknown;
        runId?: string;
        capabilities?: AgentCapabilityReportV1;
        plan?: EgressPlan;
        request?: MutationReviewMessageV1;
        error?: { message?: string };
      };
      if (envelope.kind === 'worker.ready') {
        setDegraded(null);
        setCapabilities(envelope.capabilities ?? null);
        setWorkerReady(true);
        return;
      }
      if (envelope.kind === 'worker.degraded') {
        setWorkerReady(false);
        setRunning(false);
        setDegraded(envelope.error?.message ?? 'The agent could not start.');
        return;
      }
      if (envelope.kind === 'egress.planned') {
        setLastSent(envelope.plan ?? null);
        return;
      }
      if (envelope.kind === 'mutation.review') {
        const request = envelope.request;
        const reviewer = reviewerRef.current;
        if (!request || !reviewer) {
          worker.postMessage({
            kind: 'mutation.reviewed',
            approvalId: request?.approvalId ?? '',
            report: { decision: 'denied', reason: 'This session cannot apply workspace changes.' },
          });
          return;
        }
        // One review at a time. Replacing the open card would leave the first
        // run waiting on a decision the user can no longer give.
        if (pendingReviewRef.current) {
          worker.postMessage({
            kind: 'mutation.reviewed',
            approvalId: request.approvalId,
            report: {
              decision: 'denied',
              reason: 'Another change is already waiting for review.',
            },
          });
          return;
        }
        setReviewError(null);
        void reviewer
          .prepare({
            approvalId: request.approvalId,
            proposalId: request.proposal.id,
            runId: request.runId,
            threadId: request.threadId,
            projectId: request.projectId,
            toolCallId: request.toolCallId,
            proposal: request.proposal.value,
          })
          .then(async (review) => {
            // Persisted before the user can act, so a reload mid-review finds
            // the same change rather than an approval with no content.
            const persistence = await getClientPersistence();
            await new ProposalStore(persistence.database).save({
              proposalId: review.proposalId,
              approvalId: review.approvalId,
              projectId: request.projectId,
              threadId: request.threadId,
              runId: request.runId,
              toolCallId: request.toolCallId,
              digest: review.digest,
              proposal: review.proposal,
            });
            setPendingReview(review);
            setResumedReview(false);
          })
          .catch((cause) => {
            const normalized = normalizeError(cause, {
              code: 'proposal_rejected',
              message: 'The proposed change could not be reviewed.',
              causeCategory: 'validation',
            });
            worker.postMessage({
              kind: 'mutation.reviewed',
              approvalId: request.approvalId,
              report: { decision: 'denied', reason: normalized.message },
            });
          });
        return;
      }
      if (envelope.kind === 'command.accepted' && envelope.runId) {
        currentRunRef.current = envelope.runId;
        if (cancelRequestedRef.current) {
          cancelRequestedRef.current = false;
          worker.postMessage({
            kind: 'command',
            command: {
              version: AGENT_COMMAND_VERSION,
              type: 'run.cancel',
              requestId: crypto.randomUUID(),
              createdAt: Date.now(),
              runId: envelope.runId,
            },
          });
        }
        return;
      }
      if (envelope.kind === 'command.rejected') {
        setRunning(false);
        setMessages((current) => [
          ...current.filter((item) => item.role !== 'status'),
          {
            id: crypto.randomUUID(),
            role: 'status',
            content: envelope.error?.message ?? 'Run rejected.',
            createdAt: Date.now(),
          },
        ]);
        return;
      }
      if (envelope.kind !== 'event') return;
      let event: AgentEventV1;
      try {
        event = parseAgentEventV1(envelope.event);
      } catch {
        setRunning(false);
        setMessages((current) => [
          ...current.filter((item) => item.role !== 'status'),
          {
            id: crypto.randomUUID(),
            role: 'status',
            content: 'The worker returned an invalid event.',
            createdAt: Date.now(),
          },
        ]);
        return;
      }
      if (event.threadId !== selectedThreadRef.current) return;
      if (event.type === 'provider.output_delta') {
        setMessages((current) => {
          const withoutStatus = current.filter((item) => item.role !== 'status');
          const last = withoutStatus.at(-1);
          if (last?.role === 'assistant' && last.id === `stream:${event.runId}`) {
            return withoutStatus.map((item) =>
              item.id === last.id ? { ...item, content: item.content + event.payload.delta } : item
            );
          }
          return [
            ...withoutStatus,
            {
              id: `stream:${event.runId}`,
              role: 'assistant',
              content: event.payload.delta,
              createdAt: event.createdAt,
            },
          ];
        });
      }
      if (event.type === 'tool.completed' || event.type === 'tool.failed') {
        const detail =
          event.type === 'tool.completed'
            ? (event.payload.summary ?? 'tool completed')
            : event.payload.error.message;
        setMessages((current) => [
          ...current,
          {
            id: `tool:${event.payload.toolCallId}:${event.type}`,
            role: 'status',
            content: detail,
            createdAt: event.createdAt,
          },
        ]);
      }
      if (
        event.type === 'run.completed' ||
        event.type === 'run.failed' ||
        event.type === 'run.cancelled'
      ) {
        setRunning(false);
        currentRunRef.current = null;
        // A run that has stopped cannot have its change applied: the approval
        // is withdrawn rather than left on screen where it still looks live.
        const open = pendingReviewRef.current;
        if (open && open.runId === event.runId) {
          reviewerRef.current?.deny(open.approvalId);
          pendingReviewRef.current = null;
          setPendingReview(null);
          setReviewError('The run ended before this change was approved, so it was not applied.');
          void getClientPersistence()
            .then((persistence) => new ProposalStore(persistence.database).delete(open.approvalId))
            .catch(() => undefined);
        }
        setThreads((current) =>
          current.map((thread) =>
            thread.id === event.threadId ? { ...thread, status: event.type.slice(4) } : thread
          )
        );
        void getClientPersistence()
          .then(async (persistence) => {
            const record = await persistence.threads.get(event.threadId);
            if (!record) return;
            await persistence.threads.put({
              ...record,
              status: event.type.slice(4),
              updatedAt: Math.max(record.updatedAt, event.createdAt),
            });
          })
          .catch(() => undefined);
        if (event.type === 'run.failed') {
          setMessages((current) => [
            ...current.filter((item) => item.role !== 'status'),
            {
              id: `failed:${event.runId}`,
              role: 'status',
              content: event.payload.error.message,
              createdAt: event.createdAt,
            },
          ]);
        }
      }
    });
    return () => {
      worker.terminate();
      workerRef.current = null;
      setWorkerReady(false);
      setCapabilities(null);
    };
  }, [onRun]);

  /** Reconfiguring mid-run is refused by the worker, so only do it when idle. */
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || running) return;
    postInit(worker);
  }, [postInit, running]);

  /**
   * Applies the user's decision.
   *
   * The reviewer mints the approval artifact and runs the transaction; the
   * worker is then told what actually happened so it can record the events and
   * let the run continue with facts rather than assumptions.
   */
  const resolveReview = async (review: PendingReview, selection: ReviewSelection | null) => {
    const reviewer = reviewerRef.current;
    if (!reviewer) return;
    const worker = workerRef.current;
    // A review restored after reload has no run waiting on it; the decision is
    // still honoured, there is simply nobody to notify.
    const notify = (report: Record<string, unknown>) => {
      if (!resumedReview) {
        worker?.postMessage({ kind: 'mutation.reviewed', approvalId: review.approvalId, report });
      }
    };
    const forget = () =>
      void getClientPersistence()
        .then((persistence) => new ProposalStore(persistence.database).delete(review.approvalId))
        .catch(() => undefined);

    setReviewBusy(true);
    setReviewError(null);
    try {
      if (selection === null) {
        reviewer.deny(review.approvalId);
        notify({ decision: 'denied', reason: 'You declined the change.' });
        forget();
        setPendingReview(null);
        return;
      }

      // Told before the transaction starts: from here a cancellation must not
      // be recorded as a denial, because the workspace may already have changed.
      if (!resumedReview) {
        worker?.postMessage({ kind: 'mutation.applying', approvalId: review.approvalId });
      }
      const { outcome, digest } = await reviewer.approve(review, selection);
      let reportedOutcome = outcome;

      if (outcome.status === 'applied') {
        try {
          await onApplyChanges?.(reviewer.filesystem.listFiles(), outcome.changedPaths);
        } catch (cause) {
          await reviewer.restore(outcome.checkpointId);
          const error = normalizeError(cause, {
            code: 'workspace_persistence_failed',
            message: 'The approved change could not be persisted and was rolled back.',
            causeCategory: 'storage',
          });
          reportedOutcome = {
            status: 'failed',
            error: error.toData(),
            rolledBack: true,
            checkpointId: outcome.checkpointId,
            transactionId: outcome.transactionId,
          };
        }
      }

      notify({ decision: 'approved', digest, outcome: reportedOutcome });
      if (reportedOutcome.status !== 'conflict') forget();

      if (reportedOutcome.status === 'applied') {
        publishRevision(reportedOutcome.revision);
        setApplied({
          summary: review.summary,
          changedPaths: reportedOutcome.changedPaths,
          revision: reportedOutcome.revision,
          checkpointId: reportedOutcome.checkpointId,
          verification: reportedOutcome.verification,
        });
        setPendingReview(null);
      } else if (reportedOutcome.status === 'conflict') {
        setReviewError(
          reportedOutcome.conflicts
            .map((conflict) => `${conflict.path || 'workspace'}: ${conflict.reason}`)
            .join(' ')
        );
        setPendingReview(null);
      } else {
        setReviewError(reportedOutcome.error.message);
        setPendingReview(null);
      }
    } catch (cause) {
      const normalized = normalizeError(cause, {
        code: 'approval_failed',
        message: 'The change could not be applied.',
        causeCategory: 'runtime',
      });
      setReviewError(normalized.message);
      notify({ decision: 'denied', reason: normalized.message });
      setPendingReview(null);
    } finally {
      setReviewBusy(false);
    }
  };

  const restoreCheckpoint = async (change: AppliedChange) => {
    const reviewer = reviewerRef.current;
    if (!reviewer) return;
    let undoRollback:
      | Awaited<ReturnType<MemoryWorkspaceFileSystem['snapshot']>>
      | undefined;
    setReviewBusy(true);
    try {
      if ((await reviewer.filesystem.revision()) !== change.revision) {
        throw new Error('The project changed after this checkpoint. Undo was refused to protect newer edits.');
      }
      undoRollback = await reviewer.filesystem.snapshot();
      const persistence = await getClientPersistence();
      // The undo is recorded as its own run, so the audit trail shows the
      // change being taken back and not only being applied.
      await recordCheckpointRestore(
        {
          sink: new RepositoryEventSink(persistence.events),
          projectId,
          threadId: selectedThread,
          checkpointId: change.checkpointId,
        },
        async () => {
          const result = await reviewer.restore(change.checkpointId);
          await onApplyChanges?.(reviewer.filesystem.listFiles(), change.changedPaths);
          return { revision: result.revision, restoredPaths: change.changedPaths };
        }
      );
      publishRevision(await reviewer.filesystem.revision());
      setApplied(null);
    } catch (cause) {
      if (undoRollback) {
        await reviewer.filesystem.restore(undoRollback).catch(() => undefined);
        publishRevision(await reviewer.filesystem.revision());
      }
      setReviewError(
        normalizeError(cause, {
          code: 'restore_failed',
          message: 'That checkpoint could not be restored.',
          causeCategory: 'runtime',
        }).message
      );
    } finally {
      setReviewBusy(false);
    }
  };

  const canRun =
    workerReady &&
    Boolean(selection?.providerId && selection.modelId) &&
    (findCatalogEntry(selection?.providerId ?? '')?.requiresCredential !== true || hasCredential);

  const submit = async () => {
    const message = input.trim();
    if (!message || running || !canRun) return;
    if (!onRun && !workerRef.current) return;
    hydrationEpochRef.current += 1;
    setInput('');
    setRunning(true);
    let workerOwnsRun = false;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: message, createdAt: Date.now() },
    ]);
    try {
      const request = {
        message,
        mode,
        providerId: selection?.providerId ?? '',
        modelId: selection?.modelId ?? '',
        contextPaths,
      } satisfies ProfessionalRunRequest;
      if (onRun) await onRun(request);
      else {
        const now = Date.now();
        const title = message.length > 48 ? `${message.slice(0, 45)}...` : message;
        const persistence = await getClientPersistence();
        const existing = await persistence.threads.get(selectedThread);
        await persistence.threads.put({
          schemaVersion: RECORD_SCHEMA_VERSION,
          id: selectedThread,
          projectId,
          title: existing?.title === 'New agent task' || !existing ? title : existing.title,
          status: 'running',
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          archivedAt: null,
          metadata: { professionalAgent: true },
        });
        setThreads((current) =>
          current.map((thread) =>
            thread.id === selectedThread
              ? {
                  ...thread,
                  title: thread.title === 'New agent task' ? title : thread.title,
                  status: 'running',
                }
              : thread
          )
        );
        workerOwnsRun = true;
        workerRef.current!.postMessage({
          kind: 'command',
          command: {
            version: AGENT_COMMAND_VERSION,
            type: 'run.start',
            requestId: crypto.randomUUID(),
            createdAt: Date.now(),
            projectId,
            threadId: selectedThread,
            input: {
              message: request.message,
              mode: request.mode,
              providerId: request.providerId,
              modelId: request.modelId,
            },
          },
          // Sent beside the command, never inside it, so it cannot be persisted.
          ...(credentialRef.current ? { credential: credentialRef.current } : {}),
        });
      }
    } catch (error) {
      const normalized = normalizeError(error, {
        code: 'agent_start_failed',
        message: 'The local agent could not start.',
        causeCategory: 'runtime',
        retryable: true,
      });
      setMessages((current) => [
        ...current.filter((item) => item.role !== 'status'),
        {
          id: crypto.randomUUID(),
          role: 'status',
          content: normalized.message,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      if (!workerOwnsRun) setRunning(false);
    }
  };

  const providerEntry = selection ? findCatalogEntry(selection.providerId) : undefined;

  return (
    <aside
      aria-label="Professional agent workspace"
      className={`flex h-full min-w-0 border-r ${isDarkMode ? 'border-[#2e2f30] bg-[#1c1c1d] text-[#e8eaef]' : 'border-[#d1d5de] bg-[#fbfcfd] text-[#202123]'}`}
    >
      <nav aria-label="Agent threads" className="w-36 shrink-0 border-r border-current/10 p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">Threads</span>
          <button
            title="New agent thread"
            onClick={() => {
              const id = crypto.randomUUID();
              const threadId = threadIdFor(projectId, id);
              setThreads((current) => [
                { id: threadId, title: 'New agent task', status: 'idle' },
                ...current,
              ]);
              setSelectedThread(threadId);
              setMessages([]);
            }}
          >
            <MessageSquarePlus size={14} />
          </button>
        </div>
        <label className="mb-2 flex items-center gap-1 rounded border border-current/10 px-1.5">
          <Search size={11} />
          <input
            aria-label="Search agent threads"
            value={threadSearch}
            onChange={(event) => setThreadSearch(event.target.value)}
            className="min-w-0 bg-transparent py-1 text-[11px] outline-none"
          />
        </label>
        {threads
          .filter((thread) =>
            thread.title.toLocaleLowerCase().includes(threadSearch.trim().toLocaleLowerCase())
          )
          .map((thread) => (
            <button
              key={thread.id}
              onClick={() => setSelectedThread(thread.id)}
              aria-current={selectedThread === thread.id ? 'page' : undefined}
              className={`mb-1 w-full rounded px-2 py-1.5 text-left text-[11px] ${selectedThread === thread.id ? 'bg-[#4776d5]/15 text-[#4776d5]' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              <span className="block truncate">{thread.title}</span>
              <span className="text-[9px] opacity-55">{thread.status}</span>
            </button>
          ))}
        <button
          disabled
          title="Thread archiving is not enabled yet"
          className="mt-2 flex items-center gap-1 text-[10px] opacity-40"
        >
          <Archive size={11} /> Archived
        </button>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 items-center justify-between border-b border-current/10 px-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{projectName}</p>
            <p className="text-[9px] opacity-55">
              {capabilities?.provider.detail ?? 'Local structured agent'}
            </p>
          </div>
          <button
            title="Toggle run inspector"
            aria-pressed={showInspector}
            onClick={() => setShowInspector((value) => !value)}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Activity size={14} />
          </button>
        </header>

        {degraded && (
          <p role="alert" className="border-b border-current/10 bg-red-500/10 px-3 py-2 text-[11px]">
            {degraded}
          </p>
        )}

        {showInspector && (
          <section
            aria-label="Run inspector"
            className="space-y-1 border-b border-current/10 p-2 text-[10px]"
          >
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="block opacity-55">State</span>
                {running ? 'streaming' : 'idle'}
              </div>
              <div>
                <span className="block opacity-55">Provider</span>
                {selection?.providerId ?? 'none selected'}
              </div>
              <div>
                <span className="block opacity-55">Model</span>
                {selection?.modelId || '—'}
              </div>
            </div>
            {capabilities && (
              <ul className="space-y-0.5 opacity-70">
                <li>Storage: {capabilities.storage.detail}</li>
                <li>Workspace: {capabilities.filesystem.detail}</li>
                <li>Tools: {capabilities.toolNames.join(', ') || 'none'}</li>
                <li>Mutation: {capabilities.mutation.detail}</li>
              </ul>
            )}
            {lastSent && (
              <p className="opacity-70">
                Last request sent {formatBytes(lastSent.promptBytes)} to {lastSent.destination.label}
                {lastSent.files.length
                  ? ` (${lastSent.files.map((file) => file.path).join(', ')})`
                  : ' with no file context'}
                .
              </p>
            )}
          </section>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <ShieldCheck className="mb-3 text-[#4776d5]" size={28} />
              <h2 className="text-sm font-medium">Private coding agent</h2>
              <p className="mt-1 max-w-56 text-[11px] opacity-60">
                Runs, tools, approvals, and recovery remain in this browser.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`rounded-lg p-2.5 text-xs ${message.role === 'user' ? 'ml-5 bg-[#4776d5]/10' : message.role === 'status' ? 'border border-dashed border-current/15 opacity-65' : 'mr-3 bg-black/5 dark:bg-white/5'}`}
              >
                <p className="mb-1 text-[9px] font-bold uppercase opacity-50">{message.role}</p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </article>
            ))
          )}

          {pendingReview && resumedReview && (
            <p className="rounded border border-current/20 p-2 text-[11px] opacity-80">
              This change was still waiting for review when the page closed. The run has ended, but
              you can still apply or discard it.
            </p>
          )}

          {pendingReview && (
            <ApprovalCard
              review={pendingReview}
              busy={reviewBusy}
              error={reviewError}
              onApprove={(selection) => void resolveReview(pendingReview, selection)}
              onDeny={() => void resolveReview(pendingReview, null)}
              {...(onOpenFile ? { onOpenFile } : {})}
            />
          )}

          {!pendingReview && reviewError && (
            <p role="alert" className="rounded border border-blue-500/40 p-2 text-[11px]">
              {reviewError}
            </p>
          )}

          {applied && (
            <AppliedCard
              summary={applied.summary}
              changedPaths={applied.changedPaths}
              revision={applied.revision}
              checkpointId={applied.checkpointId}
              verification={applied.verification}
              restoring={reviewBusy}
              onRestore={() => void restoreCheckpoint(applied)}
              {...(onOpenFile ? { onOpenFile } : {})}
            />
          )}
        </div>

        <section aria-label="Agent context" className="border-t border-current/10 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowEgress((value) => !value)}
            aria-expanded={showEgress}
            className="flex w-full items-center gap-1 overflow-hidden text-left text-[10px] opacity-75"
          >
            <FileCode2 size={11} />
            <span className="truncate">
              {egress && egress.files.length > 0
                ? `${egress.files.length} file(s), ${formatBytes(egress.contextBytes)} → ${egress.destination.label}`
                : 'No file context'}
            </span>
          </button>
          {showEgress && egress && (
            <div className="mt-1 space-y-1 rounded border border-current/15 p-2 text-[10px]">
              <p className="font-medium">
                {egress.destination.kind === 'remote'
                  ? `This exact content will be sent to ${egress.destination.host ?? egress.destination.label}.`
                  : 'This content stays in this browser.'}
              </p>
              <ul>
                {egress.files.map((file) => (
                  <li key={file.path} className="flex justify-between gap-2">
                    <span className="truncate">{file.path}</span>
                    <span className="opacity-60">
                      {formatBytes(file.bytes)}
                      {file.truncated ? ' (truncated)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="opacity-60">
                Prompt total {formatBytes(egress.promptBytes)}.{' '}
                {snapshot?.excluded.length
                  ? `${snapshot.excluded.length} project file(s) excluded from this run, including credential-shaped paths.`
                  : 'No files were excluded.'}
              </p>
            </div>
          )}
        </section>

        <div className="space-y-2 border-t border-current/10 p-2">
          <ProviderSelector
            selection={selection}
            hasCredential={hasCredential}
            disabled={running}
            onSelect={setSelection}
            onCredentialChange={(value) => {
              credentialRef.current = value;
              setHasCredential(Boolean(value));
            }}
          />

          <div className="flex items-center gap-1">
            {MODES.map((value) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`rounded px-2 py-1 text-[10px] capitalize ${mode === value ? 'bg-[#4776d5] text-white' : 'bg-black/5 dark:bg-white/5'}`}
              >
                {value}
              </button>
            ))}
            <span className="ml-auto text-[9px] opacity-55">read-only tools</span>
          </div>

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder={
              degraded
                ? 'Agent unavailable'
                : !workerReady
                  ? 'Starting local agent...'
                  : !selection?.providerId
                    ? 'Choose a provider to begin'
                    : providerEntry?.requiresCredential && !hasCredential
                      ? 'Add an API key for this session'
                      : `Message agent in ${mode} mode`
            }
            disabled={!canRun && !running}
            className="h-20 w-full resize-none rounded-md border border-current/15 bg-transparent p-2 text-xs outline-none focus:border-[#4776d5]"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] opacity-60">
              {capabilities?.egress.kind === 'remote'
                ? `Remote · ${capabilities.egress.host ?? capabilities.egress.label}`
                : 'Local only'}
            </span>
            {running ? (
              <button
                onClick={() => {
                  onCancel?.();
                  const runId = currentRunRef.current;
                  if (runId) {
                    workerRef.current?.postMessage({
                      kind: 'command',
                      command: {
                        version: AGENT_COMMAND_VERSION,
                        type: 'run.cancel',
                        requestId: crypto.randomUUID(),
                        createdAt: Date.now(),
                        runId,
                      },
                    });
                  } else cancelRequestedRef.current = true;
                }}
                className="rounded bg-red-600 p-1.5 text-white"
                title="Stop run"
              >
                <CircleStop size={13} />
              </button>
            ) : (
              <button
                disabled={!canRun}
                onClick={() => void submit()}
                className="rounded bg-[#4776d5] p-1.5 text-white disabled:opacity-40"
                title="Run agent"
              >
                <Play size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
