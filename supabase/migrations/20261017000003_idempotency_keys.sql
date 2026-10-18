-- A retried POST (timeout, lost response) carries the same Idempotency-Key and gets the first answer instead of running twice. Additive.
-- Rollback: drop table public.idempotency_keys;
create table public.idempotency_keys (
  user_id    uuid not null references public.users(id) on delete cascade,
  key        text not null check (char_length(key) between 8 and 80),
  response   jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index idempotency_keys_age_idx on public.idempotency_keys (created_at);
alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from anon, authenticated;
