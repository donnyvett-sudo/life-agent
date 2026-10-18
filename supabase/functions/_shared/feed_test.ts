import { assertEquals } from "jsr:@std/assert@1";
import { type EntryMessage, recordExchange } from "./app/entry.ts";
import { dbDeps, type Message } from "./notify.ts";
import type { User } from "./db.ts";

Deno.test("recordExchange: my line first, then each reply once, edits replace", async () => {
  const saved: Message[] = [];
  const orig = dbDeps.insert;
  dbDeps.insert = (_u, m) => { saved.push(m); return Promise.resolve("id"); };
  try {
    const msgs: EntryMessage[] = [
      { id: 7, kind: "message", replaces: false, body: "Считаю…", actions: [] },
      { id: 7, kind: "edit", replaces: true, body: "Готово: 480 ккал", actions: [{ id: "x:1", label: "ok" }] },
      { id: 8, kind: "message", replaces: false, body: "  ", actions: [] },
    ];
    await recordExchange({ id: "u1" } as unknown as User, "съел омлет", msgs);
    assertEquals(saved.map((m) => [m.kind, m.body]), [["user", "съел омлет"], ["coach", "Готово: 480 ккал"]]);
    assertEquals(saved[1].actions.length, 1);
  } finally {
    dbDeps.insert = orig;
  }
});

Deno.test("recordExchange never throws", async () => {
  const orig = dbDeps.insert;
  dbDeps.insert = () => Promise.reject(new Error("db down"));
  try {
    await recordExchange({ id: "u1" } as unknown as User, "x", []);
  } finally {
    dbDeps.insert = orig;
  }
});
