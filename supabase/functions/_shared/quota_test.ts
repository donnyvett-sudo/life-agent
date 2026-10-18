import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { globalCap, takeQuota, type TakeRpc } from "./quota.ts";
import type { User } from "./db.ts";

const U = { id: "u1", tz: "UTC" } as unknown as User;

// Fake of take_quota: same rule as the SQL (increment only below the cap, user cap then deployment cap).
function fakeRpc() {
  const users = new Map<string, number>();
  let global = 0;
  const rpc: TakeRpc = (a) => {
    const k = `${a.p_user}|${a.p_kind}|${a.p_day}`;
    const n = users.get(k) ?? 0;
    if (n >= (a.p_cap as number)) return Promise.resolve(false);
    users.set(k, n + 1);
    if (global >= (a.p_gcap as number)) { users.set(k, n); return Promise.resolve(false); }
    global++;
    return Promise.resolve(true);
  };
  return rpc;
}

Deno.test("takeQuota: user cap, then deployment cap", async () => {
  Deno.env.set("GEMINI_DAILY_CAP", "3");
  try {
    const rpc = fakeRpc();
    assertEquals([await takeQuota(U, "ai", 2, rpc), await takeQuota(U, "ai", 2, rpc), await takeQuota(U, "ai", 2, rpc)], [true, true, false]);
    assert(await takeQuota(U, "meal", 5, rpc));          // 3rd global unit
    assertEquals(await takeQuota(U, "meal", 5, rpc), false); // global cap of 3 reached
  } finally {
    Deno.env.delete("GEMINI_DAILY_CAP");
  }
});

Deno.test("globalCap: default 500, junk ignored", () => {
  assertEquals(globalCap(), 500);
  Deno.env.set("GEMINI_DAILY_CAP", "abc");
  assertEquals(globalCap(), 500);
  Deno.env.delete("GEMINI_DAILY_CAP");
});

Deno.test("takeQuota: an rpc error propagates (fail closed)", async () => {
  await assertRejects(() => takeQuota(U, "ai", 1, () => Promise.reject(new Error("db down"))));
});
