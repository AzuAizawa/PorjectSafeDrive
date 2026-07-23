# ISO/IEC 27001 Annex A — Gap Analysis

**What this document is:** an honest self-assessment mapping SafeDrive 2.0's actual
implemented controls against ISO/IEC 27001:2022 Annex A control families, produced
for capstone documentation purposes.

**What this document is not:** a claim of ISO 27001 certification, compliance, or
audit-readiness. Real ISO 27001 certification requires a formal Information
Security Management System (ISMS), documented risk assessment methodology,
management review cycles, and an accredited external audit — none of which apply
to a capstone project. Every row below is a factual statement about what exists in
the codebase as of 2026-07-23, verified by reading the actual schema, RLS
policies, and function grants rather than assumed from memory.

---

## A.5 — Organizational controls

| Control area | Status | Notes |
|---|---|---|
| A.5.1 Policies for information security | Partial | `/privacy` page documents data handling in plain language; no formal written InfoSec policy document exists (would be organizational overhead disproportionate to a capstone). |
| A.5.3 Segregation of duties | Implemented | `user` / `support` / `admin` roles are distinct; `support` is explicitly blocked (both by RLS and route guards) from Settings, Payments, Catalog, and account ban actions — only `admin` can perform those. |
| A.5.15 Access control | Implemented | Row Level Security enabled on every table (verified: 22/22 tables), no exceptions. All state-changing writes route through `SECURITY DEFINER` RPCs rather than direct table access, so the state machine can't be bypassed via a raw PATCH. |
| A.5.16 Identity management | Implemented | Supabase Auth handles identity lifecycle (signup/login/password reset); no separate identity store to reconcile. |
| A.5.17 Authentication information | Implemented | Password strength rules enforced client-side at signup; Supabase Auth stores credentials hashed, never touched by application code. |
| A.5.18 Access rights | Partial (fixed this session) | Role changes now go through an audited `promote_user_role()` RPC (added 2026-07-23) rather than unlogged raw SQL. No periodic access review process exists (would require a real ops cadence, not applicable at this stage). |
| A.5.23 Cloud service security | Partial | Relies on Supabase's and Vercel's own cloud security posture (both SOC 2 Type II providers) rather than independently verified — reasonable for a capstone, would need vendor due diligence for a real deployment. |
| A.5.24–5.28 Incident management | Not implemented | No formal incident response plan, no security event alerting beyond the `audit_trail` table being queryable after the fact. Flagged as a known limitation, not built. |

## A.6 — People controls

| Control area | Status | Notes |
|---|---|---|
| A.6.3 Awareness/training | N/A | No real organization/staff to train — capstone context. |
| A.6.5 Post-employment responsibilities | N/A | Same — no real employment relationships exist. |
| A.6.6 Confidentiality agreements | N/A | Same. |

## A.7 — Physical controls

| Control area | Status | Notes |
|---|---|---|
| All A.7.x | Delegated | No physical infrastructure — entirely delegated to Vercel (hosting) and Supabase (database/storage/auth) as managed cloud providers. |

## A.8 — Technological controls

| Control area | Status | Notes |
|---|---|---|
| A.8.2 Privileged access rights | Implemented | Mandatory 2FA (TOTP) for `support`/`admin` roles, enforced at both the RLS layer (`is_support_or_admin()` requires `aal2`) and a route-level `MandatoryMfaGate`. |
| A.8.3 Information access restriction | Implemented | RLS policies scope every table to the requesting user's own data or their counterparty in a booking; admin/support see broader read access via explicit policies, never a blanket bypass. |
| A.8.5 Secure authentication | Implemented | Supabase Auth's built-in rate limiting on login/signup; MFA available to all users, mandatory for staff. |
| A.8.8 Vulnerability management | Partial | `npm audit` run and clean (0 vulnerabilities) as of this analysis; no continuous/automated dependency scanning configured (e.g. Dependabot) — a cheap addition worth doing. |
| A.8.9 Configuration management | Partial (fixed this session) | Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) added to `vercel.json` 2026-07-23 — previously absent entirely. |
| A.8.12 Data leakage prevention | Implemented | Storage buckets split by sensitivity: `user-verification`/`vehicle-documents`/`dispute-evidence` are private (signed-URL access only), `car-images`/`avatars` are public by design. |
| A.8.15 Logging | Implemented | `audit_trail` table records every state-changing admin/business action with actor, action, entity, and details. Not yet paired with alerting (see A.5.24 above). |
| A.8.16 Monitoring activities | Not implemented | No anomaly detection or alerting on the audit trail; `get_cron_health()` gives visibility into scheduled-job health but nothing pages anyone. |
| A.8.20–8.23 Network/web security | Partial | HTTPS enforced by both hosting providers by default; CSP added this session; no WAF or DDoS protection beyond what Vercel/Supabase provide at the platform level. |
| A.8.24 Use of cryptography | Implemented | No card data touches this system directly — PayMongo's hosted checkout handles PCI scope entirely. Password hashing delegated to Supabase Auth (industry-standard, not custom). |
| A.8.25–8.29 Secure development lifecycle | Partial | No dynamic SQL/string-built queries anywhere (checked — grep found zero instances of `EXECUTE format()`-style injection risk). No formal SAST/DAST pipeline; `oxlint` runs as the only static check. |
| A.8.28 Secure coding | Implemented | All business-logic writes gated through RLS + SECURITY DEFINER RPCs; direct table writes disabled for sensitive tables (bookings, payments, audit_trail have no client INSERT/UPDATE policies at all). |

---

## Summary

**Genuinely strong**: access control architecture (RLS + RPC-gated writes), privileged
account MFA, storage bucket sensitivity separation, and audit logging coverage for
business actions — these would hold up reasonably well even outside a capstone
context.

**Real, acknowledged gaps**: no incident response process, no active monitoring/
alerting on the audit trail, no automated dependency scanning, and no periodic
access review cadence. These are honestly out of proportion to build for a
project with no real operations team — noting them here as known limitations is
more valuable, and more honest, than building performative versions of them.
