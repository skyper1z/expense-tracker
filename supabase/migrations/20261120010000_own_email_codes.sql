-- SpendNote: sign-in codes are generated and checked by SpendNote itself.
-- The auth-send-otp function creates a 6-digit code, stores only a keyed hash of it here, and emails
-- the code through a free email API (Brevo or Resend). auth-verify-otp checks it here.
-- Codes expire after 10 minutes, work once, and allow 5 wrong tries. Only the latest code for an
-- email is valid.

create table private.otp_codes (
  email      text        primary key,
  code_hash  text        not null,
  expires_at timestamptz not null,
  attempts   integer     not null default 0,
  created_at timestamptz not null default now()
);

-- Saves a new code for this email, replacing any earlier one.
create or replace function public.otp_store_code(p_email text, p_code_hash text, p_ttl_seconds integer)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.otp_codes where expires_at < now() - interval '1 day';
  insert into private.otp_codes (email, code_hash, expires_at, attempts, created_at)
  values (p_email, p_code_hash, now() + make_interval(secs => p_ttl_seconds), 0, now())
  on conflict (email) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = now();
$$;

-- Checks a code: 'valid' (and uses it up), 'invalid', 'expired', 'missing' or 'locked'.
create or replace function public.otp_check_code(p_email text, p_code_hash text, p_max_attempts integer default 5)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r private.otp_codes%rowtype;
begin
  select * into r from private.otp_codes where email = p_email for update;
  if not found then
    return 'missing';
  end if;
  if r.expires_at <= now() then
    delete from private.otp_codes where email = p_email;
    return 'expired';
  end if;
  if r.attempts >= p_max_attempts then
    return 'locked';
  end if;
  if r.code_hash = p_code_hash then
    delete from private.otp_codes where email = p_email; -- single use
    return 'valid';
  end if;
  update private.otp_codes set attempts = attempts + 1 where email = p_email;
  return 'invalid';
end;
$$;

revoke all on function public.otp_store_code(text, text, integer) from public, anon, authenticated;
revoke all on function public.otp_check_code(text, text, integer) from public, anon, authenticated;
grant execute on function public.otp_store_code(text, text, integer) to service_role;
grant execute on function public.otp_check_code(text, text, integer) to service_role;

-- Updated wording now that Authentica is no longer used.
create or replace function public.hook_block_builtin_auth_email(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'SpendNote sends its own sign-in codes; Supabase sign-in emails are turned off.'
    )
  );
end;
$$;
