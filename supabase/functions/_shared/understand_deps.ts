// The real writes behind understand.ts: each action calls the function the bot command or the app screen already uses.
import { check, db, type User } from "./db.ts";
import type { ExecDeps } from "./understand.ts";
import { findOne } from "./understand.ts";
import { logEntry } from "./moneybot.ts";
import { accountsOf, applyTransfer } from "./transferbot.ts";
import { mealText } from "./food.ts";
import { fmtNum, saveWeight } from "./body.ts";
import { toggleHabit } from "./habits.ts";
import { coursesOf, markAssignmentDone, startFocusWith } from "./study.ts";
import { saveAssignment } from "./app/study.ts";
import { updateTx } from "./app/finance.ts";
import { addCards } from "./cards.ts";
import { manualSleep } from "./manual_sleep.ts";
import { logSupplement, slotSupplements } from "./supplements.ts";
import { send } from "./telegram.ts";
import { t } from "./i18n.ts";
import { localNow } from "./time.ts";

const ABOUT_MAX = 2000;
const has = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());

async function courseByName(user: User, name: string | null) {
  if (!name) return undefined;
  return [...(await coursesOf(user.id)).values()].find((c) => has(c.short, name) || has(c.code, name) || has(c.title, name));
}

export const realDeps: ExecDeps = {
  async expense(user, a, raw) {
    const account = a.account ? (await accountsOf(user.id)).find((x) => has(x.title, a.account!)) : undefined;
    await logEntry(user, raw, { kind: a.type, note: a.note, amount: a.amount, currency: a.currency }, a.daysAgo, "bot", account?.id);
  },
  async transfer(user, tr) {
    return (await applyTransfer(user, tr)) !== null;
  },
  async meal(user, food) {
    await mealText(user, food);
  },
  async weight(user, kg) {
    await saveWeight(user, kg);
    await send(user.tg_id, t(user, "Вес {kg} кг записан.", { kg: fmtNum(user, kg, 1) }));
  },
  async habit(user, name) {
    const h = await findOne("habits", user, name, { active: "true" });
    if (!h) return t(user, "Не нашёл привычку «{name}».", { name });
    const today = localNow(user.tz).date;
    const { count } = await db.from("habit_logs").select("habit_id", { count: "exact", head: true }).eq("habit_id", h.id).eq("local_date", today);
    if (count) return t(user, "Уже отмечено: {title}", { title: h.title });   // never un-tick by talking
    return await toggleHabit(user, h.id);
  },
  async assignmentDone(user, title) {
    const a = await findOne("assignments", user, title, { status: "todo" });
    if (a === undefined) return t(user, "Не нашёл открытое задание «{name}».", { name: title });
    if (a === null) return t(user, "Подходит несколько заданий, отметь нужное в приложении.");
    return `${await markAssignmentDone(user, a.id)}: ${a.title}`;
  },
  async taskAdd(user, a) {
    const course = await courseByName(user, a.course);
    await saveAssignment(user, null, { title: a.title, courseId: course?.id ?? null, dueDate: a.due });
    return t(user, "Задание добавлено: {title}", { title: a.title }) + (a.due ? ` (${a.due})` : "");
  },
  async cardAdd(user, text) {
    const out = await addCards(user, text);
    await send(user.tg_id, out.text, out.keyboard);
  },
  async sleep(user, a) {
    for (const m of await manualSleep(user, `${a.bed} ${a.wake}${a.daysAgo ? " вчера" : ""}`)) await send(user.tg_id, m.text, m.keyboard);
  },
  async focus(user, minutes, courseName) {
    const ok = await startFocusWith(user, minutes, await courseByName(user, courseName));
    return ok ? null : t(user, "Фокус уже идёт. Сначала останови текущий.");
  },
  async remember(user, fact) {
    const profile = { ...(user.settings.profile ?? { about: "", currency: "CNY" }) };
    const about = `${profile.about ?? ""}\n• ${fact}`.trim();
    profile.about = about.length > ABOUT_MAX ? about.slice(about.length - ABOUT_MAX) : about;   // newest facts win
    const settings = { ...user.settings, profile };
    check(await db.from("users").update({ settings }).eq("id", user.id));
    user.settings = settings;
    return t(user, "Запомнил: {fact}", { fact });
  },
  async supplements(user, a) {
    const minutes = localNow(user.tz).minutes;
    const slot = a.slot ?? (minutes < 12 * 60 ? "morning" : minutes < 17 * 60 ? "lunch" : "evening");
    const pool = a.names.length
      ? (check(await db.from("supplements").select("*").eq("user_id", user.id).eq("active", true)) as { id: string; name: string }[])
        .filter((s) => a.names.some((n) => has(s.name, n)))
      : await slotSupplements(user.id, slot);
    if (!pool.length) return t(user, "Не нашёл, какие добавки отметить.");
    for (const s of pool) await logSupplement(user, s.id, "taken");
    return t(user, "Принято: {names}", { names: pool.map((s) => s.name).join(", ") });
  },
  async fixExpense(user, a) {
    const last = check(
      await db.from("transactions").select("id,note").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
    ) as { id: string; note: string | null }[];
    if (!last.length) return t(user, "Нечего исправлять: записей ещё нет.");
    const body: Record<string, unknown> = {};
    if (a.amount !== null) body.amount = a.amount;
    if (a.note) body.note = a.note;
    if (a.category) {
      const cats = check(await db.from("categories").select("id,title").eq("user_id", user.id)) as { id: string; title: string }[];
      const c = cats.find((x) => has(x.title, a.category!));
      if (c) body.categoryId = c.id;
    }
    await updateTx(user, last[0].id, body);
    return t(user, "Исправил последнюю запись «{note}».", { note: a.note ?? last[0].note ?? "" });
  },
  async say(user, text) {
    await send(user.tg_id, text);
  },
};
