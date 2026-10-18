// Pair a new device (iPhone app, PWA) with an existing user without Telegram:
// a signed-in client asks for a one-time code, the new device exchanges it for its own token.
import { check, db } from "./db.ts";
import { type Scope, sha256Hex, issueToken, SCOPES } from "./tokens.ts";

export const CODE_TTL_MIN = 10;
export const PAIR_LIMIT = { failures: 10, windowMin: 10, globalFailures: 100 };
export const GLOBAL_KEY = "*";
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // no 0/O/1/I/L: easy to read aloud and type

export const PLATFORMS = ["ios", "pwa", "mac", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type CodeRow = { id: string; user_id: string; scopes: string[]; expires_at: string; used_at: string | null };

export interface PairingStore {
  insertCode(userId: string, hash: string, scopes: string[], expiresAt: string): Promise<void>;
  codeByHash(hash: string): Promise<CodeRow | null>;
  /** Marks the code used only if nobody did before. Returns false when it was already used. */
  claim(id: string, nowIso: string): Promise<boolean>;
  issue(userId: string, label: string, scopes: string[]): Promise<{ token: string; tokenId: string | null }>;
  addDevice(userId: string, tokenId: string | null, name: string, platform: Platform): Promise<string>;
  failuresSince(ipHash: string, sinceIso: string): Promise<number>;
  recordFailure(ipHash: string): Promise<void>;
  /** Undo a claim after a later step failed, so the user can try the same code again. */
  unclaim(id: string): Promise<void>;
  /** Revoke a token that was minted but could not be attached to a device. */
  revoke(tokenId: string): Promise<void>;
}

export class PairError extends Error {
  constructor(public status: 400 | 401 | 429, message: string) {
    super(message);
  }
}

/** New code, formatted XXXX-XXXX. Rejection sampling keeps the letters uniform. */
export function newCode(): string {
  const out: string[] = [];
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < 8) out.push(ALPHABET[b % ALPHABET.length]);   // 248 = 31 * 8
    }
  }
  return out.slice(0, 4).join("") + "-" + out.slice(4).join("");
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 8 || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return c.slice(0, 4) + "-" + c.slice(4);
}

/** Scopes a code may grant: never "*", and "study" only when asked for explicitly. */
export function allowedScopes(requested: unknown): string[] {
  const base = ["app", "ingest"];
  if (!Array.isArray(requested) || requested.length === 0) return base;
  const out = [...new Set(requested.filter((s): s is string => typeof s === "string"))];
  if (out.some((s) => s === "*" || !SCOPES.includes(s))) throw new PairError(400, "bad scopes");
  return out;
}

export async function createPairingCode(
  store: PairingStore, userId: string, requestedScopes: unknown, now: Date = new Date(),
): Promise<{ code: string; expiresAt: string; scopes: string[] }> {
  const scopes = allowedScopes(requestedScopes);
  const code = newCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MIN * 60_000).toISOString();
  await store.insertCode(userId, await sha256Hex(code), scopes, expiresAt);
  return { code, expiresAt, scopes };
}

/** Exchanges a code for a device token. Counts failures per address like authToken does. */
export async function redeemPairingCode(
  store: PairingStore, rawCode: unknown, deviceName: unknown, platform: unknown, ipHash: string, now: Date = new Date(),
): Promise<{ token: string; scopes: string[]; deviceId: string }> {
  const since = new Date(now.getTime() - PAIR_LIMIT.windowMin * 60_000).toISOString();
  // Per address, and across all addresses: a rotated source address must not buy unlimited guesses.
  if ((await store.failuresSince(ipHash, since)) >= PAIR_LIMIT.failures ||
      (await store.failuresSince(GLOBAL_KEY, since)) >= PAIR_LIMIT.globalFailures) throw new PairError(429, "too many attempts");
  const fail = async (): Promise<never> => {
    await store.recordFailure(ipHash).catch(() => {});
    await store.recordFailure(GLOBAL_KEY).catch(() => {});
    throw new PairError(401, "invalid or expired code");
  };
  const code = normalizeCode(rawCode);
  if (!code) return fail();
  const row = await store.codeByHash(await sha256Hex(code));
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return fail();
  if (!(await store.claim(row.id, now.toISOString()))) return fail();

  const name = typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, 60) : "Device";
  const plat: Platform = PLATFORMS.includes(platform as Platform) ? platform as Platform : "other";
  // Labels are unique per user: a re-paired device gets a numbered label.
  const label = `${plat}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  let issued: { token: string; tokenId: string | null } | null = null;
  try {
    issued = await store.issue(row.user_id, label, row.scopes);
    const deviceId = await store.addDevice(row.user_id, issued.tokenId, name, plat);
    return { token: issued.token, scopes: row.scopes, deviceId };
  } catch (e) {
    // Leave nothing half-made: no token without a device, and the code stays usable.
    if (issued?.tokenId) await store.revoke(issued.tokenId).catch(() => {});
    await store.unclaim(row.id).catch(() => {});
    throw e;
  }
}

export const dbPairingStore: PairingStore = {
  async insertCode(userId, hash, scopes, expiresAt) {
    check(await db.from("pairing_codes").insert({ user_id: userId, code_hash: hash, scopes, expires_at: expiresAt }));
  },
  async codeByHash(hash) {
    return check(await db.from("pairing_codes").select("id, user_id, scopes, expires_at, used_at").eq("code_hash", hash).maybeSingle()) as CodeRow | null;
  },
  async claim(id, nowIso) {
    const { data } = await db.from("pairing_codes").update({ used_at: nowIso }).eq("id", id).is("used_at", null).select("id");
    return (data?.length ?? 0) > 0;
  },
  async issue(userId, label, scopes) {
    const token = await issueToken(userId, label, scopes);
    const row = check(await db.from("api_tokens").select("id").eq("user_id", userId).eq("label", label).maybeSingle()) as { id: string } | null;
    return { token, tokenId: row?.id ?? null };
  },
  async addDevice(userId, tokenId, name, platform) {
    const row = check(await db.from("devices").insert({ user_id: userId, token_id: tokenId, name, platform }).select("id").single()) as { id: string };
    return row.id;
  },
  async failuresSince(ipHash, sinceIso) {
    const { count } = await db.from("auth_failures").select("ip_hash", { count: "exact", head: true })
      .eq("ip_hash", `pair:${ipHash}`).gte("at", sinceIso);
    return count ?? 0;
  },
  async recordFailure(ipHash) {
    await db.from("auth_failures").insert({ ip_hash: `pair:${ipHash}` });
    if (Math.random() < 0.05) {
      await db.from("auth_failures").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
    }
  },
  async unclaim(id) {
    await db.from("pairing_codes").update({ used_at: null }).eq("id", id);
  },
  async revoke(tokenId) {
    await db.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", tokenId);
  },
};

export async function listDevices(userId: string) {
  return check(
    await db.from("devices").select("id, name, platform, created_at, last_seen, token_id").eq("user_id", userId).order("created_at"),
  ) as { id: string; name: string; platform: string; created_at: string; last_seen: string | null; token_id: string | null }[];
}

/** Removes a device and revokes its token. False when it is not this user's device. */
export async function removeDevice(userId: string, deviceId: string): Promise<boolean> {
  const dev = check(await db.from("devices").select("id, token_id").eq("id", deviceId).eq("user_id", userId).maybeSingle()) as
    | { id: string; token_id: string | null } | null;
  if (!dev) return false;
  if (dev.token_id) {
    await db.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", dev.token_id).eq("user_id", userId);
  }
  await db.from("devices").delete().eq("id", dev.id);
  return true;
}

export type { Scope };
