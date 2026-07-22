-- SafeDrive 2.0 — reviews display, implementing the blind-until-both-submit-
-- or-14-days decision (locked in during the capstone brainstorm, never
-- actually built — only submission via RateBookingDialog existed).
--
-- The blind rule needs to know *when* a booking completed. bookings.updated_at
-- isn't reliable for this (it bumps on any update, not specifically
-- completion), so add a dedicated completed_at column.

alter table bookings add column completed_at timestamptz;

create or replace function mark_complete(p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if auth.uid() not in (v_booking.renter_id, v_booking.owner_id) then raise exception 'not authorized'; end if;
  if v_booking.status <> 'active' then raise exception 'booking is not active'; end if;

  if auth.uid() = v_booking.renter_id then
    update bookings set renter_completed = true where id = p_booking_id;
  else
    update bookings set owner_completed = true where id = p_booking_id;
  end if;

  update bookings set status = 'completed', completed_at = now()
  where id = p_booking_id and renter_completed and owner_completed;

  perform log_audit(auth.uid(), 'booking_marked_complete', 'booking', p_booking_id, '{}'::jsonb);

  if (select status from bookings where id = p_booking_id) = 'completed' then
    perform notify_user(v_booking.renter_id, 'booking_completed', 'Your rental is complete. Please leave a review.', '/my-bookings', true);
    perform notify_user(v_booking.owner_id, 'booking_completed', 'Rental complete — payout will be processed by admin.', '/bookings-received', true);
  end if;
end;
$$;

create or replace function auto_complete_bookings()
returns void language plpgsql security definer set search_path = public as $$
begin
  update bookings b set
    renter_completed = true, owner_completed = true, status = 'completed', completed_at = now()
  where b.status = 'active'
    and (b.end_date + (get_setting_int('auto_complete_grace_days') || ' days')::interval) <= now()
    and not exists (select 1 from disputes d where d.booking_id = b.id and d.status = 'open');

  perform log_audit(null, 'bookings_auto_completed', 'booking', null,
                     jsonb_build_object('run_at', now()));
end;
$$;

insert into platform_settings (key, value, description) values
  ('review_blind_days', '14', 'Days after completion before a lone review becomes visible even without the other party having reviewed yet')
on conflict (key) do nothing;

-- Returns reviews visible for a given owner: either both parties on that
-- booking have reviewed, or the blind window has passed. Also used to
-- compute the average — kept consistent with the same visibility rule
-- rather than showing an aggregate built from reviews the list itself hides.
create or replace function get_visible_reviews_for_owner(p_owner_id uuid)
returns table (
  id uuid,
  rating integer,
  comment text,
  created_at timestamptz,
  reviewer_first_name text,
  reviewer_last_name text
)
language sql stable security definer set search_path = public as $$
  select r.id, r.rating, r.comment, r.created_at, p.first_name, p.last_name
  from reviews r
  join profiles p on p.id = r.reviewer_id
  join bookings b on b.id = r.booking_id
  where r.reviewee_id = p_owner_id
    and r.is_hidden = false
    and (
      (select count(*) from reviews r2 where r2.booking_id = r.booking_id) = 2
      or (b.completed_at is not null and now() > b.completed_at + (get_setting_int('review_blind_days') || ' days')::interval)
    )
  order by r.created_at desc;
$$;

grant execute on function get_visible_reviews_for_owner(uuid) to authenticated, anon;
