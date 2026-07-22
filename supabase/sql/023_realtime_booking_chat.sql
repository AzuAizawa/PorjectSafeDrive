-- SafeDrive 2.0 — enable Realtime for per-booking chat (the `messages`
-- table has had schema+RLS since 001/002, but was never added to the
-- realtime publication, and no UI ever called it — same gap pattern as
-- the Inquire chat before 013_realtime_support_chat.sql fixed it there.

alter publication supabase_realtime add table messages;
