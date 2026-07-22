-- SafeDrive 2.0 — "Inquire" general support chat
-- Deliberately separate from disputes (which are booking-scoped tickets
-- with status/resolution/refund). This is one continuous conversation per
-- user with admin, matching the live-chat product pattern (Intercom/
-- Zendesk Chat/WhatsApp Business) rather than a ticketing pattern — see
-- decisions doc addendum for the reasoning.

create table support_conversations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references profiles(id) on delete cascade,
  created_at          timestamptz not null default now(),
  last_message_at     timestamptz not null default now(),
  user_last_read_at   timestamptz not null default now(),
  admin_last_read_at  timestamptz
);

create table support_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references support_conversations(id) on delete cascade,
  sender_id        uuid not null references profiles(id),
  message          text not null,
  created_at       timestamptz not null default now()
);

create index idx_support_messages_conversation on support_messages(conversation_id, created_at);
create index idx_support_conversations_last_message on support_conversations(last_message_at desc);

-- ============================================================
-- RLS
-- ============================================================
alter table support_conversations enable row level security;
alter table support_messages enable row level security;

create policy support_conversations_select on support_conversations
  for select using (user_id = auth.uid() or is_admin());

create policy support_conversations_admin_update on support_conversations
  for update using (is_admin());

create policy support_messages_select on support_messages
  for select using (
    is_admin() or exists (select 1 from support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );

create policy support_messages_insert on support_messages
  for insert with check (
    sender_id = auth.uid()
    and (
      is_admin()
      or exists (select 1 from support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
    )
  );

-- ============================================================
-- Functions
-- ============================================================
create or replace function get_or_create_support_conversation()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from support_conversations where user_id = auth.uid();
  if v_id is null then
    insert into support_conversations (user_id) values (auth.uid()) returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function mark_support_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then
    update support_conversations set admin_last_read_at = now() where id = p_conversation_id;
  else
    update support_conversations set user_last_read_at = now()
    where id = p_conversation_id and user_id = auth.uid();
  end if;
end;
$$;

create or replace function bump_conversation_last_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update support_conversations set last_message_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger trg_bump_conversation_last_message
  after insert on support_messages
  for each row execute function bump_conversation_last_message();

grant execute on function get_or_create_support_conversation() to authenticated;
grant execute on function mark_support_read(uuid) to authenticated;
