-- SafeDrive 2.0 — let the support role handle Inquire conversations too.
-- Answering general questions is squarely a support-tier job; the original
-- 012 migration only checked is_admin() since the support role didn't
-- exist yet at that point.

drop policy support_conversations_select on support_conversations;
create policy support_conversations_select on support_conversations
  for select using (user_id = auth.uid() or is_support_or_admin());

drop policy support_conversations_admin_update on support_conversations;
create policy support_conversations_admin_update on support_conversations
  for update using (is_support_or_admin());

drop policy support_messages_select on support_messages;
create policy support_messages_select on support_messages
  for select using (
    is_support_or_admin() or exists (select 1 from support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

drop policy support_messages_insert on support_messages;
create policy support_messages_insert on support_messages
  for insert with check (
    sender_id = auth.uid()
    and (
      is_support_or_admin()
      or exists (select 1 from support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
    )
  );

create or replace function mark_support_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if is_support_or_admin() then
    update support_conversations set admin_last_read_at = now() where id = p_conversation_id;
  else
    update support_conversations set user_last_read_at = now()
    where id = p_conversation_id and user_id = auth.uid();
  end if;
end;
$$;
