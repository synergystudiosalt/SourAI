export class WorkspaceFsError extends Error {
  constructor(
    readonly code:
      | 'not_found'
      | 'already_exists'
      | 'conflict'
      | 'permission_denied'
      | 'unsupported'
      | 'corrupt_checkpoint'
      | 'transaction_failed',
    message: string,
    readonly path?: string
  ) {
    super(message);
    this.name = 'WorkspaceFsError';
  }
}
