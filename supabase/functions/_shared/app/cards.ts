// Карточки по HTTP: та же сессия дня, что в боте (user.state.cards), но без сообщений Telegram.
// Приложение получает текущую карточку с вариантами и отвечает по значению, а не по индексу кнопки.
import { claimEvent } from "../coach.ts";
import {
  type Card, ensureSession, nextBox, pickDistractors, sayable, type Session, saveSession, shuffle, todays, toPinyin, tts,
} from "../cards.ts";
import { check, db, type User } from "../db.ts";
import { localNow } from "../time.ts";
import { HttpError } from "./finance.ts";

type Body = Record<string, unknown>;
const re = (c: Card) => ({ front: c.front, reading: c.reading, meaning: c.meaning, example: c.example });

async function view(user: User, s: Session | null) {
  if (!s) return { state: "none" };
  if (s.done || s.pos >= s.queue.length) return { state: "done", right: s.right, total: s.queue.length, shadow: await shadow(user, s) };
  const id = s.queue[s.pos];
  const base = { state: "active", pos: s.pos, total: s.queue.length, id };
  if (id.startsWith("s")) {
    const sit = s.sits[Number(id.slice(1))];
    return { ...base, kind: "situation", q: sit.q, options: sit.opts.map((h) => ({ text: h, hint: toPinyin(h) })) };
  }
  const c = check(await db.from("flashcards").select("*").eq("id", id).eq("user_id", user.id).maybeSingle()) as Card | null;
  if (!c || c.status === "archived") { // убрали посреди дня: пропускаем
    return view(user, await step(user, s, false));
  }
  const pool = check(await db.from("flashcards").select("meaning,deck").eq("user_id", user.id).neq("id", c.id).limit(80)) as { meaning: string; deck: string }[];
  const options = shuffle([c.meaning, ...pickDistractors(c, pool)]);
  return { ...base, kind: "word", front: c.front, reading: c.reading, options: options.map((text) => ({ text })) };
}

async function step(user: User, s: Session, correct: boolean): Promise<Session> {
  const next: Session = { ...s, pos: s.pos + 1, right: s.right + (correct ? 1 : 0) };
  if (next.pos >= next.queue.length) {
    next.done = true;
    await claimEvent(user, "cards_done", next.date); // по этим отметкам считается чек-ин
  }
  await saveSession(user, next);
  return next;
}

/** Примеры к новым словам дня для повторения вслух. */
async function shadow(user: User, s: Session) {
  if (!s.fresh.length) return [];
  const rows = check(await db.from("flashcards").select("id,example").eq("user_id", user.id).in("id", s.fresh)) as { id: string; example: string | null }[];
  return rows.filter((r) => sayable(r.example ?? "")).slice(0, 5).map((r) => ({ id: r.id, text: r.example, pinyin: toPinyin(r.example!) }));
}

export async function cardsSession(user: User) {
  return view(user, await ensureSession(user));
}

/** body: {id, choice} — choice это текст значения (слово) или индекс/текст варианта (ситуация). */
export async function cardAnswer(user: User, b: Body) {
  const s = todays(user);
  const id = String(b.id ?? "");
  const choice = String(b.choice ?? "").trim();
  if (!s || s.done || s.queue[s.pos] !== id) throw new HttpError(409, "stale card");
  if (id.startsWith("s")) {
    const sit = s.sits[Number(id.slice(1))];
    const right = sit.opts[sit.a];
    const ok = choice === right;
    check(await db.from("flashcard_reviews").insert({ user_id: user.id, correct: ok, note: sit.q }));
    return { correct: ok, reveal: { front: right, reading: toPinyin(right), meaning: sit.q, example: null }, next: await view(user, await step(user, s, ok)) };
  }
  const c = check(await db.from("flashcards").select("*").eq("id", id).eq("user_id", user.id).maybeSingle()) as Card | null;
  if (!c) throw new HttpError(404, "no such card");
  const ok = choice.toLowerCase() === c.meaning.trim().toLowerCase();
  const { box, next } = nextBox(c.box, ok, localNow(user.tz).date);
  const { count } = await db.from("flashcards").update({ box, next_review: next, status: "learning" }, { count: "exact" })
    .eq("id", c.id).eq("box", c.box).eq("next_review", c.next_review); // защита от двойного нажатия
  if (!count) throw new HttpError(409, "already answered");
  check(await db.from("flashcard_reviews").insert({ user_id: user.id, card_id: c.id, correct: ok, box_after: box }));
  return { correct: ok, reveal: re(c), next: await view(user, await step(user, s, ok)) };
}

/** Озвучка слова или примера: mp3 в base64 (ответ API всегда JSON). Только карточки пользователя, произвольный текст не озвучиваем. */
export async function cardAudio(user: User, id: string | null, part: string | null) {
  const c = id && /^[0-9a-f-]{36}$/.test(id)
    ? check(await db.from("flashcards").select("front,example").eq("id", id).eq("user_id", user.id).maybeSingle()) as { front: string; example: string | null } | null
    : null;
  const say = sayable((part === "example" ? c?.example : c?.front) ?? "");
  if (!say) throw new HttpError(404, "nothing to say");
  const bytes = await tts(say);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mp3: btoa(bin) };
}
