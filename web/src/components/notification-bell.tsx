import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn, formatTimeAgo } from '@/lib/utils';
import type { Notification } from '@/lib/database.types';

async function fetchNotifications(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data as Notification[];
}

// The `notifications` table has been populated by every major event since
// the first migration (booking accepted, payment received, verification
// reviewed, etc.) but nothing ever read it — this is the missing frontend.
export function NotificationBell({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => fetchNotifications(userId),
  });
  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => queryClient.invalidateQueries({ queryKey: ['notifications', userId] })
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', userId] }),
  });

  function handleClick(n: Notification) {
    if (!n.read) markRead.mutate([n.id]);
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  return (
    <div className="relative">
      <button
        className="relative grid h-8.5 w-8.5 place-items-center rounded-full border border-line bg-surface/80 text-base hover:-translate-y-px hover:shadow-md"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-4 w-4" strokeWidth={2.25} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass animate-[dropdown-in_160ms_cubic-bezier(0.22,1,0.36,1)] absolute right-0 top-11 z-50 max-h-96 w-80 overflow-y-auto rounded-xl border border-line/70 shadow-xl">
            <div className="flex items-center justify-between border-b border-line/70 p-3">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">Notifications</span>
              {unreadCount > 0 ? (
                <button
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={() => markRead.mutate(notifications!.filter((n) => !n.read).map((n) => n.id))}
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            {!notifications || notifications.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'block w-full border-b border-line/50 p-3 text-left text-[13px] last:border-none hover:bg-surface-2',
                    !n.read && 'bg-accent-soft/40'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.read ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />}
                    <div className="flex-1">
                      <p className={!n.read ? 'font-semibold' : 'text-muted'}>{n.message}</p>
                      <p className="mt-0.5 text-[11px] text-muted-2">{formatTimeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
