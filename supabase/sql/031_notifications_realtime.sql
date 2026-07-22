-- SafeDrive 2.0 — the `notifications` table has been populated by every
-- major event since the very first migration, but nothing ever added it to
-- the realtime publication (same easy-to-miss gap already hit twice before
-- with support_messages/messages) or built a frontend to read it at all.
-- This is the DB-side half of the in-app notification bell.

alter publication supabase_realtime add table notifications;
