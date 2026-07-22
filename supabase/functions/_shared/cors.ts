// Supabase Edge Functions don't add CORS headers by default. Any function
// called via supabase.functions.invoke() from a browser (as opposed to
// server-to-server, like PayMongo calling paymongo-webhook directly) needs
// this, or the browser silently blocks the response after a failed
// preflight — no error surfaces anywhere except the browser console.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}
