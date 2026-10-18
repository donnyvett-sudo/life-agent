// Buttons as HTTP: the same "type:a:b" ids Telegram callbacks carry, run without a chat message to edit.
// Only actions that act on data alone live here; ones that rewrite a card in place come with their own endpoints.
import { db, type User } from "./db.ts";
import { resolveLedger } from "./coach.ts";
import { markMilestoneDone } from "./career.ts";
import { toggleHabit } from "./habits.ts";
import { markAssignmentDone, stopFocus } from "./study.ts";
import { handleSupplementAction, logSupplement, refillSupplement, slotSupplements } from "./supplements.ts";
import { localNow } from "./time.ts";
import { confirmAgent, undoAgent } from "./agent.ts";
import { t } from "./i18n.ts";
import { mealAction } from "./food.ts";
import { handlePromiseCallback } from "./promises.ts";
import { markInboxHandled } from "./notify.ts";

export type ActionResult = { ok: boolean; toast: string; text?: string };

const ID = /^[0-9a-zA-Z_-]{1,64}$/;

/** Parses "type:a:b". Returns null for anything that is not a plain id (nothing user-typed gets through). */
export function parseAction(data: unknown): { type: string; a?: string; b?: string } | null {
  if (typeof data !== "string" || data.length > 200) return null;
  const [type, a, b, ...rest] = data.split(":");
  if (rest.length || !type || !/^[a-z]{1,4}$/.test(type)) return null;
  if ((a !== undefined && !ID.test(a)) || (b !== undefined && !ID.test(b))) return null;
  return { type, a, b };
}

export async function runAction(user: User, data: unknown): Promise<ActionResult> {
  const p = parseAction(data);
  if (!p) return { ok: false, toast: t(user, "Не вышло") };
  const { type, a, b } = p;
  let toast: string | undefined;
  let text: string | undefined;

  if (type === "s" && (a === "t" || a === "z" || a === "k") && b) toast = await handleSupplementAction(user, a, b);
  else if (type === "r" && a) toast = await refillSupplement(user, a);
  else if ((type === "p" || type === "g") && a) toast = await resolveLedger(user, a, type === "p" ? "penalty" : "reward");
  else if (type === "x" && a) {
    const { count } = await db.from("transactions").delete({ count: "exact" }).eq("id", a).eq("user_id", user.id);
    toast = count ? t(user, "Запись удалена") : t(user, "Уже удалена");
  } else if (type === "hw" && a) toast = await markAssignmentDone(user, a);
  else if (type === "ms" && a) toast = await markMilestoneDone(user, a);
  else if (type === "h" && a) toast = await toggleHabit(user, a);
  else if (["prx", "pry", "prn", "prs", "prf", "prv"].includes(type) && a) toast = await handlePromiseCallback(user, type, a, b);
  else if (type === "ml" && a && b && ["ok", "half", "x15", "del"].includes(a)) toast = (await mealAction(user, a, b)).toast || t(user, "Готово");
  else if ((type === "ay" || type === "an") && a) {
    const out = await confirmAgent(user, a, type === "ay");
    toast = out.text;
    text = out.text;
  } else if (type === "az" && a) toast = await undoAgent(user, a);
  else if (type === "fs" && a) toast = await stopFocus(user, a);
  else if ((type === "ss" || type === "sk") && (a === "morning" || a === "lunch" || a === "evening")) {
    // A whole slot at once, from a notification button: taken or skipped for today.
    const status = type === "ss" ? "taken" : "skipped";
    const date = localNow(user.tz).date;
    // The button carries its day: one pressed late (a queued retry, an old banner) must not log today's slot.
    if (b && b !== date) return { ok: false, toast: t(user, "Это напоминание уже неактуально") };
    const supps = await slotSupplements(user.id, a);
    // "Skip" never undoes what was already taken today; "Taken" may turn a skip into taken.
    const logged = new Set((await db.from("supplement_logs").select("supplement_id").eq("user_id", user.id).eq("local_date", date)
      .in("supplement_id", supps.map((s) => s.id))).data?.map((r: { supplement_id: string }) => r.supplement_id) ?? []);
    let failed = 0;
    for (const s of supps) {
      if (status === "skipped" && logged.has(s.id)) continue;
      try { await logSupplement(user, s.id, status, date); } catch { failed++; }
    }
    if (!supps.length || failed === supps.length) toast = t(user, "Не вышло");
    else toast = status === "taken" ? t(user, "Принял") : t(user, "Пропустить");
  }

  if (toast === undefined) return { ok: false, toast: t(user, "Не вышло") };
  await markInboxHandled(user.id, null, String(data)).catch(() => {});
  return { ok: true, toast, text };
}
