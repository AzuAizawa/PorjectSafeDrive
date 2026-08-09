// Turns the already-computed analytics numbers (bookings/revenue trend, top
// models/locations, dispute rate, funnel, per-vehicle occupancy) into a
// short list of natural-language insights, using Google's Gemini API rather
// than Claude/Anthropic -- deliberately picked because Gemini has a real
// free tier (rate-limited, but $0) suitable for a capstone project with no
// budget, whereas Anthropic's API has no free tier at all.
//
// Client-supplied `stats` are aggregate numbers already visible to the
// caller on their own Analytics page (admin sees platform-wide, a lister
// sees only their own vehicles) -- nothing sensitive crosses this function
// that the caller couldn't already see. The response is display-only (never
// written back to the database), so there's no injection/trust concern
// beyond normal XSS-safe rendering on the frontend.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
// gemini-2.5-flash and older free-tier models return 404
// ("no longer available to new users") / 429 (zero free quota) for API keys
// minted after Google's rollout of the 3.x line -- confirmed live against
// this project's actual key before picking this model, not assumed from
// docs. gemini-3.5-flash is the current stable (non-preview) flash model
// with real free-tier quota for this key.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: corsHeaders });
  }

  const { error: cooldownError } = await supabase.rpc('request_ai_insights_cooldown');
  if (cooldownError) {
    return new Response(JSON.stringify({ error: cooldownError.message }), { status: 429, headers: corsHeaders });
  }

  const body = await req.json().catch(() => null);
  const role = body?.role === 'lister' ? 'lister' : 'admin';
  const stats = body?.stats;
  if (!stats || typeof stats !== 'object') {
    return new Response(JSON.stringify({ error: 'stats object is required' }), { status: 400, headers: corsHeaders });
  }

  const audience = role === 'lister'
    ? 'a car owner (lister) on SafeDrive reviewing their own vehicles\' performance'
    : 'a platform administrator on SafeDrive reviewing marketplace-wide performance';

  const prompt = `You are a business analyst helping ${audience}, a peer-to-peer car rental platform in the Philippines.
Given this JSON data, write 2 to 4 short, concrete, actionable insights. Reference actual numbers/names from the data where possible. Do not invent data not present here. Do not use markdown formatting.

Data:
${JSON.stringify(stats)}

Respond with ONLY a JSON array, no other text, of objects shaped exactly like:
[{"severity": "info" | "warn" | "good", "text": "one or two sentences"}]`;

  const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  });

  if (!geminiRes.ok) {
    const errBody = await geminiRes.text();
    return new Response(JSON.stringify({ error: 'AI insight generation failed', details: errBody }), { status: 502, headers: corsHeaders });
  }

  const geminiData = await geminiRes.json();
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

  let insights: { severity: string; text: string }[];
  try {
    const parsed = JSON.parse(rawText);
    insights = Array.isArray(parsed) ? parsed : [];
  } catch {
    // Gemini occasionally wraps output despite responseMimeType — surface
    // the raw text as a single insight rather than failing outright.
    insights = rawText ? [{ severity: 'info', text: String(rawText).slice(0, 500) }] : [];
  }

  return new Response(JSON.stringify({ insights }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
