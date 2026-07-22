// Placeholder for screens already fully designed in docs/ui_prototype.html
// and mapped to routes in docs/UI_FLOW.md, but not yet wired to Supabase.
// See browse.tsx / car-detail.tsx / my-bookings.tsx for the implementation
// pattern to follow (React Query + supabase-js + RPC calls for writes).
export function ComingSoon({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">{eyebrow}</div>
      <h1 className="mb-4 text-2xl">{title}</h1>
      <p className="text-muted">
        Not yet wired up — see the matching screen in the prototype for the intended design.
      </p>
    </div>
  );
}
