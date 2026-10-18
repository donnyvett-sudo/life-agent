-- A line in the Feed may answer a specific earlier message (swipe to reply). Additive.
-- Rollback: alter table public.inbox drop column reply_to;
alter table public.inbox add column if not exists reply_to uuid references public.inbox(id) on delete set null;
