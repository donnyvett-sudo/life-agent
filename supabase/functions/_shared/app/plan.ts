// What the phone should schedule locally for the next hours. The server only knows the schedule and the
// supplements; the rich messages themselves arrive in the inbox when the scheduler sends them.
import { check, db, type Supplement, type User } from "../db.ts";
import { t } from "../i18n.ts";
import { isQuiet, localNow, localToUtc, shiftDate, toMin } from "../time.ts";
import { slotSupplements } from "../supplements.ts";

export type PlannedNotification = {
  id: string;            // stable per event and day: the app replaces instead of duplicating
  at: string;            // ISO instant
  kind: "morning" | "evening" | "lights_out" | "supplements";
  title: string;
  body: string;
  actions: { id: string; label: string }[];
};

type Slot = Supplement["slot"];
const SLOT_TITLE: Record<Slot, string> = { morning: "Утренние добавки", lunch: "Добавки к обеду", evening: "Вечер: магний" };

export type PlanInput = {
  user: User;
  now: Date;
  hours: number;
  /** names of active supplements per slot */
  supplements: Partial<Record<Slot, string[]>>;
  /** slots whose supplements are all logged today, or whose reminder the server already handled */
  doneToday: Slot[];
};

/** Pure: events within [now, now + hours]. */
export function planNotifications({ user, now, hours, supplements, doneToday }: PlanInput): PlannedNotification[] {
  const s = user.settings.schedule;
  const quiet = user.settings.coach.frequency === "quiet";
  const today = localNow(user.tz, now).date;
  const out: PlannedNotification[] = [];
  const end = now.getTime() + Math.min(Math.max(hours, 1), 72) * 3_600_000;
  for (const date of [today, shiftDate(today, 1), shiftDate(today, 2)]) {
    const add = (n: Omit<PlannedNotification, "id" | "at"> & { time: string; key: string }) => {
      // The server stays silent inside the sleep window; so does the phone.
      if (isQuiet(toMin(n.time), user.settings.sleep.bed, user.settings.sleep.wake)) return;
      const at = localToUtc(date, n.time, user.tz);
      if (at.getTime() <= now.getTime() || at.getTime() > end) return;
      const { time: _t, key, ...rest } = n;
      out.push({ id: `${key}:${date}`, at: at.toISOString(), ...rest });
    };
    add({ key: "morning", time: s.morning, kind: "morning", title: t(user, "Доброе утро"),
      body: t(user, "Открой приложение: день, пары, дедлайны."), actions: [] });
    // The evening supplement reminder is sent at the same minute: one banner, not two.
    const eveningSupps = (supplements.evening ?? []).length > 0 && !(date === today && doneToday.includes("evening"));
    if (!eveningSupps) add({ key: "evening", time: s.evening, kind: "evening", title: t(user, "Вечерний чек-ин"),
      body: t(user, "Подведи итог дня: добавки, траты, привычки."), actions: [] });
    if (!quiet) {
      add({ key: "lights_out", time: s.lights_out, kind: "lights_out", title: t(user, "Пора спать"),
        body: t(user, "Отбой по плану. Телефон в сторону."), actions: [] });
    }
    const slotTimes: [Slot, string][] = [["morning", s.morning], ["lunch", s.lunch_fallback], ["evening", s.evening]];
    for (const [slot, time] of slotTimes) {
      const names = supplements[slot] ?? [];
      if (!names.length || (date === today && doneToday.includes(slot))) continue;
      add({ key: `supp_${slot}`, time, kind: "supplements", title: t(user, SLOT_TITLE[slot]),
        body: names.map((n) => t(user, n)).join(", "),
        actions: [{ id: `ss:${slot}:${date}`, label: t(user, "Принял") }, { id: `sk:${slot}:${date}`, label: t(user, "Пропустить") }] });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function notificationsPlan(user: User, hours: number): Promise<{ notifications: PlannedNotification[]; telegram: boolean }> {
  // While Telegram is on, the server sends these itself: the phone must not repeat them.
  const telegram = user.notify_telegram !== false && Boolean(user.tg_id);
  if (telegram) return { notifications: [], telegram };
  const supplements: PlanInput["supplements"] = {};
  const doneToday: Slot[] = [];
  const today = localNow(user.tz).date;
  for (const slot of ["morning", "lunch", "evening"] as Slot[]) {
    const list = await slotSupplements(user.id, slot);
    if (!list.length) continue;
    supplements[slot] = list.map((x) => x.name);
    const logged = check(
      await db.from("supplement_logs").select("supplement_id").eq("user_id", user.id).eq("local_date", today)
        .in("supplement_id", list.map((x) => x.id)),
    ) as { supplement_id: string }[];
    // A reminder the server already sent or closed today (lunch logged, all taken) needs no local nudge.
    const rem = check(
      await db.from("reminders").select("status, attempts").eq("user_id", user.id).eq("kind", `supp_${slot}`)
        .eq("local_date", today).maybeSingle(),
    ) as { status: string; attempts: number } | null;
    if (logged.length >= list.length || (rem && (rem.status !== "pending" || rem.attempts > 0))) doneToday.push(slot);
  }
  return { notifications: planNotifications({ user, now: new Date(), hours, supplements, doneToday }), telegram };
}
