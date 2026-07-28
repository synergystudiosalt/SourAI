import { SourError } from '../../contracts/errors';
import type { FileChangeProposalV1 } from './proposal';
import { proposalDigest, proposalPaths } from './proposal';

/**
 * Approval artifacts.
 *
 * A boolean cannot express "the user approved *this* change, to *these* files,
 * at *this* revision, once". The artifact can, and every field is checked at
 * consumption. The model never touches this module: it emits a proposal, and a
 * human acting in trusted UI code is the only thing that can produce a token
 * the applier will accept.
 */

export const APPROVAL_VERSION = 1 as const;
export const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

export interface ApprovalRequestV1 {
  readonly approvalId: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly projectRevision: number;
  readonly paths: readonly string[];
  readonly summary: string;
  readonly requestedAt: number;
  readonly expiresAt: number;
}

export interface ApprovalArtifactV1 {
  readonly version: typeof APPROVAL_VERSION;
  readonly approvalId: string;
  readonly proposalId: string;
  readonly proposalDigest: string;
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly projectRevision: number;
  readonly paths: readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Proof of issuance. Held in memory, never persisted or sent anywhere. */
  readonly nonce: string;
}

export interface ApprovalConsumptionContext {
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly proposalDigest: string;
  readonly projectRevision: number;
}

type PendingState = 'pending' | 'issued' | 'consumed' | 'denied' | 'expired';

interface PendingApproval {
  readonly request: ApprovalRequestV1;
  readonly nonce: string;
  state: PendingState;
  /**
   * Digest of what the user actually approved.
   *
   * Recorded when the artifact is issued, so consumption can be checked against
   * the coordinator's own memory instead of against fields carried on the
   * artifact — which a caller could otherwise alter in matched pairs.
   */
  issuedDigest?: string;
  issuedPaths?: readonly string[];
  issuedAt?: number;
}

export function approvalError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): SourError {
  return new SourError({
    code,
    message,
    causeCategory: 'policy',
    retryable: false,
    userAction: 'Ask the agent for a fresh proposal and approve it again.',
    details,
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Safe, persistable view of an approval. Deliberately omits the nonce. */
export function approvalMetadata(request: ApprovalRequestV1) {
  return Object.freeze({
    approvalId: request.approvalId,
    proposalId: request.proposalId,
    proposalDigest: request.proposalDigest,
    projectRevision: request.projectRevision,
    paths: Object.freeze([...request.paths]),
    expiresAt: request.expiresAt,
  });
}

export interface ApprovalCoordinatorOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly ttlMs?: number;
}

/**
 * Mints, verifies, and retires approval artifacts.
 *
 * Lives in trusted host code alongside the review UI. Nothing that originates
 * from a provider can call it, which is the property that makes the artifact
 * meaningful rather than decorative.
 */
export class ApprovalCoordinator {
  readonly #pending = new Map<string, PendingApproval>();
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #ttlMs: number;

  constructor(options: ApprovalCoordinatorOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  /** Registers a proposal awaiting a decision and returns its request record. */
  async request(input: {
    readonly proposal: FileChangeProposalV1;
    /** Supplied when the run already recorded this id in its event log. */
    readonly approvalId?: string;
    readonly proposalId?: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly runId: string;
    readonly toolCallId: string;
    readonly projectRevision: number;
    readonly ttlMs?: number;
  }): Promise<ApprovalRequestV1> {
    const requestedAt = this.#now();
    const request: ApprovalRequestV1 = Object.freeze({
      approvalId: input.approvalId ?? this.#createId(),
      proposalId: input.proposalId ?? this.#createId(),
      proposalDigest: await proposalDigest(input.proposal),
      projectId: input.projectId,
      threadId: input.threadId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      projectRevision: input.projectRevision,
      paths: Object.freeze(proposalPaths(input.proposal).map(String)),
      summary: input.proposal.summary,
      requestedAt,
      expiresAt: requestedAt + (input.ttlMs ?? this.#ttlMs),
    });
    this.#pending.set(request.approvalId, {
      request,
      nonce: randomToken(),
      state: 'pending',
    });
    return request;
  }

  get(approvalId: string): ApprovalRequestV1 | undefined {
    return this.#pending.get(approvalId)?.request;
  }

  /**
   * Issues an artifact for a user decision.
   *
   * The digest is re-derived from the proposal being approved, so approving an
   * edited proposal produces an artifact that only matches the edited version.
   */
  async approve(
    approvalId: string,
    proposal: FileChangeProposalV1
  ): Promise<ApprovalArtifactV1> {
    const pending = this.#pending.get(approvalId);
    if (!pending) throw approvalError('approval_unknown', 'That approval is no longer available.');
    if (pending.state === 'consumed') {
      throw approvalError('approval_already_used', 'That approval has already been used.');
    }
    if (pending.state === 'denied') {
      throw approvalError('approval_denied', 'That change was denied.');
    }
    const now = this.#now();
    if (now > pending.request.expiresAt) {
      pending.state = 'expired';
      throw approvalError('approval_expired', 'That approval expired before it was used.');
    }
    const digest = await proposalDigest(proposal);
    // Hashing is asynchronous, so the decision can change underneath it: a
    // denial or a competing approval that lands during the await must not be
    // overwritten by this one.
    const current = this.#pending.get(approvalId);
    if (!current || current.nonce !== pending.nonce) {
      throw approvalError('approval_unknown', 'That approval is no longer available.');
    }
    if (current.state === 'denied') {
      throw approvalError('approval_denied', 'That change was denied.');
    }
    if (current.state === 'consumed') {
      throw approvalError('approval_already_used', 'That approval has already been used.');
    }
    if (this.#now() > current.request.expiresAt) {
      current.state = 'expired';
      throw approvalError('approval_expired', 'That approval expired before it was used.');
    }
    const paths = Object.freeze(proposalPaths(proposal).map(String));
    current.state = 'issued';
    current.issuedDigest = digest;
    current.issuedPaths = paths;
    current.issuedAt = now;
    return Object.freeze({
      version: APPROVAL_VERSION,
      approvalId,
      proposalId: current.request.proposalId,
      proposalDigest: digest,
      projectId: current.request.projectId,
      threadId: current.request.threadId,
      runId: current.request.runId,
      toolCallId: current.request.toolCallId,
      projectRevision: current.request.projectRevision,
      paths,
      issuedAt: now,
      expiresAt: current.request.expiresAt,
      nonce: current.nonce,
    });
  }

  deny(approvalId: string): void {
    const pending = this.#pending.get(approvalId);
    if (!pending) return;
    pending.state = pending.state === 'consumed' ? 'consumed' : 'denied';
  }

  isDenied(approvalId: string): boolean {
    return this.#pending.get(approvalId)?.state === 'denied';
  }

  /**
   * Validates an artifact and retires it in the same synchronous step.
   *
   * There is no `await` between the checks and the state change, so two
   * concurrent callers — a double-clicked button, two queued messages — cannot
   * both observe an unconsumed approval.
   */
  consume(artifact: ApprovalArtifactV1, context: ApprovalConsumptionContext): void {
    const pending = this.#pending.get(artifact?.approvalId);
    if (!pending) {
      throw approvalError('approval_unknown', 'That approval was not issued by this session.');
    }
    if (pending.state === 'consumed') {
      throw approvalError('approval_already_used', 'That approval has already been used.');
    }
    if (pending.state === 'denied') {
      throw approvalError('approval_denied', 'That change was denied.');
    }
    // A forged artifact fails here: the nonce never leaves this process.
    if (typeof artifact.nonce !== 'string' || artifact.nonce !== pending.nonce) {
      throw approvalError('approval_forged', 'That approval could not be verified.');
    }
    if (artifact.version !== APPROVAL_VERSION) {
      throw approvalError('approval_version_unsupported', 'That approval has an unsupported version.');
    }
    const now = this.#now();
    if (now > artifact.expiresAt || now > pending.request.expiresAt) {
      pending.state = 'expired';
      throw approvalError('approval_expired', 'That approval expired before it was used.');
    }
    // Every binding is checked against the coordinator's own record as well as
    // the caller's context. The artifact carries the nonce; it does not get to
    // assert what it authorizes.
    const record = pending.request;
    for (const [field, stored, fromArtifact, fromContext] of [
      ['projectId', record.projectId, artifact.projectId, context.projectId],
      ['threadId', record.threadId, artifact.threadId, context.threadId],
      ['runId', record.runId, artifact.runId, context.runId],
      ['toolCallId', record.toolCallId, artifact.toolCallId, context.toolCallId],
      ['proposalId', record.proposalId, artifact.proposalId, record.proposalId],
    ] as const) {
      if (stored !== fromArtifact || stored !== fromContext) {
        throw approvalError('approval_binding_mismatch', 'That approval does not match this change.', {
          field,
        });
      }
    }
    // The approved digest is whatever was issued — an edited or narrowed
    // proposal has its own — and the applier must be applying exactly that.
    if (
      pending.issuedDigest === undefined ||
      artifact.proposalDigest !== pending.issuedDigest ||
      context.proposalDigest !== pending.issuedDigest
    ) {
      throw approvalError('approval_binding_mismatch', 'That approval does not match this change.', {
        field: 'proposalDigest',
      });
    }
    if (
      pending.issuedPaths === undefined ||
      artifact.paths.length !== pending.issuedPaths.length ||
      artifact.paths.some((path, index) => path !== pending.issuedPaths?.[index])
    ) {
      throw approvalError('approval_binding_mismatch', 'That approval does not match this change.', {
        field: 'paths',
      });
    }
    if (
      pending.issuedAt === undefined ||
      artifact.issuedAt !== pending.issuedAt ||
      artifact.expiresAt !== record.expiresAt
    ) {
      throw approvalError('approval_binding_mismatch', 'That approval does not match this change.', {
        field: 'issuance',
      });
    }
    if (
      context.projectRevision !== record.projectRevision ||
      artifact.projectRevision !== record.projectRevision
    ) {
      throw approvalError(
        'approval_revision_mismatch',
        'The project changed after this approval was given.',
        { approved: record.projectRevision, current: context.projectRevision }
      );
    }
    pending.state = 'consumed';
  }

  /** Drops records for a finished or abandoned run. */
  forgetRun(runId: string): void {
    for (const [approvalId, pending] of this.#pending) {
      if (pending.request.runId === runId) this.#pending.delete(approvalId);
    }
  }

  clear(): void {
    this.#pending.clear();
  }
}
