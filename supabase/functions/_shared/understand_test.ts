import { assertEquals } from "jsr:@std/assert@1";
import { type Action, execute, type ExecDeps, parseActions } from "./understand.ts";
import type { User } from "./db.ts";

Deno.test("one phrase, two records: canteen expense and the meal", () => {
  const u = parseActions(JSON.stringify({ actions: [
    { type: "expense", amount: 18, currency: "CNY", note: "Canteen", days_ago: 0 },
    { type: "meal", food: "рис с курицей" },
  ], question: false }), "CNY");
  assertEquals(u.actions.map((a) => a.type), ["expense", "meal"]);
  assertEquals(u.question, false);
});

Deno.test("garbage, negative sums, unknown types and broken JSON are dropped, not guessed", () => {
  const u = parseActions(JSON.stringify({ actions: [
    { type: "expense", amount: -5 }, { type: "expense", amount: "abc" }, { type: "drop_tables" }, null, "x",
    { type: "weight", kg: 5000 }, { type: "sleep", bed: "25:00", wake: "08:00" }, { type: "task_add", title: "Lab 5", due: "friday" },
  ] }), "KZT");
  assertEquals(u.actions, [{ type: "task_add", title: "Lab 5", course: null, due: null }]);
  assertEquals(parseActions("not json at all", "CNY"), { actions: [], question: true, needsFiles: false });
});

Deno.test("currency falls back to the user's, notes and lists are capped", () => {
  const u = parseActions(JSON.stringify({ actions: [{ type: "expense", amount: 5, currency: "EUR", note: "x".repeat(99) }] }), "KZT");
  const a = u.actions[0] as Extract<Action, { type: "expense" | "income" }>;
  assertEquals([a.currency, a.note.length, a.daysAgo], ["KZT", 40, 0]);
  const many = parseActions(JSON.stringify({ actions: Array(30).fill({ type: "habit", name: "read" }) }), "CNY");
  assertEquals(many.actions.length, 8);
});

Deno.test("corrections: a fixed expense needs something to fix; supplements default to the whole slot", () => {
  const u = parseActions(JSON.stringify({ actions: [
    { type: "fix_expense" }, { type: "fix_expense", amount: 20 }, { type: "supplements", names: [], slot: "evening" },
  ] }), "CNY");
  assertEquals(u.actions, [
    { type: "fix_expense", amount: 20, note: null, category: null },
    { type: "supplements", names: [], slot: "evening" },
  ]);
});

Deno.test("execute: every action runs, a failing one does not stop the rest", async () => {
  const calls: string[] = [];
  const said: string[] = [];
  const deps = new Proxy({}, {
    get: (_t, k: string) => async (..._a: unknown[]) => {
      if (k === "say") { said.push(String(_a[1])); return; }
      calls.push(k);
      if (k === "meal") throw new Error("gemini down");
      return k === "habit" ? "Отмечено: Reading" : true;
    },
  }) as ExecDeps;
  const actions: Action[] = [
    { type: "expense", amount: 18, currency: "CNY", note: "Canteen", daysAgo: 0, account: null },
    { type: "meal", food: "rice" },
    { type: "habit", name: "reading" },
  ];
  const n = await execute({ id: "u" } as User, actions, "raw", deps);
  assertEquals(calls, ["expense", "meal", "habit"]);
  assertEquals(n, 2);
  assertEquals(said, ["Отмечено: Reading"]);
});

Deno.test("ask: a doubtful record becomes a question with 2-4 answers; a lone option or empty question is dropped", () => {
  const u = parseActions(JSON.stringify({ actions: [], ask: { question: "Куда записать 18 ¥?", options: ["Столовая", "Продукты", "Столовая", "a", "b", "c"] } }), "CNY");
  assertEquals(u.ask, { question: "Куда записать 18 ¥?", options: ["Столовая", "Продукты", "a", "b"] });
  assertEquals(u.question, false);
  assertEquals(parseActions(JSON.stringify({ ask: { question: "?", options: ["one"] } }), "CNY").ask, undefined);
  assertEquals(parseActions(JSON.stringify({ ask: { question: "", options: ["a", "b"] } }), "CNY").ask, undefined);
});
