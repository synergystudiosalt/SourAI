/**
 * Check which features are available based on environment configuration
 */
export const onRequest: PagesFunction = async (context) => {
  try {
    const env = context.env as Record<string, string>;
    
    return new Response(
      JSON.stringify({
        canGenerateImages: !!(env.POLLINATIONS_API_KEY || env.POLLINATION_API_KEY),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Failed to check features',
        canGenerateImages: false,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
