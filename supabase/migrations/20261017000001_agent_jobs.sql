-- Questions for the Mac agent: the phone queues them, Life Desk on the Mac runs Claude and posts the answer to the inbox.
-- Additive. Rollback: drop table public.agent_jobs;
create table public.agent_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  prompt      text not null check (char_length(prompt) between 1 and 2000),
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  finished_at timestamptz
);
create index agent_jobs_user_idx on public.agent_jobs (user_id, status, created_at);
alter table public.agent_jobs enable row level security;
revoke all on public.agent_jobs from anon, authenticated;
