-- Read-only copies of the Study Agent files that the phone shows: notices, course info, files, chat sources, exam topics.
-- Filled by tools/life_sync.py through study-sync. Additive. Rollback: drop table public.study_docs;
create table public.study_docs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null check (kind in ('notice', 'course_info', 'file', 'source', 'exam_topics')),
  key         text not null,
  data        jsonb not null default '{}',
  seen_at     timestamptz,                    -- notices: read on any device; a sync never resets it
  updated_at  timestamptz not null default now(),
  unique (user_id, kind, key)
);
create index study_docs_user_kind_idx on public.study_docs (user_id, kind);
alter table public.study_docs enable row level security;
revoke all on public.study_docs from anon, authenticated;
