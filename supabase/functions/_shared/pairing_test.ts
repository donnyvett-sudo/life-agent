import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { allowedScopes, createPairingCode, newCode, normalizeCode, type PairingStore, redeemPairingCode, type CodeRow } from "./pairing.ts";
import { sha256Hex } from "./tokens.ts";

function fakeStore() {
  const codes = new Map<string, CodeRow & { hash: string }>();
  const fails: { ip: string; at: number }[] = [];
  const devices: unknown[] = [];
  const issued: { userId: string; label: string; scopes: string[] }[] = [];
  const store: PairingStore = {
    insertCode: (userId, hash, scopes, expiresAt) => {
      codes.set(hash, { id: crypto.randomUUID(), user_id: userId, scopes, expires_at: expiresAt, used_at: null, hash });
      return Promise.resolve();
    },
    codeByHash: (h) => Promise.resolve(codes.get(h) ?? null),
    claim: (id, nowIso) => {
      const c = [...codes.values()].find((x) => x.id === id);
      if (!c || c.used_at) return Promise.resolve(false);
      c.used_at = nowIso;
      return Promise.resolve(true);
    },
    issue: (userId, label, scopes) => {
      issued.push({ userId, label, scopes });
      return Promise.resolve({ token: "t".repeat(64), tokenId: "tok-1" });
    },
    addDevice: (_u, _t, name, platform) => {
      devices.push({ name, platform });
      return Promise.resolve("dev-1");
    },
    unclaim: (id) => { const c = [...codes.values()].find((x) => x.id === id); if (c) c.used_at = null; return Promise.resolve(); },
    revoke: () => Promise.resolve(),
    failuresSince: (ip, since) => Promise.resolve(fails.filter((f) => f.ip === ip && f.at >= Date.parse(since)).length),
    recordFailure: (ip) => {
      fails.push({ ip, at: Date.now() });
      return Promise.resolve();
    },
  };
  return { store, codes, fails, devices, issued };
}

Deno.test("code format and normalisation", () => {
  const c = newCode();
  assert(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c), c);
  assertEquals(normalizeCode(c.toLowerCase().replace("-", " ")), c);
  assertEquals(normalizeCode("ABCD-EFG"), null);
  assertEquals(normalizeCode("ABCD-EFG0"), null);   // 0 is not in the alphabet
  assertEquals(normalizeCode(42), null);
});

Deno.test("scopes: default, never *, unknown refused", async () => {
  assertEquals(allowedScopes(undefined), ["app", "ingest"]);
  assertEquals(allowedScopes(["app"]), ["app"]);
  await assertRejects(() => Promise.resolve().then(() => allowedScopes(["*"])));
  await assertRejects(() => Promise.resolve().then(() => allowedScopes(["root"])));
});

Deno.test("create then redeem once", async () => {
  const f = fakeStore();
  const { code } = await createPairingCode(f.store, "user-1", undefined);
  const r = await redeemPairingCode(f.store, code, "Alex's iPhone", "ios", "ip1");
  assertEquals(r.scopes, ["app", "ingest"]);
  assertEquals(f.issued[0].userId, "user-1");
  assertEquals(f.devices, [{ name: "Alex's iPhone", platform: "ios" }]);
  await assertRejects(() => redeemPairingCode(f.store, code, "x", "ios", "ip1"));   // one time only
});

Deno.test("expired code is refused and counted", async () => {
  const f = fakeStore();
  const { code } = await createPairingCode(f.store, "user-1", ["app"], new Date(Date.now() - 11 * 60_000));
  await assertRejects(() => redeemPairingCode(f.store, code, "x", "pwa", "ip2"));
  assertEquals(f.fails.length, 2);   // this address and the global counter
});

Deno.test("brute force stops after 10 failures", async () => {
  const f = fakeStore();
  for (let i = 0; i < 10; i++) await assertRejects(() => redeemPairingCode(f.store, "AAAA-BBBB", "x", "ios", "ip3"));
  const err = await assertRejects(() => redeemPairingCode(f.store, "AAAA-BBBB", "x", "ios", "ip3"));
  assertEquals((err as { status: number }).status, 429);
  assert((await sha256Hex("x")).length === 64);
});

Deno.test("a failed device insert gives the code back and revokes the token", async () => {
  const f = fakeStore();
  let revoked = 0;
  f.store.addDevice = () => Promise.reject(new Error("db down"));
  f.store.revoke = () => { revoked++; return Promise.resolve(); };
  const { code } = await createPairingCode(f.store, "user-1", undefined);
  await assertRejects(() => redeemPairingCode(f.store, code, "x", "ios", "ipA"));
  assertEquals(revoked, 1);
  const again = fakeStore();   // same code again on a healthy store is a fresh scenario; here: still unused
  assertEquals([...f.codes.values()][0].used_at, null);
  assert(again);
});

Deno.test("global limit stops rotating addresses", async () => {
  const f = fakeStore();
  for (let i = 0; i < 100; i++) f.fails.push({ ip: "*", at: Date.now() });
  const err = await assertRejects(() => redeemPairingCode(f.store, "AAAA-BBBB", "x", "ios", "fresh-ip"));
  assertEquals((err as { status: number }).status, 429);
});
