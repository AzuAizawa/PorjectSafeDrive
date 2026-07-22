# SafeDrive 2.0

Peer-to-peer car rental platform for the Philippines (Supabase + React + PayMongo test mode).

## Structure

- `docs/` — process flow spec, design decisions addendum, UI flow reference, and the clickable prototype (`ui_prototype.html`).
- `supabase/sql/` — full Postgres schema, RLS policies, business-logic functions, seed data, storage policies, run in numeric order (`001_schema.sql` → `007_availability.sql`).
- `web/` — the React/TypeScript/Vite app (single SPA, role-routed for renter/lister/admin).

## Getting started

1. **Create a Supabase project** at [supabase.com](https://supabase.com), then in the SQL editor run every file in `supabase/sql/` **in numeric order**. `006_storage.sql` and `007_availability.sql` assume `001`–`005` already ran.
2. **Copy environment variables**: `cp web/.env.example web/.env.local` and fill in your Supabase project URL + anon key (Project Settings → API), plus a PayMongo test public key once you set that up.
3. **Run the app**:
   ```
   cd web
   npm install
   npm run dev
   ```
4. Create a user via the app's Sign Up screen, then in the Supabase dashboard manually set that profile's `role` to `admin` to access `/admin/*` — there's no self-service way to become an admin, by design.

## What's implemented vs. scaffolded

`web/src/routes/browse.tsx`, `car-detail.tsx`, `my-bookings.tsx`, and `login.tsx` are wired to real Supabase queries/RPCs and are the reference pattern for the rest. Every other route (`verify`, `my-vehicles`, `bookings-received`, all of `/admin/*`) is a placeholder — see `docs/ui_prototype.html` for the intended design of each and `docs/UI_FLOW.md` for the route map.

## Key architectural decisions to know before extending this

- **Nothing business-critical is hardcoded.** Commission %, downpayment %, cancellation fees, deadlines, deposit caps — all live in the `platform_settings` table, admin-editable, read via `get_setting_numeric()`/`get_setting_int()` in SQL.
- **Booking state transitions only happen through SECURITY DEFINER RPC functions** (`request_booking`, `accept_booking`, `cancel_booking`, `confirm_handover`, `mark_complete`, etc. in `003_functions.sql`). There is deliberately no RLS policy letting a client directly UPDATE a booking's `status` — always call the RPC, never patch the table directly.
- **Balance payment gates handover.** A rental only becomes `active` once the owner calls `confirm_handover`, which the database refuses unless `status = 'fully_paid'`. This is a deliberate change from a naive "auto-activate on start date" design — see `docs/SAFEDRIVE_V2_DECISIONS.md` §6.
- Full rationale for every decision above is in `docs/SAFEDRIVE_V2_DECISIONS.md`.
