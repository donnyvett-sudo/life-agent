// Бэкенд Mini App. Авторизация — подпись Telegram initData в заголовке X-Telegram-Init-Data,
// а вне Telegram (Mac-приложение Life Desk) — личный токен users.ingest_token в X-Token.
// Сами маршруты живут в _shared/app/routes.ts: тем же кодом пользуется чат-агент.
import { HttpError } from "../_shared/app/finance.ts";
import { route } from "../_shared/app/routes.ts";
import { verifyInitData } from "../_shared/initdata.ts";
import { db, type User } from "../_shared/db.ts";
import { findUser } from "../_shared/users.ts";
import { AuthError, authToken, dbStore, ipHashOf, sha256Hex } from "../_shared/tokens.ts";
import { createInvite } from "../_shared/invites.ts";
import { MINIAPP_URL } from "../_shared/config.ts";
import { joinWithInvite } from "../_shared/join.ts";
import { dbPairingStore, PairError, redeemPairingCode } from "../_shared/pairing.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
// Browser origins allowed to call the API (comma-separated secret). Add your miniapp host, e.g. https://you.github.io
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** An unknown Origin gets no Allow-Origin header at all (a browser then refuses to read the answer).
 *  Requests without an Origin (the Mac app, scripts) are not browsers and are not affected. */
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "content-type, x-telegram-init-data, x-token, idempotency-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Vary": "Origin",
  };
}

/** Reads a JSON body through a size cap, so a chunked request with no length cannot buffer without limit. */
async function readJson(req: Request, max: number): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(len) && len > max) throw new HttpError(413, "too large");
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel().catch(() => {}); throw new HttpError(413, "too large"); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  try {
    const j = JSON.parse(new TextDecoder().decode(all));
    return j && typeof j === "object" ? j as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Routes only the owner's own devices may use (scope admin) or only the Mac (scope agent); "*" and Telegram cover both. */
function scopeNeeded(method: string, path: string): "admin" | "agent" | null {
  if (/^\/agent\/jobs\/claim$|^\/agent\/jobs\/[0-9a-f-]{36}\/result$/.test(path)) return "agent";
  if (path === "/agent/jobs" || path.startsWith("/friends") || path.startsWith("/invites") || path.startsWith("/settings/github")) return "admin";
  if (method === "DELETE" && path.startsWith("/devices/")) return "admin";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const known = ORIGINS.includes(req.headers.get("origin") ?? "");
    return new Response(null, { status: known ? 204 : 403, headers: cors(req) });
  }
  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*?\/api/, "") || "/";
    // The one unauthenticated route: a one-time pairing code is the credential.
    if (req.method === "POST" && path === "/auth/pair") {
      const b = await readJson(req, 2048);
      try {
        const r = await redeemPairingCode(dbPairingStore, b.code, b.deviceName, b.platform, await ipHashOf(req));
        return Response.json(r, { headers: { ...cors(req), "Cache-Control": "no-store" } });
      } catch (e) {
        if (e instanceof PairError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    // The second unauthenticated route: a friend joins with an owner's invite code and consent.
    if (req.method === "POST" && path === "/auth/join") {
      const raw = await readJson(req, 2048);
      try {
        const r = await joinWithInvite(raw, await ipHashOf(req));
        return Response.json(r, { headers: { ...cors(req), "Cache-Control": "no-store" } });
      } catch (e) {
        if (e instanceof PairError) throw new HttpError(e.status, e.message);
        throw e;
      }
    }
    const user = await authUser(req);
    // Minting a pairing code is the most powerful thing a client can do: only a full-scope credential
    // (the owner's own devices: Telegram or the "*" token) may, so a stolen narrow token cannot spawn new ones.
    if (path === "/auth/pairing-code" && !(await hasFullScope(req))) throw new HttpError(403, "full access required");

    if (path === "/invites" && req.method === "POST") {
      if (!(await hasFullScope(req))) throw new HttpError(403, "full access required");
      if (!user.is_owner) throw new HttpError(403, "owner only");
      const inv = await createInvite(user, "web");
      return Response.json({ code: inv.code, expiresAt: inv.expires_at, link: `${MINIAPP_URL}#join=${inv.code}` }, { headers: { ...cors(req), "Cache-Control": "no-store" } });
    }
    const need = scopeNeeded(req.method, path);
    if (need && !(await hasScope(req, need))) throw new HttpError(403, `${need} access required`);
    const big = path === "/meals/photo" || path === "/voice";
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req, big ? 9_000_000 : 256_000) : {};
    // A retried write (the first answer was lost) carries the same key and gets the first result instead of running twice.
    const idemKey = req.method === "POST" ? req.headers.get("idempotency-key") : null;
    if (idemKey && /^[A-Za-z0-9._-]{8,80}$/.test(idemKey)) {
      const first = await db.from("idempotency_keys").insert({ user_id: user.id, key: idemKey });
      if (first.error) {
        const { data: prev } = await db.from("idempotency_keys").select("response").eq("user_id", user.id).eq("key", idemKey).maybeSingle();
        if (prev?.response != null) return Response.json(prev.response, { headers: { ...cors(req), "Idempotent-Replay": "true" } });
        throw new HttpError(409, "the same request is still running");
      }
      try {
        const data = (await route(user, req.method, path, url.searchParams, body)) ?? { ok: true };
        await db.from("idempotency_keys").update({ response: data }).eq("user_id", user.id).eq("key", idemKey);
        if (Math.random() < 0.02) await db.from("idempotency_keys").delete().lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
        return Response.json(data, { headers: cors(req) });
      } catch (e) {
        await db.from("idempotency_keys").delete().eq("user_id", user.id).eq("key", idemKey); // a failed attempt may be retried
        throw e;
      }
    }
    const data = await route(user, req.method, path, url.searchParams, body);
    return Response.json(data ?? { ok: true }, { headers: cors(req) });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    // 500 — детали остаются в логе: текст ошибки БД клиенту ни к чему.
    const message = status === 500 ? "internal error" : e instanceof Error ? e.message : String(e);
    return Response.json({ error: message }, {
      status,
      headers: cors(req),
    });
  }
});

/** initData, если он есть (Telegram); иначе личный токен (Life Desk). Оба пути — только is_allowed. */
async function authUser(req: Request): Promise<User> {
  const initData = req.headers.get("x-telegram-init-data") ?? "";
  if (initData) {
    if (!BOT_TOKEN) throw new HttpError(401, "bad initData"); // Telegram not configured: initData cannot be trusted
    const tg = await verifyInitData(initData, BOT_TOKEN);
    if (!tg) throw new HttpError(401, "bad initData");
    const user = await findUser(tg.id);
    if (!user?.is_allowed) throw new HttpError(403, "not allowed");
    return user;
  }
  try {
    return await authToken(dbStore, req.headers.get("x-token"), "app", await ipHashOf(req));
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(e.status, e.message);
    throw e;
  }
}

/** True for a Telegram-authenticated call or a token that carries "*". Called only after authUser succeeded. */
async function hasFullScope(req: Request): Promise<boolean> {
  return await hasScope(req, "*");
}

/** Telegram-authenticated calls and "*" tokens pass everything; other tokens need the named scope. */
async function hasScope(req: Request, need: string): Promise<boolean> {
  if ((req.headers.get("x-telegram-init-data") ?? "") !== "") return true;
  const token = req.headers.get("x-token");
  if (!token) return false;
  const row = await dbStore.byHash(await sha256Hex(token));
  return Boolean(row && !row.revoked_at && (row.scopes.includes("*") || row.scopes.includes(need)));
}
