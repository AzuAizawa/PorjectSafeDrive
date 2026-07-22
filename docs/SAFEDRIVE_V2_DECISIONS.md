# SafeDrive 2.0 — Design Decisions Addendum

This document supplements the original SafeDrive 2.0 process flow spec. It captures every decision made during the brainstorming pass that changes, extends, or replaces the original design. Where a decision **supersedes** original spec behavior, that's called out explicitly.

---

## 1. Standing Architecture Principle: Dynamic Configuration

No business-rule numbers should be hardcoded. All of the following live in a single admin-editable `platform_settings` table (key/value or structured columns), editable from a new **Admin → Settings** tab:

| Setting | Default | Used for |
|---|---|---|
| `commission_percent` | 10% | Booking pricing (base_price × this) |
| `downpayment_percent` | 50% | Split of total_price due upfront |
| `owner_response_hours` | 24 | `pending_owner` timeout |
| `payment_deadline_hours` | 24 | `pending_payment` timeout |
| `free_cancel_hours` | 24 | Window after downpayment where cancellation is free |
| `cancellation_fee_percent` | 20% | Fee applied to `total_price` on late cancellation |
| `auto_complete_grace_days` | 2 | Days after `end_date` before auto-complete kicks in |
| `free_vehicle_slots` | 5 | Free listing slots per lister |
| `subscription_price` | ₱399/mo | Additional slot subscription price |
| `subscription_slots` | 15 | Slots granted per subscription |
| `max_deposit_percent` | 30% | Cap on owner-set security deposit vs. total_price |
| `demerit_strike_threshold` | 3 | Strikes before auto-flag/suspension review |

**Why:** the platform needs to adapt pricing/policy to market conditions without a code deploy. All calculations elsewhere in this doc reference these settings by name, not by hardcoded value.

---

## 2. Cancellation Policy (new)

- **Free cancellation window:** any time before downpayment is paid (`pending_owner`, `pending_payment`), and for `free_cancel_hours` (default 24h) *after* downpayment is paid — full refund, no fee.
- **After the free window:** cancellation fee = `cancellation_fee_percent` (default 20%) **of `total_price`** — not of whatever's been paid so far. This keeps the fee amount identical regardless of payment stage; only the refund differs:
  - Only downpayment paid: `refund = downpayment_paid − fee`
  - Fully paid: `refund = total_price − fee`
  - Since the fee % will always be well under the 50% downpayment, there's never a shortfall to collect.
- **Owner-initiated cancellation** (after accepting): renter gets a **100% refund** regardless of stage, and the owner receives **+1 demerit strike**.
- New booking statuses: `cancelled_by_renter`, `cancelled_by_owner`.

---

## 3. Demerit / Strike System (new)

Simple integer strike counter on `profiles` (e.g. `strike_count`).

**Triggers (+1 strike):**
- Renter fails to pay balance and can't complete handover (see §6 below) → booking cancelled as no-show/unpaid
- Owner cancels an already-accepted booking
- No-show by either party

**Consequence:** at `demerit_strike_threshold` (default 3), account is auto-flagged (`account_flagged = true`) and booking/listing privileges are paused pending admin review. Admin can manually clear strikes from the Users tab.

---

## 4. Disputes (new)

- New `disputes` table: `booking_id`, `reporter_id`, `description`, `photo_urls`, `status` (`open`/`resolved`), `resolution_notes`, `created_at`, `resolved_at`.
- "**Report an Issue**" button appears on `active`/`completed` bookings for both renter and owner.
- Admin gets a **Disputes** tab: views evidence + the booking's chat log (§5), records a free-form resolution (refund amount decided manually, processed via PayMongo dashboard like other refunds — consistent with the existing manual-payout model).
- Supersedes/extends original §6.4 (owner no-show refund), which remains a special case of this general dispute flow.

---

## 5. In-App Chat (new)

- New `messages` table: `booking_id`, `sender_id`, `message`, `created_at`.
- Thread appears on the booking detail page (both sides) once `status >= owner_accepted`.
- Gives dispute admin concrete evidence to review, and reduces need to share phone numbers before a booking is confirmed.
- Phone number sharing (original spec) is kept for meetup-day logistics; chat handles pre-meetup coordination and dispute records.

---

## 6. Revised Booking Lifecycle (supersedes original §3.3 diagram)

The original spec auto-transitioned `downpayment_paid` → `active` on the start date, with balance payable any time before `end_date`. **This is changed**: the balance must be verified paid at the physical handover, not sometime during the rental.

```
pending_owner ──(owner rejects)──────────────────────→ owner_rejected
     │
     │ (24h timeout, owner_response_hours)
     ▼
   expired

pending_owner ──(owner accepts)──→ pending_payment
                                        │
                                        │ (24h timeout, payment_deadline_hours)
                                        ▼
                                      expired

pending_payment ──(downpayment paid via PayMongo)──→ downpayment_paid
                                                            │
                                                            │ (renter pays balance,
                                                            │  any time before meetup)
                                                            ▼
                                                        fully_paid
                                                            │
                                    (start_date reached, owner clicks
                                     "Confirm Handover" — only enabled
                                     when status = fully_paid)
                                                            ▼
                                                          active
                                                            │
                                    (end_date + auto_complete_grace_days,
                                     both parties "Mark Complete" or auto-complete
                                     if no dispute reported)
                                                            ▼
                                                        completed
                                                            │
                                    (admin manually sends payout via PayMongo,
                                     clicks "Mark as Sent")
                                                            ▼
                                                      payout_sent (terminal)
```

**Handover gate (new mechanic):**
- Once `start_date` is reached, the UI shows the booking as **"Ready for Pickup"** to the owner if `downpayment_paid` or `fully_paid`.
- The **"Confirm Handover"** button is only enabled when `status = fully_paid` (i.e., balance is confirmed paid).
- If the renter arrives at the meetup without having paid the balance, the owner does **not** confirm handover. The owner instead has a **"Cancel — Renter No-Show/Unpaid"** action → booking moves to a terminal cancelled state, existing downpayment-forfeiture rules apply (per §2), and the renter gets **+1 strike**.

**Cancellation branches** (§2) can occur from `pending_owner` through `fully_paid` (before handover is confirmed). Once `active`, only the dispute flow (§4) applies — no more self-service cancellation, since the physical rental is underway.

**Note:** this removes the original `pending_balance` intermediate status (balance is now resolved *before* `active`, not during it).

---

## 7. Security Deposits (new)

- Owner opts in per-vehicle: `vehicles.requires_deposit` (bool), `vehicles.deposit_amount` (nullable).
- Validation: `deposit_amount ≤ max_deposit_percent × total_price` (platform-wide cap, admin-configurable, default 30%) — prevents predatory/excessive deposits while leaving owners flexibility.
- Deposit is collected alongside the downpayment as a separate line item.
- On `completed` with no open dispute → admin manually refunds deposit via PayMongo (consistent with the manual-payout model).
- On a dispute → admin decides how much (if any) of the deposit is withheld as part of dispute resolution (§4).

---

## 8. Ratings & Reviews (new)

- New `reviews` table: `booking_id`, `reviewer_id`, `reviewee_id`, `rating` (1–5), `comment`, `is_hidden` (bool, default false), `created_at`.
- On `completed`, both renter and owner can rate each other once.
- Average rating (excluding `is_hidden = true` reviews) shown on car detail page and lister profile.
- Admin can hide (not hard-delete) abusive/fake reviews from the Users or Disputes tab — hidden reviews are excluded from averages/public display but retained for record-keeping. Audit log: `review_hidden`.

---

## 9. Vehicle Editing / Delisting (new)

Instant, no re-approval needed:
- Daily price, images, additional info, pickup/dropoff location, active/paused toggle.

Requires re-approval (`status` → `pending` again):
- Plate number, ORCR document, brand/model change — these affect the legal/identity cross-check against the owner's verified name.

Car remains publicly visible with its prior data while a sensitive-field re-approval is pending.

---

## 10. Subscription Lifecycle (new)

- Free tier = `free_vehicle_slots` (default 5) **active** vehicle slots.
- Subscribing adds `subscription_slots` (default 15) more, for `subscription_price`/month.
- **On lapse (non-renewal):** the system auto-pauses the most-recently-listed vehicles beyond the current quota (status: `paused_over_quota`). Existing in-progress bookings on paused vehicles are unaffected; only new bookings are blocked.
- **Manual slot management:** while over quota, toggling a paused vehicle back on requires first toggling an active one off — the system always enforces "active vehicles ≤ current quota." This is a straight swap mechanic, not a request queue.

---

## 11. Verification Gating

- `verified_status = 'verified'` is required to **both book and list** a vehicle (both involve real money and a real vehicle changing hands).
- Rejected users can resubmit **unlimited times** — most rejections are just a bad photo or a typo, not fraud. Admin's user modal shows full resubmission history.

---

## 12. Browse Cars — Date Availability Filter (new)

- Renter can filter Browse Cars by a start/end date range directly on the browse page (not just at booking time).
- Query excludes any car with an existing booking overlapping that range in status: `owner_accepted`, `pending_payment`, `downpayment_paid`, `fully_paid`, `active`.
- Avoids wasted booking requests on cars that are actually unavailable.

---

## 13. Double-Booking Prevention

- Multiple `pending_owner` requests can exist for overlapping dates on the same car.
- The moment an owner accepts one, **all other pending requests with overlapping dates auto-transition to `owner_rejected`** with reason `"dates no longer available"`.

---

## 14. Notifications (new)

Dual channel:
- **In-app:** `notifications` table (`user_id`, `type`, `message`, `read`, `created_at`), bell icon with unread badge, populated via Supabase Realtime or polling.
- **Email:** via Supabase Edge Function + an email provider (Resend or SMTP), for time-sensitive events specifically: verification result, booking accepted/rejected, response/payment deadlines approaching, payout sent.

---

## 15. Admin Suspend/Ban (new)

- `profiles.account_status`: `active` | `suspended` | `banned`.
- **Suspended:** can still log in, but cannot create new bookings/listings; existing active bookings complete normally.
- **Banned:** cannot log in at all.
- Ties directly into the demerit auto-flag (§3) — admin reviews flagged accounts and decides suspend/ban/clear.

---

## 16. Image Ordering

- `vehicle_images` table: `vehicle_id`, `image_url`, `sort_order`.
- Image at `sort_order = 0` is the cover photo shown on Browse Cars cards.
- Car Detail carousel shows all images in `sort_order` sequence. Edit form gets a simple "set as cover" control per thumbnail.

---

## 17. Technical Architecture

### App structure
- **Single Vite/React app, one Vercel project.** Router shows `/admin/*` routes only when `profile.role === 'admin'` (enforced client-side for UX *and* server-side via RLS — the client check is never the actual security boundary). Admin routes are `React.lazy`-loaded so the bundle isn't pulled unless the role check passes.

### Storage buckets
| Bucket | Access | Contents |
|---|---|---|
| `car-images` | Public read | Listing photos (needs fast, unauthenticated load on Browse) |
| `user-verification` | Private, signed URLs only | License/ID photos, selfies — viewable only by the user themself + admin |
| `vehicle-documents` | Split | `rental-agreement/*` public-readable (renters need to download); `orcr/*` private, admin-only |

### Scheduled jobs (cron)
- **Supabase `pg_cron` + `pg_net`** calling Edge Functions directly, entirely inside the Supabase project — no public HTTP endpoint required to trigger timeouts/auto-complete.
- **Why over an external cron (Vercel Cron/GitHub Actions hitting an API route):** that pattern requires exposing a public endpoint that must then be locked down (secret token) to prevent abuse — e.g., someone forcing bookings into `expired` early. pg_cron avoids that attack surface entirely. This is a security-engineering choice, not a specific legal/ISO requirement — OWASP/ISO govern *how* securely something is built, not *which* scheduler is used.
- Jobs: `check-owner-timeouts` (hourly), `check-payment-timeouts` (hourly), `auto-complete-bookings` (daily).

### Payment security (flagged finding)
- **PayMongo webhook signature verification is required.** Without verifying PayMongo's webhook signature server-side, anyone who discovers the webhook URL could POST a forged "payment succeeded" event and get a free booking. This must be implemented in the Edge Function that receives PayMongo webhooks (§6.1/6.2 of original spec) before going live even in test mode practice.

---

## 18. Legal / Compliance — Send to Counsel Before Launch

Not legal advice — flagging areas that need a Philippines-licensed lawyer's review before real users, real IDs, and real money are involved:

- **Data Privacy Act (RA 10173):** collecting national ID, driver's license, and selfies is sensitive personal information. Likely needs NPC registration, a real privacy policy, defined retention/deletion rules, and a breach-response procedure.
- **BSP / payment-system rules:** the platform collects renter payment into an admin PayMongo account, then manually disburses net amounts to owners later. This "hold funds then disburse" pattern can brush up against BSP payment-system/EMI licensing rules depending on structure/volume — confirm the platform qualifies as a simple marketplace facilitator.
- **LTO / LTFRB:** self-drive car rental (no driver provided) generally isn't the same regulatory bucket as TNVS/ride-hailing, but confirm P2P car-sharing specifically isn't treated differently under current LTO rules.
- **Rental agreement / Terms of Service:** the rental agreement template, cancellation policy, and deposit-handling terms should get legal review since real contracts are being formed between strangers with real liability exposure (damage, accidents).

---

## 19. Phased Build Roadmap

Given real money and identity documents are involved, the plan is **accuracy over speed** — ship the core loop solid first, then layer in trust/safety features.

**Phase 1 — Core Revenue Loop**
- Auth (signup/login/email confirm), identity verification (user + admin review), Browse Cars (with date filter), Car Detail, booking request → owner accept/reject → downpayment → balance → handover-gated `active` → completion, admin vehicle approval + car catalog, manual payouts, audit trail, `platform_settings` table, PayMongo webhook w/ signature verification, RLS on all tables.

**Phase 2 — Trust & Convenience**
- Vehicle edit/re-approval flow, in-app chat, security deposits, cancellation + fee logic, subscription slots + lapse handling, dual notifications (in-app + email).

**Phase 3 — Safety Net**
- Ratings/reviews (+ moderation), demerit/strike system + auto-flag, disputes tab, admin suspend/ban.

---

*Companion to the original SafeDrive 2.0 process flow spec. Read together, not as a replacement — sections here override the original only where explicitly noted (§6, §9, §10-16 are net-new).*
