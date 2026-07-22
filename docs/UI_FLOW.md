# SafeDrive 2.0 — UI Flow Reference

Companion to `docs/ui_prototype.html` (published as a clickable Artifact — open it and use the **Preview as: Renter / Lister / Admin** switcher top-right to walk through all three contexts). This doc maps prototype screens to real routes and states for when the React app gets built.

## Design tokens (source of truth: `<style>` block in `ui_prototype.html`)

- **Palette:** cool concrete-grey neutrals (`--paper`, `--ink`, `--line`) paired with a deep signal-teal accent (`--accent: #0e7c6b`) — a highway-signage relationship (green against grey), distinct from the semantic status colors (`--warn` amber, `--good` green, `--bad` red, `--info` blue) used for pills/badges.
- **Type:** system-ui stack throughout (no external font loading), hierarchy carried by weight/size/tracking; `ui-monospace` + `tabular-nums` for all prices, plate numbers, and table figures so digits align in columns.
- **Components:** `.btn-primary/secondary/ghost/danger`, `.pill` (status badges), `.card`, `.table-wrap` (horizontally scrollable), `.modal`, `.toast`. Reuse these rather than inventing new button/badge styles per screen.
- Both light and dark themes are defined via CSS custom properties, following `prefers-color-scheme` with `data-theme` overrides.

## Route map

| Prototype screen id | Real route | Notes |
|---|---|---|
| `landing` | `/` | Public marketing page |
| — (auth) | `/signup`, `/login` | Not built in prototype; standard email/password + confirm |
| `browse` | `/browse` | Default post-login route. Search + body-type + date-range filters (date filter is decorative in the prototype; real version excludes vehicles with overlapping accepted bookings per §12 of the decisions doc) |
| `car-detail` | `/cars/:id` | Gallery left, sticky booking/pricing card right (F-pattern: media+specs draw the eye left-to-right, the action card anchors the right edge where the eye lands) |
| `my-bookings` | `/bookings` | Renter's booking list; actions change per `status` (pay downpayment / pay balance is now folded into "fully paid before handover" — see decisions doc §6 / mark complete / report issue) |
| `verify` | `/verify` | Multi-section form; step indicator reflects personal info → ID → photos |
| `my-vehicles` | `/my-vehicles` | Lister only; quota bar reflects `free_vehicle_slots` vs. used |
| `add-vehicle` | `/my-vehicles/new` (or edit: `/my-vehicles/:id/edit`) | Same form; editing sensitive fields (plate, ORCR, model) re-triggers approval per §9 |
| `bookings-received` | `/bookings-received` | Lister only; per-request actions gated by `status` (Accept/Decline while `pending_owner`, Confirm Handover only enabled once `fully_paid`) |
| `admin-dashboard` | `/admin` | Stat tiles + "needs attention" queues, not raw charts |
| `admin-users` | `/admin/users` | Table → row click opens verification review modal |
| `admin-vehicles` | `/admin/vehicles` | Table → row click opens vehicle review modal (ORCR shown here only) |
| `admin-catalog` | `/admin/catalog` | Brand/model CRUD |
| `admin-disputes` | `/admin/disputes` | Evidence + resolution notes + refund amount field |
| `admin-payments` | `/admin/payments` | Completed bookings lacking a payout `payments` row |
| `admin-audit` | `/admin/audit` | Read-only, filterable log |
| `admin-settings` | `/admin/settings` | Direct CRUD over `platform_settings` — every row in the prototype's Settings screen maps 1:1 to a row in that table |

## Navigation structure

- Persistent top bar: wordmark, notifications bell (unread badge), profile menu (Get Verified / Switch to Lister↔Renter / Log out).
- Left sidebar swaps its item set based on mode: **Renter** (Browse, My Bookings), **Lister** (adds My Vehicles, Bookings Received — Browse/My Bookings stay visible per original spec §4.1), **Admin** (fully separate set, only reachable by `role = 'admin'`).
- The prototype's "Preview as" pill in the top bar is a **prototype-only convenience** to demo all three contexts in one session — it has no equivalent in the real app (mode switching there is the profile-menu toggle for renter/lister; admin is a separate login entirely).

## States worth building explicitly (not just the happy path)

- Empty states: no cars match filters (Browse), no bookings yet (My Bookings), no pending items (Admin queues).
- Disabled affordances, not hidden ones: "Confirm Handover" should render *visible but disabled* with a tooltip/helper text when balance isn't paid yet, so the owner understands why, rather than the button disappearing.
- Destructive actions (Decline, Reject, Cancel, Ban) always get their own visual treatment (`.btn-danger`) and are never the same visual weight as the primary action next to them.
