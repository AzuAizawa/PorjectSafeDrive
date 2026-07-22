import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import type { Message } from '@/lib/database.types';

async function fetchMessages(bookingId: string) {
  const { data, error } = await supabase.from('messages').select('*').eq('booking_id', bookingId).order('created_at');
  if (error) throw error;
  return data as Message[];
}

export function BookingChat({ bookingId, currentUserId }: { bookingId: string; currentUserId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({ queryKey: ['booking-messages', bookingId], queryFn: () => fetchMessages(bookingId) });

  useEffect(() => {
    const channel = supabase
      .channel(`booking-chat-${bookingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
        () => queryClient.invalidateQueries({ queryKey: ['booking-messages', bookingId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookingId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('messages').insert({ booking_id: bookingId, sender_id: currentUserId, message: text });
      if (error) throw error;
    },
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['booking-messages', bookingId] });
    },
  });

  return (
    <div className="mt-3 rounded-md border border-line bg-surface-2 p-3">
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {messages?.length === 0 ? <p className="py-4 text-center text-xs text-muted">No messages yet — say hello.</p> : null}
        {messages?.map((m) => {
          const mine = m.sender_id === currentUserId;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-lg px-2.5 py-1.5 text-xs ${mine ? 'bg-accent text-white' : 'bg-surface text-ink'}`}>
                {m.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send.mutate();
        }}
      >
        <input
          className="input-base h-8 flex-1 text-xs"
          placeholder="Message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!text.trim() || send.isPending}>
          Send
        </Button>
      </form>
    </div>
  );
}
