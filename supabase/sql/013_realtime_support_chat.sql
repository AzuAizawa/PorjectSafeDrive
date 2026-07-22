-- SafeDrive 2.0 — enable Realtime for the Inquire chat
-- RLS controls *who* can read a row; the realtime publication controls
-- whether Postgres broadcasts change events for a table at all. Without
-- this, supabase.channel(...).on('postgres_changes', ...) subscriptions
-- silently never fire — no error, they just never receive anything.

alter publication supabase_realtime add table support_messages;
alter publication supabase_realtime add table support_conversations;
