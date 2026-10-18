import { AsyncLocalStorage } from "node:async_hooks";
import { type Lang, t } from "./i18n.ts";
import { redact } from "./redact.ts";
const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const API = `https://api.telegram.org/bot${TOKEN}`;

export type InlineButton = { text: string; callback_data?: string; web_app?: { url: string } };
export type Keyboard = InlineButton[][];

// ------------------------------------------------------------------ capture ---
// Inside withCapture() nothing goes to Telegram: sends and edits are recorded instead. That lets the same
// pipeline answer an HTTP call (POST /entry) with what the bot would have said.
export type Captured = { kind: "message" | "edit" | "voice" | "photo" | "document"; text: string; keyboard?: Keyboard; messageId: number };
const capture = new AsyncLocalStorage<Captured[]>();

/** A Telegram message id worth keeping: none while capturing (the message never reached Telegram). */
export function storableId(id: number | null | undefined): number | null {
  return capturing() || !id ? null : id;
}

export function capturing(): boolean {
  return capture.getStore() !== undefined;
}

export async function withCapture<T>(fn: () => Promise<T>): Promise<{ result: T; out: Captured[] }> {
  const out: Captured[] = [];
  const result = await capture.run(out, fn);
  return { result, out };
}

function record(kind: Captured["kind"], text: string, keyboard?: Keyboard, messageId?: number): number | null {
  const store = capture.getStore();
  if (!store) return null;
  // Random, not counted: ids only need to match within one captured request and are never stored.
  const id = messageId ?? 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  store.push({ kind, text, keyboard, messageId: id });
  return id;
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    const err = new Error(`telegram ${method}: ${json.description}`);
    // 403: бота заблокировали или аккаунт удалён — писать дальше бесполезно.
    if (json.error_code === 403) err.name = "BotBlocked";
    throw err;
  }
  return json.result as T;
}

export async function send(chatId: number | null, text: string, keyboard?: Keyboard) {
  { const id = record("message", text, keyboard); if (id !== null) return id; }
  if (chatId === null) return 0;   // a user without Telegram: nothing to deliver there
  const msg = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  return msg.message_id;
}

/** Удалить сообщение бота (например, с показанным токеном). Ошибки не критичны. */
export async function deleteMessage(chatId: number | null, messageId: number) {
  { if (capturing()) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

/** Переслать фото по file_id: доказательство обещания уходит другу. */
export async function sendPhoto(chatId: number | null, fileId: string, caption: string, keyboard?: Keyboard) {
  { const id = record("photo", caption, keyboard); if (id !== null) return id; }
  if (chatId === null) return 0;   // a user without Telegram: nothing to deliver there
  const msg = await call<{ message_id: number }>("sendPhoto", {
    chat_id: chatId,
    photo: fileId,
    caption,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  return msg.message_id;
}

/** Файл вложением: выгрузка данных. Только multipart, JSON-тело файл не примет. */
export async function sendDocument(chatId: number | null, name: string, content: string, caption?: string) {
  { const id = record("document", caption ?? name, undefined); if (id !== null) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("document", new Blob([content], { type: "application/octet-stream" }), name);
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram sendDocument: ${json.description}`);
}

/** Голосовое: файл (MP3) или file_id уже загруженного. Возвращает file_id — по нему шлём повторно без загрузки. */
export async function sendVoice(
  chatId: number | null,
  voice: Uint8Array<ArrayBuffer> | string,
  caption?: string,
  keyboard?: Keyboard,
): Promise<{ messageId: number; fileId: string }> {
  if (capturing()) { const id = record("voice", caption ?? "", keyboard) ?? 0; return { messageId: id, fileId: "" }; }
  if (chatId === null) return { messageId: 0, fileId: "" };   // a user without Telegram
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  if (keyboard) form.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
  if (typeof voice === "string") form.append("voice", voice);
  else form.append("voice", new Blob([voice], { type: "audio/mpeg" }), "voice.mp3");
  const res = await fetch(`${API}/sendVoice`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`telegram sendVoice: ${json.description}`);
  return { messageId: json.result.message_id, fileId: json.result.voice?.file_id ?? json.result.audio?.file_id };
}

/** Подпись под голосовым (у него нет текста, editMessageText не подходит). */
export async function editCaption(chatId: number | null, messageId: number, caption: string, keyboard?: Keyboard) {
  { if (record("edit", caption, keyboard, messageId) !== null) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("editMessageCaption", {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

export async function edit(chatId: number | null, messageId: number, text: string, keyboard?: Keyboard) {
  { if (record("edit", text, keyboard, messageId) !== null) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard ?? [] },
    });
  } catch (e) {
    // «message is not modified» и удалённые сообщения — не критично.
    console.warn(redact(String(e)));
  }
}

export async function dropKeyboard(chatId: number | null, messageId: number) {
  { if (capturing()) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

export async function answerCallback(id: string, text?: string) {
  try {
    await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

export const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export async function typing(chatId: number | null) {
  { if (capturing()) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

const COMMANDS: [string, string][] = [
  ["app", "Открыть приложение"],
  ["food", "Еда за сегодня"],
  ["today", "Добавки за сегодня"],
  ["sleep", "Последняя ночь"],
  ["study", "Дедлайны и контрольные"],
  ["focus", "Фокус-сессия: /focus 25"],
  ["cards", "Повторить карточки"],
  ["promise", "Дать слово другу"],
  ["budget", "Лимиты трат на месяц"],
  ["subs", "Подписки и регулярные списания"],
  ["month", "Итоги месяца"],
  ["shortcut", "Передача сна с iPhone"],
  ["export", "Копия всех данных файлом"],
  ["help", "Справка"],
];

/** Кнопка меню чата → Mini App, и список команд на языке этого чата. Идемпотентно. */
export async function setupChat(chatId: number | null, appUrl: string, l: Lang = "ru") {
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("setChatMenuButton", {
      chat_id: chatId,
      menu_button: { type: "web_app", text: t(l, "Открыть"), web_app: { url: appUrl } },
    });
    // Команды ставим для конкретного чата: у разных людей разные языки.
    await call("setMyCommands", {
      scope: { type: "chat", chat_id: chatId },
      commands: COMMANDS.map(([command, description]) => ({ command, description: t(l, description) })),
    });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

export async function setKeyboard(chatId: number | null, messageId: number, keyboard: Keyboard) {
  { if (capturing()) return; }
  if (chatId === null) return;   // a user without Telegram: nothing to deliver there
  try {
    await call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (e) {
    console.warn(redact(String(e)));
  }
}

/** Скачать файл Telegram (голосовое и т.п.). */
export async function downloadFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const f = await call<{ file_path: string }>("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`download ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: f.file_path };
}
