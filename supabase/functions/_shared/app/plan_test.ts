import { assertEquals } from "jsr:@std/assert@1";
import { planNotifications } from "./plan.ts";
import type { User } from "../db.ts";

const user = {
  id: "u", tz: "Asia/Shanghai",
  settings: { schedule: { morning: "07:15", lunch_fallback: "14:30", evening: "22:00", lights_out: "22:45", weekly: "19:00", weekly_dow: 0 },
              sleep: { bed: "23:00", wake: "07:00" }, coach: { frequency: "normal" }, lang: "en" },
} as unknown as User;

// 2026-10-16 06:00 in Shanghai = 2026-10-15 22:00 UTC
const now = new Date("2026-10-15T22:00:00Z");

Deno.test("plan: today and tomorrow in order, local times become UTC", () => {
  const p = planNotifications({ user, now, hours: 48, supplements: { lunch: ["D3", "Zinc"] }, doneToday: [] });
  const first = p[0];
  assertEquals([first.id, first.at, first.kind], ["morning:2026-10-16", "2026-10-15T23:15:00.000Z", "morning"]);
  assertEquals(p.map((x) => x.id).slice(0, 5), ["morning:2026-10-16", "supp_lunch:2026-10-16", "evening:2026-10-16", "lights_out:2026-10-16", "morning:2026-10-17"]);
  assertEquals(p.find((x) => x.id === "supp_lunch:2026-10-16")?.actions.map((a) => a.id), ["ss:lunch:2026-10-16", "sk:lunch:2026-10-16"]);
});

Deno.test("plan: past events, done supplements and the horizon are respected", () => {
  const late = new Date("2026-10-16T08:00:00Z");   // 16:00 local: today's morning/lunch are past
  const p = planNotifications({ user, now: late, hours: 12, supplements: { evening: ["Mg"], lunch: ["D3"] }, doneToday: ["evening"] });
  assertEquals(p.map((x) => x.id), ["evening:2026-10-16", "lights_out:2026-10-16"]);   // evening supplements already done; tomorrow is beyond 12 h
});

Deno.test("plan: nothing inside the sleep window", () => {
  const owl = { ...user, settings: { ...user.settings, sleep: { bed: "22:30", wake: "07:30" } } } as unknown as User;
  const p = planNotifications({ user: owl, now, hours: 24, supplements: {}, doneToday: [] });
  assertEquals(p.some((x) => x.kind === "lights_out" || x.kind === "morning"), false);   // 22:45 and 07:15 are asleep
});

Deno.test("localToUtc: correct on a DST change day", async () => {
  const { localToUtc } = await import("../time.ts");
  // Berlin moves 02:00 -> 03:00 on 2026-03-29: 01:30 is still CET (+1), 08:00 is CEST (+2)
  assertEquals(localToUtc("2026-03-29", "01:30", "Europe/Berlin").toISOString(), "2026-03-29T00:30:00.000Z");
  assertEquals(localToUtc("2026-03-29", "08:00", "Europe/Berlin").toISOString(), "2026-03-29T06:00:00.000Z");
  assertEquals(localToUtc("2026-10-16", "07:15", "Asia/Shanghai").toISOString(), "2026-10-15T23:15:00.000Z");
});

Deno.test("plan: quiet mode drops the lights-out nudge", () => {
  const quiet = { ...user, settings: { ...user.settings, coach: { frequency: "quiet" } } } as unknown as User;
  const p = planNotifications({ user: quiet, now, hours: 24, supplements: {}, doneToday: [] });
  assertEquals(p.some((x) => x.kind === "lights_out"), false);
});
