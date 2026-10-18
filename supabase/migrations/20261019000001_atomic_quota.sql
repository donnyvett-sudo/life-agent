-- Atomic Gemini quota counters (per user per day, plus one per-deployment daily cap). Additive.
-- Rollback: drop function public.take_quota(uuid, text, date, date, int, int); drop table public.ai_quota, public.ai_quota_global;
create table public.ai_quota (
  user_id uuid not null references public.users(id) on delete cascade,
  kind    text not null check (kind in ('ai', 'meal')),
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, kind, day)
);
create table public.ai_quota_global (
  day   date primary key,
  count int not null default 0
);
alter table public.ai_quota enable row level security;
alter table public.ai_quota_global enable row level security;
revoke all on public.ai_quota, public.ai_quota_global from anon, authenticated;

-- Takes one unit: true if both the user's cap and the deployment's cap still had room. One statement per counter,
-- so concurrent calls cannot overshoot. If the global cap refuses, the user's unit is given back.
create or replace function public.take_quota(p_user uuid, p_kind text, p_day date, p_gday date, p_cap int, p_gcap int)
returns boolean language plpgsql security invoker set search_path = public as $$
declare got int;
begin
  insert into ai_quota as q (user_id, kind, day, count) values (p_user, p_kind, p_day, 1)
    on conflict (user_id, kind, day) do update set count = q.count + 1 where q.count < p_cap
    returning q.count into got;
  if got is null then return false; end if;
  insert into ai_quota_global as g (day, count) values (p_gday, 1)
    on conflict (day) do update set count = g.count + 1 where g.count < p_gcap
    returning g.count into got;
  if got is null then
    update ai_quota set count = count - 1 where user_id = p_user and kind = p_kind and day = p_day;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.take_quota(uuid, text, date, date, int, int) from public, anon, authenticated;
grant execute on function public.take_quota(uuid, text, date, date, int, int) to service_role;
