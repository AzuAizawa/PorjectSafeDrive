import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Message as SupportMessage } from '@/lib/database.types';

async function fetchOrCreateConversation() {
  const { data, error } = await supabase.rpc('get_or_create_support_conversation');
  if (error) throw error;
  return data as string;
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

export function InquirePage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversationId } = useQuery({
    queryKey: ['support-conversation-id'],
    queryFn: fetchOrCreateConversation,
  });
  const { data: messages } = useQuery({
    queryKey: ['support-messages', conversationId],
    queryFn: () => fetchMessages(conversationId!),
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    supabase.rpc('mark_support_read', { p_conversation_id: conversationId });

    const channel = supabase
      .channel(`support-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${conversationId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['support-messages', conversationId] });
          supabase.rpc('mark_support_read', { p_conversation_id: conversationId });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('support_messages')
        .insert({ conversation_id: conversationId, sender_id: profile!.id, message: text });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['support-messages', conversationId] });
    },
  });

  return (
    <div>
      <div className="mb-5">
        <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-accent">Support</div>
        <h1 className="text-2xl">Inquire</h1>
        <p className="mt-1.5 text-muted">
          Ask a general question — for a problem with a specific booking, use "Report an Issue" on that booking instead.
        </p>
      </div>

      <Card className="flex h-[560px] max-w-2xl flex-col p-5">
        <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
          {messages?.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">
              Send a message and SafeDrive support will get back to you here.
            </p>
          ) : null}
          {messages?.map((m) => {
            const mine = m.sender_id === profile?.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-lg px-3 py-2 text-sm ${
                    mine ? 'bg-accent text-white' : 'bg-surface-2 text-ink'
                  }`}
                >
                  {m.message}
                  <div className={`mt-0.5 text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>
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
          <input
            className="input-base flex-1"
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" disabled={!text.trim() || send.isPending}>
            Send
          </Button>
        </form>
      </Card>
    </div>
  );
}
