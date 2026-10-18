// Input from the apps over HTTP: text, voice and meal photos run through the same pipeline as the bot,
// and the answer is what the bot would have said (captured instead of sent to Telegram).
import { handleText } from "../entry.ts";
import { mealPhotoBytes } from "../food.ts";
import { transcribe } from "../gemini.ts";
import { limitText, takeAi } from "../quota.ts";
import { type Captured, withCapture } from "../telegram.ts";
import { actionsFromKeyboard, dbDeps, htmlToMarkdown, type MessageAction } from "../notify.ts";
import { db, type User } from "../db.ts";
import { t } from "../i18n.ts";
import { HttpError } from "./finance.ts";

export type EntryMessage = {
  id: number;
  kind: Captured["kind"];
  /** An edit replaces the earlier message with the same id (a card updating in place). */
  replaces: boolean;
  body: string;
  actions: MessageAction[];
};

export type EntryResult = { messages: EntryMessage[]; transcript?: string };

export const LIMITS = { text: 1000, audioBytes: 3_000_000, photoBytes: 6_000_000 };

export function toMessages(out: Captured[]): EntryMessage[] {
  return out.filter((c) => c.kind !== "voice" || c.text).map((c) => ({
    id: c.messageId,
    kind: c.kind,
    replaces: c.kind === "edit",
    body: htmlToMarkdown(c.text),
    actions: actionsFromKeyboard(c.keyboard),
  }));
}

/** Decodes standard base64 (the app sends JSON), refusing anything oversized before decoding. */
export function decodeBase64(b64: unknown, maxBytes: number): Uint8Array {
  if (typeof b64 !== "string" || !b64) throw new HttpError(400, "missing data");
  if (b64.length > Math.ceil(maxBytes * 4 / 3) + 8) throw new HttpError(413, "too large");
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new HttpError(400, "bad base64");
  }
}

/** Keeps the exchange in the inbox so the feed reads as one conversation: my line, then what came back.
 *  Edits replace the earlier message with the same id (a card updating in place), so only the final text is kept. */
export async function recordExchange(user: User, mine: string, messages: EntryMessage[], startedAt?: string, replyTo?: string): Promise<void> {
  try {
    // Stamped when the request began: anything the coach wrote meanwhile (a reminder, a penalty) sorts after the question.
    await dbDeps.insert(user.id, { kind: "user", body: mine.slice(0, 1000), actions: [], at: startedAt, replyTo });
    const order: number[] = [];
    const last = new Map<number, EntryMessage>();
    for (const m of messages) {
      if (!m.body.trim()) continue;
      if (!last.has(m.id)) order.push(m.id);
      last.set(m.id, m);
    }
    for (const id of order) {
      const m = last.get(id)!;
      await dbDeps.insert(user.id, { kind: "coach", body: m.body, actions: m.actions });
    }
  } catch (e) {
    console.error("feed record", String(e));   // the answer already went back; history is best-effort
  }
}

export async function entryText(user: User, text: unknown, replyTo?: unknown): Promise<EntryResult> {
  if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "empty text");
  if (text.length > LIMITS.text) throw new HttpError(413, "text too long");
  const startedAt = new Date().toISOString();
  // Swipe to reply: the quoted message (only one of the user's own) travels with the line as context for the model.
  let quoted: { id: string; body: string } | null = null;
  if (typeof replyTo === "string" && /^[0-9a-f-]{36}$/.test(replyTo)) {
    const { data } = await db.from("inbox").select("id, body").eq("id", replyTo).eq("user_id", user.id).maybeSingle();
    quoted = (data as { id: string; body: string } | null) ?? null;
  }
  const { out } = await withCapture(() => handleText(user, text.trim(), quoted?.body.slice(0, 600)));
  const messages = toMessages(out);
  await recordExchange(user, text.trim(), messages, startedAt, quoted?.id);
  return { messages };
}

export async function entryVoice(user: User, body: { audio?: unknown; mime?: unknown }): Promise<EntryResult> {
  const bytes = decodeBase64(body.audio, LIMITS.audioBytes);
  const mime = typeof body.mime === "string" && /^audio\/[a-z0-9.+-]{1,30}$/i.test(body.mime) ? body.mime : "audio/mp4";
  if (!(await takeAi(user))) return { messages: [{ id: 0, kind: "message", replaces: false, body: limitText(user), actions: [] }] };
  let transcript: string;
  try {
    transcript = (await transcribe(bytes, mime)).trim();
  } catch (e) {
    console.error("voice", String(e));
    throw new HttpError(502, t(user, "Не удалось расшифровать: Gemini не ответил. Попробуй ещё раз или текстом."));
  }
  if (!transcript) throw new HttpError(422, t(user, "В голосовом не слышно речи."));
  const r = await entryText(user, transcript);   // records the exchange (the transcript is the user's line)
  return { ...r, transcript };
}

export async function entryMealPhoto(user: User, body: { image?: unknown; caption?: unknown }): Promise<EntryResult> {
  const bytes = decodeBase64(body.image, LIMITS.photoBytes);
  const caption = typeof body.caption === "string" ? body.caption.slice(0, 200) : undefined;
  const { out } = await withCapture(() => mealPhotoBytes(user, bytes, caption));
  const messages = toMessages(out);
  await recordExchange(user, caption ? `📷 ${caption}` : "📷", messages);
  return { messages };
}
