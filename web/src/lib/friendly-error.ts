// Maps raw Postgres/PostgREST error text to a message an end user can act
// on. Blocking the action before it's even attempted (checking
// verified_status client-side, etc.) is still the primary defense — this
// is the fallback for whatever slips through to an actual database error.
export function friendlyErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/row-level security policy/i.test(raw)) {
    return "You don't have permission to do this — make sure you're verified and try again.";
  }
  if (/violates foreign key constraint/i.test(raw)) {
    return 'Something referenced here no longer exists. Please refresh and try again.';
  }
  if (/duplicate key value/i.test(raw)) {
    return "That already exists — you can't create it twice.";
  }
  if (/exceeds the maximum allowed age/i.test(raw)) {
    return raw; // already a custom, friendly RAISE EXCEPTION message
  }
  return raw;
}
