-- Identity without Telegram: a user may have no tg_id; devices are paired with a one-time code.
-- Additive. Rollback: drop table public.pairing_codes, public.devices;
--   alter table public.users alter column tg_id set not null;  (only while every user still has a tg_id)

alter table public.users alter column tg_id drop not null;

-- A paired client (iPhone app, PWA, Mac). The token it holds lives in api_tokens; revoking the token ends the device.
create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token_id    uuid references public.api_tokens(id) on delete set null,
  name        text not null,
  platform    text not null check (platform in ('ios', 'pwa', 'mac', 'other')),
  push        jsonb,                      -- Web Push subscription (PWA), null otherwise
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
create index devices_user_idx on public.devices (user_id);

-- One-time pairing code: only a SHA-256 is stored, valid for 10 minutes, scopes decided when it is created.
create table public.pairing_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  code_hash   text not null unique,
  scopes      text[] not null default '{app,ingest}',
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index pairing_codes_user_idx on public.pairing_codes (user_id);

alter table public.devices enable row level security;
alter table public.pairing_codes enable row level security;
revoke all on public.devices from anon, authenticated;
revoke all on public.pairing_codes from anon, authenticated;
