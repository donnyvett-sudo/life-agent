// One way out for everything the system tells a user. A message is written to the inbox (what the apps show)
// and, while the user still has Telegram on, sent there too.
import { check, db, type User } from "./db.ts";
import type { Keyboard } from "./telegram.ts";

export type MessageAction = { id: string; label: string; style?: "primary" | "danger"; url?: string };
export type Message = {
  kind: "coach" | "user" | "reminder" | "penalty" | "reward" | "card" | "system";
  title?: string;
  body: string;                 // markdown-lite
  actions: MessageAction[];
  ref?: string;
  /** created_at to use instead of now (the user's own line is stamped when the request began). */
  at?: string;
  /** The earlier inbox message this line answers (swipe to reply). */
  replyTo?: string;
};

const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** The coach writes Telegram HTML; the inbox keeps markdown-lite so no client needs an HTML parser. */
export function htmlToMarkdown(html: string): string {
  // Brackets in text (a friend's name or a promise title) must not become links: escape them before our own <a> becomes one.
  return html.replace(/[\[\]]/g, (c) => "\\" + c)
    .replace(/<a\s+href="([^"]*)">([\s\S]*?)<\/a>/gi, (_m, url, text) => /^https:\/\//i.test(url) ? `[${text}](${url})` : String(text))
    .replace(/<\/?(b|strong)>/gi, "**")
    .replace(/<\/?(i|em)>/gi, "_")
    .replace(/<\/?(s|strike|del)>/gi, "~~")
    .replace(/<\/?code>/gi, "`")
    .replace(/<\/?pre>/gi, "\n```\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENT[m] ?? m);
}

/** callback_data stays the action id, so the old Telegram handlers and POST /actions agree on names. */
/** Button types POST /actions can run. Others (card edits, wizards) stay Telegram-only until they get endpoints. */
export const RUNNABLE_TYPES = new Set(["s", "r", "p", "g", "x", "hw", "ms", "h", "ay", "an", "az", "fs", "ss", "sk", "prx", "pry", "prn", "prs", "prf", "prv", "ml", "ch"]);

export function actionsFromKeyboard(kb?: Keyboard): MessageAction[] {
  const out: MessageAction[] = [];
  for (const row of kb ?? []) {
    for (const b of row) {
      if (b.callback_data) {
        // ml:ed starts a typed correction in the bot's chat; in the apps the user simply writes the correction in the Feed.
        if (RUNNABLE_TYPES.has(b.callback_data.split(":")[0]) && !b.callback_data.startsWith("ml:ed:")) out.push({ id: b.callback_data, label: b.text });
      }
      else if (b.web_app && /^https:\/\//i.test(b.web_app.url)) out.push({ id: "open", label: b.text, url: b.web_app.url });
    }
  }
  return out;
}

export function fromOutgoing(out: { text: string; keyboard?: Keyboard }, kind: Message["kind"] = "coach", ref?: string): Message {
  return { kind, body: htmlToMarkdown(out.text), actions: actionsFromKeyboard(out.keyboard), ref };
}

/** Everything notify needs from the outside, so it can be tested with a fake. */
export interface NotifyDeps {
  insert(userId: string, m: Message): Promise<string>;
  telegram(user: User, text: string, kb?: Keyboard): Promise<void>;
  /** Web Push for people with no Telegram delivery (friends on the web app). Optional: tests leave it out. */
  push?(user: User, m: Message): Promise<void>;
}

export async function notifyWith(
  deps: NotifyDeps, user: User, m: Message, telegram?: { text: string; keyboard?: Keyboard },
): Promise<string> {
  // The inbox is best-effort here: a missing table or a database hiccup must never stop the Telegram message.
  let id = "";
  try {
    id = await deps.insert(user.id, m);
  } catch (e) {
    console.error("inbox insert", String(e));
  }
  const on = user.notify_telegram !== false;
  if (on && user.tg_id && telegram) await deps.telegram(user, telegram.text, telegram.keyboard);
  if (!(on && user.tg_id) && deps.push && m.kind !== "user") await deps.push(user, m);
  return id;
}

export const dbDeps: NotifyDeps = {
  async insert(userId, m) {
    const row = check(
      await db.from("inbox").insert({
        user_id: userId, kind: m.kind, title: m.title ?? null, body: m.body, actions: m.actions, ref: m.ref ?? null,
        ...(m.at ? { created_at: m.at } : {}),
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      }).select("id").single(),
    ) as { id: string };
    return row.id;
  },
  async telegram(user, text, kb) {
    const { send } = await import("./telegram.ts");
    await send(user.tg_id!, text, kb);
  },
  async push(user, m) {
    const { pushMessage } = await import("./push.ts");
    await pushMessage(user, m);
  },
};

export async function listInbox(userId: string, limit = 50, before?: string) {
  let q = db.from("inbox").select("id, kind, title, body, actions, ref, created_at, read_at, handled_at, reply_to").eq("user_id", userId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (before) q = q.lt("created_at", before);
  return check(await q) as Record<string, unknown>[];
}

export async function markInboxRead(userId: string, id: string): Promise<boolean> {
  const { data } = await db.from("inbox").update({ read_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId)
    .is("read_at", null).select("id");
  return (data?.length ?? 0) > 0;
}

export async function markAllInboxRead(userId: string): Promise<number> {
  const { data } = await db.from("inbox").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null).select("id");
  return data?.length ?? 0;
}

/** After an action ran, its message loses the buttons (like Telegram dropping the keyboard). */
export async function markInboxHandled(userId: string, ref: string | null, actionId: string): Promise<void> {
  let q = db.from("inbox").update({ handled_at: new Date().toISOString(), read_at: new Date().toISOString() })
    .eq("user_id", userId).is("handled_at", null);
  q = ref ? q.eq("ref", ref) : q.contains("actions", JSON.stringify([{ id: actionId }]));
  await q;
}

/** Does this user still receive messages in Telegram? */
export const viaTelegram = (user: User): boolean => user.notify_telegram !== false && !!user.tg_id;

/**
 * A message from the scheduler or a background event: always into the inbox (the Feed), plus Telegram while it is on,
 * plus Web Push for people without Telegram. Returns the Telegram message id (0 when none), so callers that edit the
 * message later keep working. Inside an app request (capture) it behaves like send(): the reply is captured.
 */
export async function deliver(user: User, text: string, keyboard?: Keyboard): Promise<number> {
  const { send, capturing } = await import("./telegram.ts");
  if (capturing()) return await send(user.tg_id, text, keyboard);
  await notifyWith(dbDeps, user, fromOutgoing({ text, keyboard }));
  if (!viaTelegram(user)) return 0;
  try {
    return await send(user.tg_id, text, keyboard);
  } catch (e) {
    // Bot token removed or the chat is gone: the inbox copy above already reached the apps.
    console.warn("deliver telegram", String(e));
    return 0;
  }
}
