-- SafeDrive 2.0 — Subscription payment confirmation (decisions doc §6.5, §10)
-- Missing from 003_functions.sql — needed now that the PayMongo webhook
-- handler needs somewhere to call for a completed subscription payment.

create or replace function confirm_subscription_payment(p_profile_id uuid, p_paymongo_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slots int := get_setting_int('subscription_slots');
  v_price numeric := get_setting_numeric('subscription_price');
  v_sub_id uuid;
begin
  insert into subscriptions (profile_id, slots_granted, status, started_at, expires_at, paymongo_reference)
  values (p_profile_id, v_slots, 'active', now(), now() + interval '1 month', p_paymongo_ref)
  returning id into v_sub_id;

  insert into payments (subscription_id, payer_id, payment_type, amount, paymongo_reference, status)
  values (v_sub_id, p_profile_id, 'subscription', v_price, p_paymongo_ref, 'succeeded');

  -- reactivate the most-recently-paused over-quota vehicles up to the new slot count
  update vehicles set listing_status = 'active'
  where id in (
    select id from vehicles
    where owner_id = p_profile_id and listing_status = 'paused_over_quota'
    order by updated_at desc
    limit v_slots
  );

  perform log_audit(p_profile_id, 'subscription_purchased', 'subscription', v_sub_id,
                     jsonb_build_object('slots_granted', v_slots, 'paymongo_ref', p_paymongo_ref));
  perform notify_user(p_profile_id, 'subscription_active', 'Your subscription is active — extra vehicle slots unlocked.', '/my-vehicles', true);
end;
$$;

-- Called only by the webhook handler via the service_role key (bypasses grants),
-- but grant to authenticated too in case a future admin/manual-confirm path needs it.
grant execute on function confirm_subscription_payment(uuid, text) to authenticated;
