-- The inbox: everything the coach says, kept in the database so any client can show it (app, PWA, Mac).
-- Additive. Rollback: drop table public.inbox; alter table public.users drop column notify_telegram;

create table public.inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null default 'coach',          -- coach | reminder | penalty | reward | card | system
  title       text,
  body        text not null,                          -- markdown-lite: **bold**, _italic_, `code`, [text](url), lists
  actions     jsonb not null default '[]',            -- [{id, label, style?, url?}], id is the action id for POST /actions
  ref         text,                                   -- what the message is about (reminder id, ledger id ...)
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  handled_at  timestamptz                             -- an action was taken: the buttons are gone
);
create index inbox_user_idx on public.inbox (user_id, created_at desc);

alter table public.inbox enable row level security;
revoke all on public.inbox from anon, authenticated;

-- Telegram stays a delivery channel until the owner switches it off per user.
alter table public.users add column notify_telegram boolean not null default true;
