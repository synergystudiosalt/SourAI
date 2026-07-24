/**
 * Check which features are available based on environment configuration
 */
export const onRequest: PagesFunction = async (context) => {
  try {
    return new Response(
      JSON.stringify({
        canGenerateImages: true,
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
