-- life_sync must not undo what was done in the apps: edited rows keep their fields, deleted rows stay deleted. Additive.
-- Rollback: alter table public.assignments drop column edited_at; drop table public.sync_tombstones;
alter table public.assignments add column if not exists edited_at timestamptz;
create table if not exists public.sync_tombstones (
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'exam')),
  external_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, external_id)
);
alter table public.sync_tombstones enable row level security;
revoke all on public.sync_tombstones from anon, authenticated;
