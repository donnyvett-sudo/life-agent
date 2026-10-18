// One counter for every Gemini call: chat, voice transcription, money phrases, meal photos, the weekly summary.
// Counted per person per local day AND per deployment per UTC day (GEMINI_DAILY_CAP), atomically in Postgres (take_quota).
// The free tier is shared by everyone; the deployment cap is the backstop against a runaway bill.
import { db, type User } from "./db.ts";
import { t } from "./i18n.ts";
import { localNow } from "./time.ts";

// One understanding call per message plus the coach for questions: 60 a day covers a busy day on the free tier.
export const DAILY_AI = 60;
// Meals are counted separately: lunch photos must not eat the coach and voice limit.
export const DAILY_MEAL_AI = 20;

/** Per-deployment daily cap on all Gemini calls (env GEMINI_DAILY_CAP, default 500). */
export function globalCap(): number {
  const n = Number(Deno.env.get("GEMINI_DAILY_CAP"));
  return Number.isInteger(n) && n > 0 ? n : 500;
}

export type TakeRpc = (args: Record<string, unknown>) => Promise<boolean>;

const dbRpc: TakeRpc = async (args) => {
  const { data, error } = await db.rpc("take_quota", args);
  if (error) throw new Error(`take_quota: ${error.message}`); // fail closed: no counter, no Gemini call
  return data === true;
};

/** Takes one unit of `kind` for the user. false: a limit is exhausted, Gemini must not be called. */
export function takeQuota(user: User, kind: "ai" | "meal", cap: number, rpc: TakeRpc = dbRpc, now = new Date()): Promise<boolean> {
  return rpc({
    p_user: user.id,
    p_kind: kind,
    p_day: localNow(user.tz).date,
    p_gday: now.toISOString().slice(0, 10),
    p_cap: cap,
    p_gcap: globalCap(),
  });
}

/** Counted before the call: better to waste a unit than to go over on a network failure. */
export const takeAi = (user: User): Promise<boolean> => takeQuota(user, "ai", DAILY_AI);

/** One Gemini call for food. false: the daily meal limit is exhausted. */
export const takeMealAi = (user: User): Promise<boolean> => takeQuota(user, "meal", DAILY_MEAL_AI);

/** How many calls are left today. */
export async function aiLeft(user: User): Promise<number> {
  const { data } = await db.from("ai_quota").select("count").eq("user_id", user.id).eq("kind", "ai")
    .eq("day", localNow(user.tz).date).maybeSingle();
  return Math.max(0, DAILY_AI - Number(data?.count ?? 0));
}

export const mealLimitText = (user: User): string =>
  t(user, "Лимит ИИ на еду на сегодня исчерпан ({n} обращений). Завтра снова; остальное работает как обычно.", {
    n: DAILY_MEAL_AI,
  });

export const limitText = (user: User): string =>
  t(user, "Лимит ИИ на сегодня исчерпан ({n} обращений). Записи, отметки и напоминания работают как обычно.", {
    n: DAILY_AI,
  });
