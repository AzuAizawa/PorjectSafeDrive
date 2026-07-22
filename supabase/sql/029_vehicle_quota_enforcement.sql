-- SafeDrive 2.0 — actually enforce the free-vehicle-slot quota.
--
-- Real gap found on audit: `platform_settings.free_vehicle_slots` and the
-- whole subscription system existed (My Vehicles shows a progress bar,
-- confirm_subscription_payment() even reactivates 'paused_over_quota'
-- vehicles), but nothing ever SET a vehicle to paused_over_quota in the
-- first place. A lister could list unlimited vehicles for free.
--
-- Decision: enforce going forward only. Existing already-approved vehicles
-- are left exactly as they are (no retroactive pausing) — enforcement only
-- kicks in at the next approve_vehicle() call and via the new monthly
-- subscription-expiry check below.

create or replace function get_vehicle_slot_capacity(p_profile_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select get_setting_int('free_vehicle_slots')
    + coalesce((
        select sum(slots_granted) from subscriptions
        where profile_id = p_profile_id and status = 'active' and expires_at > now()
      ), 0)::integer;
$$;

grant execute on function get_vehicle_slot_capacity(uuid) to authenticated;

create or replace function approve_vehicle(p_vehicle_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_active_count int;
  v_capacity int;
  v_new_status text;
begin
  if not is_admin() then raise exception 'not authorized'; end if;

  select owner_id into v_owner from vehicles where id = p_vehicle_id;

  v_active_count := (
    select count(*) from vehicles
    where owner_id = v_owner and listing_status = 'active' and approval_status = 'approved'
  );
  v_capacity := get_vehicle_slot_capacity(v_owner);
  v_new_status := case when v_active_count >= v_capacity then 'paused_over_quota' else 'active' end;

  update vehicles set approval_status = 'approved', rejection_reason = null, listing_status = v_new_status
    where id = p_vehicle_id;

  perform log_audit(auth.uid(), 'vehicle_approved', 'vehicle', p_vehicle_id, jsonb_build_object('listing_status', v_new_status));
  perform notify_user(
    v_owner, 'vehicle_approved',
    case when v_new_status = 'paused_over_quota'
      then 'Your vehicle listing was approved, but you''re over your free slot limit — it''s paused until you free up a slot or subscribe.'
      else 'Your vehicle listing was approved and is now live.'
    end,
    '/my-vehicles', true
  );
end;
$$;

-- Monthly: mark lapsed subscriptions expired, then pause the most-recently-
-- activated vehicles back down to the owner's new (lower) capacity — the
-- exact mirror of confirm_subscription_payment()'s reactivate-by-recency.
create or replace function expire_lapsed_subscriptions()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub record;
  v_capacity int;
  v_active_count int;
  v_excess int;
begin
  for v_sub in
    update subscriptions set status = 'expired'
    where status = 'active' and expires_at <= now()
    returning profile_id
  loop
    v_capacity := get_vehicle_slot_capacity(v_sub.profile_id);
    v_active_count := (
      select count(*) from vehicles
      where owner_id = v_sub.profile_id and listing_status = 'active' and approval_status = 'approved'
    );
    v_excess := v_active_count - v_capacity;
    if v_excess > 0 then
      update vehicles set listing_status = 'paused_over_quota'
      where id in (
        select id from vehicles
        where owner_id = v_sub.profile_id and listing_status = 'active' and approval_status = 'approved'
        order by created_at desc
        limit v_excess
      );
      perform notify_user(
        v_sub.profile_id, 'subscription_expired',
        'Your subscription expired — ' || v_excess || ' vehicle(s) over your free limit have been paused.',
        '/my-vehicles', true
      );
    end if;
  end loop;
end;
$$;

select cron.schedule('expire-lapsed-subscriptions', '0 4 * * *', $$select expire_lapsed_subscriptions();$$);
