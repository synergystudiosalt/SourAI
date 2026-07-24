import { getApiKeys } from '../shared/ai';

export const onRequest: PagesFunction = async (context) => {
  const env = context.env as Record<string, string>;
  const { geminiKeys, groqKeys } = getApiKeys(env);

  return new Response(
    JSON.stringify({
      status: 'ok',
      hasApiKey: geminiKeys.length > 0 || groqKeys.length > 0,
      geminiKeys: geminiKeys.length,
      groqKeys: groqKeys.length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
