-- Карточки v2: ежедневная сессия из 5 новых слов, ядро «разговорных» слов chinese1,
-- озвучка (file_id голосового в Telegram как кэш), ситуационные карточки и чек-ин.

alter table public.flashcards
  add column status text not null default 'new' check (status in ('new', 'learning', 'archived')),
  add column intro_order integer,
  add column audio_file_id text;

-- Ситуационные карточки не живут в Лейтнере: пишем только факт ответа, без карточки.
alter table public.flashcard_reviews
  alter column card_id drop not null,
  alter column box_after drop not null,
  add column note text;

-- Слова, добавленные раньше вне chinese1, уже были в повторении.
update public.flashcards set status = 'learning' where deck <> 'chinese1';

-- chinese1: в работе только ядро из 28 слов, остальное в архиве.
update public.flashcards set status = 'archived' where deck = 'chinese1';
update public.flashcards f
set status = 'new', box = 1, intro_order = u.ord
from unnest(array[
  'L10-002', 'L10-003', 'L10-006', 'L10-007', 'L10-008', 'L10-013', 'L10-012', 'L10-020', 'L10-021', 'L10-025',
  'L10-019', 'L10-018', 'L10-009', 'L10-027', 'L10-032', 'L10-035', 'L10-040', 'L10-053', 'L10-030', 'L10-051',
  'L11-001', 'L11-007', 'L11-008', 'L11-009', 'L11-015', 'L11-021', 'L11-022', 'L11-025'
]) with ordinality as u(id, ord)
where f.deck = 'chinese1' and f.external_id = 'sa:card:' || u.id;

-- Свободные ответы на вопросы бота (чек-ин карточек и т.п.), чтобы прочитать позже.
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  topic       text not null,
  text        text not null,
  created_at  timestamptz not null default now()
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
