// Manual night ("/sleep 00:10 08:40" in the bot, PUT /sleep in the apps) when the watch gave Health no data.
import { check, db, type User } from "./db.ts";
import { evaluateNight, getSleep, reevaluateNight, sleepLine } from "./coach.ts";
import type { Outgoing } from "./coach.ts";
import { t } from "./i18n.ts";
import { parseManualSleep } from "./sleep.ts";
import { addMin, dayBounds, fmtDuration, localNow, shiftDate } from "./time.ts";

const MIN_NIGHT = 60;
const MAX_NIGHT = 16 * 60;

/** «/sleep 00:10 08:40» — ночь руками, когда часы не отдали данные в Health. */
export async function manualSleep(user: User, args: string): Promise<Outgoing[]> {
  const m = parseManualSleep(args);
  if (!m) {
    return [{
      text: t(user, "Формат: <code>/sleep 00:10 08:40</code> — когда лёг и когда встал. Для позапрошлой ночи добавь «вчера»."),
    }];
  }
  const now = localNow(user.tz);
  // Без даты считаем ночь ближайшей к сегодняшнему утру: подъём в будущем — значит, это вчера.
  let wakeDate = shiftDate(now.date, -m.daysBack);
  if (!m.daysBack && m.wakeMin > now.minutes) wakeDate = shiftDate(now.date, -1);
  const bedDate = m.bedMin >= m.wakeMin ? shiftDate(wakeDate, -1) : wakeDate;
  const bedAt = addMin(dayBounds(bedDate, user.tz).from, m.bedMin);
  const wakeAt = addMin(dayBounds(wakeDate, user.tz).from, m.wakeMin);
  const asleep = Math.round((wakeAt.getTime() - bedAt.getTime()) / 60_000);
  if (asleep < MIN_NIGHT || asleep > MAX_NIGHT) {
    return [{
      text: t(user, "Получилась ночь {total} — проверь время.", { total: fmtDuration(user, asleep) }),
    }];
  }

  check(
    await db.from("sleep_sessions").upsert({
      user_id: user.id,
      night_date: wakeDate,
      bed_at: bedAt.toISOString(),
      wake_at: wakeAt.toISOString(),
      asleep_min: asleep,
      in_bed_min: asleep,
      deep_min: 0,
      rem_min: 0,
      core_min: 0,
      awake_min: 0,
      source: "manual",
      raw: { manual: true },
    }, { onConflict: "user_id,night_date" }),
  );
  const s = await getSleep(user.id, wakeDate);
  if (!s) return [{ text: t(user, "Не вышло записать ночь.") }];

  // Ночь уже разбирали (например, по неполным данным с часов) — пересматриваем со снятием штрафа.
  const ev = user.state.last_eval_night === wakeDate
    ? await reevaluateNight(user, s)
    : await evaluateNight(user, s);
  const head = t(user, "Ночь на {date} записана руками.", { date: wakeDate }) + " " + sleepLine(user, s);
  return [{ text: [head, ...ev.lines].join("\n") }, ...ev.extras];
}

