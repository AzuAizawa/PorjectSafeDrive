-- SafeDrive 2.0 — surface ratings on both sides of a booking.
--
-- Two real gaps found while wiring up avatars: (1) there was no cheap way to
-- get just "average rating + count" for a profile without pulling every
-- individual review (get_visible_reviews_for_owner returns full rows), and
-- (2) reviews only ever flowed renter -> owner (My Bookings has "Rate this
-- rental"); owners had no way to rate a renter, so a renter's rating was
-- always empty/hidden by construction, not just by the blind-review timer.
-- This adds the summary RPC and nothing else needed on the DB side for the
-- reciprocal flow — reviews.insert already allows either direction (checks
-- reviewee_id is the renter OR owner of the booking, reviewee <> self).
--
-- Reuses the exact same "both submitted, or 14 days since completion"
-- visibility rule as get_visible_reviews_for_owner (024) so this can't be
-- used to leak a review early via a shortcut aggregate query.

create or replace function get_rating_summary(p_profile_id uuid)
returns table (avg_rating numeric, rating_count integer)
language sql stable security definer set search_path = public as $$
  select coalesce(avg(r.rating), 0)::numeric(3,2), count(*)::integer
  from reviews r
  join bookings b on b.id = r.booking_id
  where r.reviewee_id = p_profile_id
    and r.is_hidden = false
    and (
      (select count(*) from reviews r2 where r2.booking_id = r.booking_id) = 2
      or (b.completed_at is not null and now() > b.completed_at + (get_setting_int('review_blind_days') || ' days')::interval)
    );
$$;

grant execute on function get_rating_summary(uuid) to authenticated, anon;
