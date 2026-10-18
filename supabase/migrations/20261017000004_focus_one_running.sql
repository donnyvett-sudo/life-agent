-- One running focus session per user: two devices starting at once can no longer create two. Additive.
-- Rollback: drop index public.focus_sessions_one_running;
create unique index if not exists focus_sessions_one_running on public.focus_sessions (user_id) where status = 'running';
