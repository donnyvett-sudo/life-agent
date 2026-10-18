// A friend joins without Telegram: an invite code from the owner plus an explicit consent creates the account and a device token.
// The code is the only credential, so wrong guesses are counted per address and globally, like pairing codes.
import { check, db, type User } from "./db.ts";
import { attachInvite, claimInvite, peekInvite, releaseInvite } from "./invites.ts";
import { createPairingCode, dbPairingStore, GLOBAL_KEY, PAIR_LIMIT, PairError, type Platform, PLATFORMS } from "./pairing.ts";

type Body = Record<string, unknown>;
const CODE = /^[A-Z0-9]{8}$/;

const validTz = (tz: unknown): string => {
  if (typeof tz !== "string") return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
};

export async function joinWithInvite(b: Body, ipHash: string, now: Date = new Date()) {
  const store = dbPairingStore;
  const since = new Date(now.getTime() - PAIR_LIMIT.windowMin * 60_000).toISOString();
  const key = `join:${ipHash}`;
  if ((await store.failuresSince(key, since)) >= PAIR_LIMIT.failures ||
      (await store.failuresSince(`join:${GLOBAL_KEY}`, since)) >= PAIR_LIMIT.globalFailures) throw new PairError(429, "too many attempts");
  const fail = async (status: 400 | 401 | 429, msg: string): Promise<never> => {
    await store.recordFailure(key).catch(() => {});
    await store.recordFailure(`join:${GLOBAL_KEY}`).catch(() => {});
    throw new PairError(status, msg);
  };
  if (b.consent !== true) throw new PairError(400, "consent required");
  const code = typeof b.invite === "string" ? b.invite.trim().toUpperCase() : "";
  if (!CODE.test(code) || !(await peekInvite(code))) return fail(401, "invalid or expired invite");
  const invite = await claimInvite(code);
  if (!invite) return fail(401, "invalid or expired invite");

  const name = typeof b.firstName === "string" ? b.firstName.trim().slice(0, 40) : "";
  const lang = b.lang === "en" ? "en" : "ru";
  const plat: Platform = PLATFORMS.includes(b.platform as Platform) ? b.platform as Platform : "pwa";
  let userId: string | null = null;
  let tokenId: string | null = null;
  try {
    const user = check(
      await db.from("users").insert({
        tg_id: null,
        first_name: name || null,
        tz: validTz(b.tz),
        is_allowed: true,
        is_owner: false,
        invited_by: invite.created_by ?? null,
        consent_at: now.toISOString(),
        notify_telegram: false,
      }).select().single(),
    ) as User;
    userId = user.id;
    if (lang === "en") check(await db.from("users").update({ settings: { ...user.settings, lang } }).eq("id", user.id));
    await attachInvite(invite.id, user.id);
    const label = `${plat}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const issued = await store.issue(user.id, label, ["app", "ingest"]);
    tokenId = issued.tokenId;
    const deviceName = typeof b.deviceName === "string" && b.deviceName.trim() ? b.deviceName.trim().slice(0, 60) : "Web";
    const deviceId = await store.addDevice(user.id, issued.tokenId, deviceName, plat);
    // A second sign-in for the Home Screen copy of the web app (it starts with empty storage): valid 10 minutes, once.
    const pair = await createPairingCode(store, user.id, ["app", "ingest"]);
    return { token: issued.token, scopes: ["app", "ingest"], deviceId, pairCode: pair.code, pairExpiresAt: pair.expiresAt };
  } catch (e) {
    // Nothing half-made: no token, no user, and the invite goes back into circulation.
    if (tokenId) await store.revoke(tokenId).catch(() => {});
    if (userId) await db.from("users").delete().eq("id", userId);
    await releaseInvite(invite.id).catch(() => {});
    throw e;
  }
}
