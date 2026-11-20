-- SpendNote: per-user expense data, sync support, and Authentica email-OTP sign-in support.
--
-- Data model notes
-- * Every row belongs to one auth user (user_id) and is only visible to that user (RLS).
-- * Row ids are generated on the device (e.g. "tx_ab12…") so the app works offline; the primary
--   key is (user_id, id), so ids can never collide between users.
-- * Money is stored as bigint minor units (pesewas), never floating point.
-- * Deletes are soft (deleted_at) so other devices learn about them when they sync.
-- * server_updated_at is set by the database on every write and is what devices use as their
--   "changes since" cursor. updated_at is the device's edit time and decides conflicts:
--   an older edit that arrives late never overwrites a newer one (last write wins).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger: stamp server_updated_at and ignore stale (older) edits
-- ---------------------------------------------------------------------------
create or replace function private.stamp_and_keep_newest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    -- A slower device sent an older version of this row. Keep the newer one.
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.categories (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null check (char_length(id) between 1 and 100),
  name              text        not null check (char_length(btrim(name)) between 1 and 40),
  icon              text        not null check (char_length(icon) between 1 and 40),
  color             text        not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  built_in          boolean     not null default false,
  sort_order        integer     not null default 50,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table public.accounts (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null check (char_length(id) between 1 and 100),
  name              text        not null check (char_length(btrim(name)) between 1 and 60),
  method            text        not null check (method in ('cash', 'momo', 'bank', 'card', 'other')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table public.transactions (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null check (char_length(id) between 1 and 100),
  type              text        not null check (type in ('expense', 'income', 'transfer')),
  amount            bigint      not null check (amount > 0 and amount <= 99999999999),
  fee               bigint      not null default 0 check (fee >= 0 and fee <= 99999999999),
  tx_date           date        not null,
  tx_time           text        check (tx_time is null or tx_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  category_id       text        not null default 'other' check (char_length(category_id) between 1 and 100),
  method            text        not null check (method in ('cash', 'momo', 'bank', 'card', 'other')),
  comment           text        not null default '' check (char_length(comment) <= 2000),
  payee             text        not null default '' check (char_length(payee) <= 120),
  account_id        text        check (account_id is null or char_length(account_id) <= 100),
  to_account_id     text        check (to_account_id is null or char_length(to_account_id) <= 100),
  import_ref        text        check (import_ref is null or char_length(import_ref) <= 100),
  source_text       text        check (source_text is null or char_length(source_text) <= 5000),
  reviewed          boolean     not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id),
  -- A transfer can't go from an account to itself.
  constraint transfer_accounts_differ check (
    type <> 'transfer' or account_id is null or to_account_id is null or account_id <> to_account_id
  )
);

create table public.user_settings (
  user_id           uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  currency          text        not null default 'GHS' check (currency in ('GHS', 'NGN', 'KES', 'ZAR', 'USD', 'EUR', 'GBP')),
  onboarded         boolean     not null default false,
  reminder          jsonb       not null default '{"enabled": false, "weekday": 6, "time": "18:00"}'::jsonb
                                check (jsonb_typeof(reminder) = 'object'),
  reminder_ack_at   timestamptz,
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);

create index categories_sync_idx    on public.categories    (user_id, server_updated_at);
create index accounts_sync_idx      on public.accounts      (user_id, server_updated_at);
create index transactions_sync_idx  on public.transactions  (user_id, server_updated_at);
create index transactions_date_idx  on public.transactions  (user_id, tx_date) where deleted_at is null;

create trigger categories_stamp    before insert or update on public.categories    for each row execute function private.stamp_and_keep_newest();
create trigger accounts_stamp      before insert or update on public.accounts      for each row execute function private.stamp_and_keep_newest();
create trigger transactions_stamp  before insert or update on public.transactions  for each row execute function private.stamp_and_keep_newest();
create trigger user_settings_stamp before insert or update on public.user_settings for each row execute function private.stamp_and_keep_newest();

-- ---------------------------------------------------------------------------
-- Row level security: each user sees and changes only their own rows
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['categories', 'accounts', 'transactions', 'user_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy "own rows: read" on public.%I for select to authenticated
                     using ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "own rows: add" on public.%I for insert to authenticated
                     with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "own rows: change" on public.%I for update to authenticated
                     using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "own rows: remove" on public.%I for delete to authenticated
                     using ((select auth.uid()) = user_id)$p$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sign-in rate limits (used only by the auth-send-otp / auth-verify-otp Edge Functions)
-- Authentica charges per code sent, so sends are throttled per email and per IP address,
-- and wrong-code attempts are capped so codes can't be guessed.
-- ---------------------------------------------------------------------------
create table private.otp_events (
  id         bigint generated always as identity primary key,
  kind       text        not null check (kind in ('send', 'verify_fail')),
  email      text        not null,
  ip         text,
  created_at timestamptz not null default now()
);
create index otp_events_email_idx   on private.otp_events (email, kind, created_at desc);
create index otp_events_ip_idx      on private.otp_events (ip, kind, created_at desc);
create index otp_events_created_idx on private.otp_events (created_at);

-- Records a send if allowed. Returns {allowed, retry_after (seconds), reason}.
create or replace function public.otp_register_send(p_email text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cooldown constant interval := interval '60 seconds';
  last_send timestamptz;
  oldest    timestamptz;
  n         integer;
begin
  -- Serialise requests for the same email so two quick taps can't both slip through.
  perform pg_advisory_xact_lock(hashtextextended('otp:' || p_email, 0));

  -- Housekeeping: nothing older than two days is needed.
  delete from private.otp_events where created_at < now() - interval '2 days';

  select max(created_at) into last_send
    from private.otp_events where email = p_email and kind = 'send';
  if last_send is not null and last_send > now() - cooldown then
    return jsonb_build_object('allowed', false, 'reason', 'cooldown',
      'retry_after', ceil(extract(epoch from (last_send + cooldown - now())))::int);
  end if;

  select count(*), min(created_at) into n, oldest
    from private.otp_events where email = p_email and kind = 'send' and created_at > now() - interval '1 hour';
  if n >= 5 then
    return jsonb_build_object('allowed', false, 'reason', 'email_limit',
      'retry_after', ceil(extract(epoch from (oldest + interval '1 hour' - now())))::int);
  end if;

  if p_ip is not null then
    select count(*), min(created_at) into n, oldest
      from private.otp_events where ip = p_ip and kind = 'send' and created_at > now() - interval '1 hour';
    if n >= 20 then
      return jsonb_build_object('allowed', false, 'reason', 'ip_limit',
        'retry_after', ceil(extract(epoch from (oldest + interval '1 hour' - now())))::int);
    end if;
  end if;

  insert into private.otp_events (kind, email, ip) values ('send', p_email, p_ip);
  return jsonb_build_object('allowed', true, 'retry_after', extract(epoch from cooldown)::int);
end;
$$;

-- Whether another code check is allowed right now (5 wrong codes per email per 15 minutes,
-- 30 per IP address per hour).
create or replace function public.otp_verify_allowed(p_email text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  oldest timestamptz;
  n      integer;
begin
  select count(*), min(created_at) into n, oldest
    from private.otp_events where email = p_email and kind = 'verify_fail' and created_at > now() - interval '15 minutes';
  if n >= 5 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_attempts',
      'retry_after', ceil(extract(epoch from (oldest + interval '15 minutes' - now())))::int);
  end if;
  if p_ip is not null then
    select count(*), min(created_at) into n, oldest
      from private.otp_events where ip = p_ip and kind = 'verify_fail' and created_at > now() - interval '1 hour';
    if n >= 30 then
      return jsonb_build_object('allowed', false, 'reason', 'too_many_attempts',
        'retry_after', ceil(extract(epoch from (oldest + interval '1 hour' - now())))::int);
    end if;
  end if;
  return jsonb_build_object('allowed', true, 'retry_after', 0);
end;
$$;

create or replace function public.otp_register_verify_failure(p_email text, p_ip text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.otp_events (kind, email, ip) values ('verify_fail', p_email, p_ip);
$$;

-- After a successful sign-in, forget earlier wrong attempts for that email.
create or replace function public.otp_clear_failures(p_email text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.otp_events where email = p_email and kind = 'verify_fail';
$$;

revoke all on function public.otp_register_send(text, text)           from public, anon, authenticated;
revoke all on function public.otp_verify_allowed(text, text)          from public, anon, authenticated;
revoke all on function public.otp_register_verify_failure(text, text) from public, anon, authenticated;
revoke all on function public.otp_clear_failures(text)                from public, anon, authenticated;
grant execute on function public.otp_register_send(text, text)           to service_role;
grant execute on function public.otp_verify_allowed(text, text)          to service_role;
grant execute on function public.otp_register_verify_failure(text, text) to service_role;
grant execute on function public.otp_clear_failures(text)               to service_role;

-- ---------------------------------------------------------------------------
-- Auth hook: block Supabase's own sign-in emails
-- Sign-in codes come only from Authentica. Configured as [auth.hook.send_email] in config.toml
-- (and under Authentication → Hooks on a hosted project). Returning an error makes Supabase's
-- built-in magic links, email OTPs, invites and password resets fail instead of sending.
-- ---------------------------------------------------------------------------
create or replace function public.hook_block_builtin_auth_email(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'SpendNote sends sign-in codes through Authentica only.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_block_builtin_auth_email(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_block_builtin_auth_email(jsonb) from public, anon, authenticated;
