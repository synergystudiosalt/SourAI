type PagesFunction = (context: {
  request: Request;
  env: Record<string, string>;
}) => Promise<Response> | Response;
