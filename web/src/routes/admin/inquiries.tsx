import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { friendlyErrorMessage } from '@/lib/friendly-error';
import type { Message as SupportMessage, Profile } from '@/lib/database.types';

interface ConversationRow {
  id: string;
  user_id: string;
  last_message_at: string;
  admin_last_read_at: string | null;
  user: Pick<Profile, 'first_name' | 'last_name' | 'email'>;
}

async function fetchConversations() {
  const { data, error } = await supabase
    .from('support_conversations')
    .select('*, user:profiles(first_name, last_name, email)')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return data as unknown as ConversationRow[];
}

async function fetchMessages(conversationId: string) {
  const { data, error } = await supabase
    .from('support_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at');
  if (error) throw error;
  return data as SupportMessage[];
}

export function AdminInquiriesPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useQuery({ queryKey: ['admin-inquiries'], queryFn: fetchConversations });
  const { data: messages } = useQuery({
    queryKey: ['admin-inquiry-messages', selectedId],
    queryFn: () => fetchMessages(selectedId!),
    enabled: !!selectedId,
  });

  useEffect(() => {
    const channel = supabase
      .channel('admin-inquiries-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, () => {
        queryClient.invalidateQueries({ queryKey: ['admin-inquiries'] });
        if (selectedId) queryClient.invalidateQueries({ queryKey: ['admin-inquiry-messages', selectedId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  function openConversation(id: string) {
    setSelectedId(id);
    supabase.rpc('mark_support_read', { p_conversation_id: id }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['admin-inquiries'] });
    });
  }

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('support_messages')
        .insert({ conversation_id: selectedId, sender_id: profile!.id, message: text });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['admin-inquiry-messages', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['admin-inquiries'] });
    },
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Admin</div>
        <h1 className="text-2xl">Inquiries</h1>
        <p className="mt-1.5 text-muted">General questions from users — separate from booking disputes.</p>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-5">
        <div className="rounded-2xl border border-line bg-surface">
          {conversations?.map((c) => {
            const unread = !c.admin_last_read_at || new Date(c.admin_last_read_at) < new Date(c.last_message_at);
            return (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`block w-full border-b border-line px-4 py-3 text-left last:border-none hover:bg-surface-2 ${
                  selectedId === c.id ? 'bg-accent-soft' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{c.user.first_name ?? c.user.email} {c.user.last_name ?? ''}</span>
                  {unread ? <Pill tone="warn">New</Pill> : null}
                </div>
                <div className="text-xs text-muted">{new Date(c.last_message_at).toLocaleString()}</div>
              </button>
            );
          })}
          {conversations?.length === 0 ? <p className="p-6 text-center text-sm text-muted">No inquiries yet.</p> : null}
        </div>

        {selectedId ? (
          <Card className="flex h-[560px] flex-col p-5">
            <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
              {messages?.map((m) => {
                const isAdmin = m.sender_id === profile?.id;
                return (
                  <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm ${isAdmin ? 'bg-accent text-white' : 'bg-surface-2 text-ink'}`}>
                      {m.message}
                      <div className={`mt-0.5 text-[10px] ${isAdmin ? 'text-white/70' : 'text-muted'}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form
              className="mt-3 flex gap-2 border-t border-line pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) send.mutate();
              }}
            >
              <input className="input-base flex-1" placeholder="Reply…" value={text} onChange={(e) => setText(e.target.value)} />
              <Button type="submit" disabled={!text.trim() || send.isPending}>Send</Button>
            </form>
            {send.isError ? <p className="mt-1.5 text-xs text-bad">{friendlyErrorMessage(send.error)}</p> : null}
          </Card>
        ) : (
          <div className="grid h-[560px] place-items-center text-muted">Select a conversation to reply.</div>
        )}
      </div>
    </div>
  );
}
