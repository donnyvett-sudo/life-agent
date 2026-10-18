import { assertEquals } from "jsr:@std/assert@1";
import { actionsFromKeyboard, fromOutgoing, htmlToMarkdown, type Message, type NotifyDeps, notifyWith } from "./notify.ts";
import { parseAction } from "./actions.ts";
import type { User } from "./db.ts";

Deno.test("html becomes markdown-lite", () => {
  assertEquals(htmlToMarkdown("Сон: <b>7 ч 10 м</b> &amp; <i>глубокий</i> 1 ч"), "Сон: **7 ч 10 м** & _глубокий_ 1 ч");
  assertEquals(htmlToMarkdown('<a href="https://x.y/z">ссылка</a> и <code>1 &lt; 2</code>'), "[ссылка](https://x.y/z) и `1 < 2`");
  assertEquals(htmlToMarkdown("a<br>b<s>c</s>"), "a\nb~~c~~");
});

Deno.test("keyboard becomes actions, web_app becomes a link", () => {
  const a = actionsFromKeyboard([[{ text: "✅ Принял", callback_data: "s:t:abc" }, { text: "⏰", callback_data: "s:z:abc" }], [{ text: "Открыть", web_app: { url: "https://app" } }]]);
  assertEquals(a, [
    { id: "s:t:abc", label: "✅ Принял" },
    { id: "s:z:abc", label: "⏰" },
    { id: "open", label: "Открыть", url: "https://app" },
  ]);
  assertEquals(actionsFromKeyboard(undefined), []);
  // card edits have no HTTP action yet: no dead buttons
  assertEquals(actionsFromKeyboard([[{ text: "ok", callback_data: "ml:ok:1" }, { text: "✏️", callback_data: "ml:ed:1" }, { text: "x", callback_data: "tf:2" }]]), [{ id: "ml:ok:1", label: "ok" }]);
});

Deno.test("action ids: plain ids only", () => {
  assertEquals(parseAction("s:t:6f1c0d2e-aaaa-bbbb-cccc-111122223333"), { type: "s", a: "t", b: "6f1c0d2e-aaaa-bbbb-cccc-111122223333" });
  assertEquals(parseAction("hw:42"), { type: "hw", a: "42", b: undefined });
  for (const bad of ["", "s:t:a:b", "SELECT:1", "h:../x", "h: x", "fc:go;drop", 42, null, "x".repeat(300)]) {
    assertEquals(parseAction(bad), null, String(bad));
  }
});

function deps() {
  const inserted: Message[] = [];
  const sent: string[] = [];
  const d: NotifyDeps = {
    insert: (_u, m) => { inserted.push(m); return Promise.resolve("inbox-1"); },
    telegram: (_u, text) => { sent.push(text); return Promise.resolve(); },
  };
  return { d, inserted, sent };
}
const u = (extra: Record<string, unknown> = {}) => ({ id: "u1", tg_id: 7, ...extra }) as unknown as User;

Deno.test("notify: inbox always, telegram only while on and linked", async () => {
  const out = { text: "<b>Привет</b>", keyboard: [[{ text: "ок", callback_data: "h:1" }]] };
  const m = fromOutgoing(out);
  let f = deps();
  await notifyWith(f.d, u(), m, out);
  assertEquals([f.inserted.length, f.sent], [1, ["<b>Привет</b>"]]);
  f = deps();
  await notifyWith(f.d, u({ notify_telegram: false }), m, out);
  assertEquals([f.inserted.length, f.sent.length], [1, 0]);
  f = deps();
  await notifyWith(f.d, u({ tg_id: null }), m, out);
  assertEquals([f.inserted.length, f.sent.length], [1, 0]);
});

Deno.test("notify: an inbox failure does not stop Telegram", async () => {
  const sent: string[] = [];
  const d: NotifyDeps = {
    insert: () => Promise.reject(new Error("relation inbox does not exist")),
    telegram: (_u, text) => { sent.push(text); return Promise.resolve(); },
  };
  const out = { text: "hi" };
  await notifyWith(d, u(), fromOutgoing(out), out);
  assertEquals(sent, ["hi"]);
});

Deno.test("web push goes to people without a Telegram delivery, never both, never for their own lines", async () => {
  const pushed: string[] = [];
  const { d } = deps();
  d.push = (_u, m) => { pushed.push(m.body); return Promise.resolve(); };
  const msg = (kind: Message["kind"]): Message => ({ kind, body: kind, actions: [] });
  await notifyWith(d, { id: "u", tg_id: 1, notify_telegram: true } as User, msg("coach"), { text: "t" });
  await notifyWith(d, { id: "u", tg_id: null } as User, msg("coach"));
  await notifyWith(d, { id: "u", tg_id: 1, notify_telegram: false } as User, msg("reminder"));
  await notifyWith(d, { id: "u", tg_id: null } as User, msg("user"));
  assertEquals(pushed, ["coach", "reminder"]);
});

Deno.test("promise buttons are runnable in the Feed; wizard-only ones are not", () => {
  const kb = [[{ text: "y", callback_data: "pry:1" }, { text: "p", callback_data: "prs:1:2" }, { text: "w", callback_data: "prt:0" }]];
  assertEquals(actionsFromKeyboard(kb).map((a) => a.id), ["pry:1", "prs:1:2"]);
});

Deno.test("brackets in user text cannot become links, our own links still work", () => {
  assertEquals(htmlToMarkdown("[Подтверди вход](https://evil.example) от друга"), "\\[Подтверди вход\\](https://evil.example) от друга");
  assertEquals(htmlToMarkdown('<a href="https://x.y">ok</a>'), "[ok](https://x.y)");
});
