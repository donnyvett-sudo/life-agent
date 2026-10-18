// Web Push for the web app (friends without Telegram). VAPID keys live in secrets: VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT.
import webpush from "npm:web-push@3.6.7";
import { check, db, type User } from "./db.ts";
import type { Message } from "./notify.ts";
import { HttpError } from "./app/finance.ts";

const PUB = () => Deno.env.get("VAPID_PUBLIC") ?? "";
let ready = false;
function init(): boolean {
  if (ready) return true;
  const pub = PUB(), priv = Deno.env.get("VAPID_PRIVATE"), subj = Deno.env.get("VAPID_SUBJECT");
  if (!pub || !priv || !subj) return false;
  webpush.setVapidDetails(subj, pub, priv);
  return (ready = true);
}

export const pushKey = () => ({ key: PUB() || null });

const HTTPS = /^https:\/\/[^\s]{8,990}$/;
// Only the browsers' own push services: an endpoint is a URL this server will POST to.
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const MAX_SUBS = 5;

export async function subscribe(user: User, b: Record<string, unknown>) {
  const keys = (b.keys ?? {}) as Record<string, unknown>;
  const endpoint = String(b.endpoint ?? ""), p256dh = String(keys.p256dh ?? ""), auth = String(keys.auth ?? "");
  if (!HTTPS.test(endpoint) || !p256dh || !auth) throw new HttpError(400, "bad subscription");
  let host = "";
  try { host = new URL(endpoint).hostname; } catch { /* rejected below */ }
  if (!PUSH_HOSTS.some((r) => r.test(host)) || /^[\d.]+$|:/.test(host)) throw new HttpError(400, "unsupported push service");
  const { count } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= MAX_SUBS) throw new HttpError(429, "too many subscriptions");
  // A browser keeps its endpoint when a different person signs in: the row moves to the current user.
  check(await db.from("push_subscriptions").upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: "endpoint" }));
  return { ok: true };
}

export async function unsubscribe(user: User, b: Record<string, unknown>) {
  await db.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", String(b.endpoint ?? ""));
  return { ok: true };
}

const plain = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim();

/** Sends the message to every browser the user subscribed. Dead subscriptions (404/410) are removed. Never throws. */
export async function pushMessage(user: User, m: Message): Promise<void> {
  try {
    if (!init()) return;
    const subs = check(await db.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", user.id)) as
      { endpoint: string; p256dh: string; auth: string }[];
    if (!subs.length) return;
    const payload = JSON.stringify({ title: m.title ?? "Life", body: plain(m.body).slice(0, 140) });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, timeout: 8000 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        else console.error("push", code ?? String(e));
      }
    }));
  } catch (e) {
    console.error("push", String(e));
  }
}
