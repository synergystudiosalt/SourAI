type PagesFunction = (context: {
  request: Request;
  env: Record<string, string>;
  /**
   * Invokes the next handler in the chain — the matching Function, or the
   * static asset. Only present for `_middleware` entrypoints, so it is
   * optional here; route handlers never call it.
   */
  next: () => Promise<Response>;
}) => Promise<Response> | Response;
