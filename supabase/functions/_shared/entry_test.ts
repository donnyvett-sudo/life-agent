import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { decodeBase64, toMessages } from "./app/entry.ts";
import { send, edit, withCapture } from "./telegram.ts";

Deno.test("capture: nothing is sent, output is recorded in order", async () => {
  const { result, out } = await withCapture(async () => {
    const id = await send(123, "<b>Считаю…</b>");
    await edit(123, id, "Готово: <b>480 ккал</b>", [[{ text: "✅", callback_data: "ml:ok:abc" }]]);
    return id;
  });
  assertEquals(out.length, 2);
  assertEquals(out[1].messageId, result);   // the edit refers to the message it replaces
  const m = toMessages(out);
  assertEquals(m[0].body, "**Считаю…**");
  assertEquals([m[1].replaces, m[1].body], [true, "Готово: **480 ккал**"]);
  assertEquals(m[1].actions, [{ id: "ml:ok:abc", label: "✅" }]);   // meal buttons run over /actions
});

Deno.test("capture: concurrent requests do not mix", async () => {
  const [a, b] = await Promise.all([
    withCapture(async () => { await new Promise((r) => setTimeout(r, 15)); await send(1, "a"); }),
    withCapture(async () => { await send(2, "b"); }),
  ]);
  assertEquals([a.out.map((x) => x.text), b.out.map((x) => x.text)], [["a"], ["b"]]);
});

Deno.test("base64: size is checked before decoding", async () => {
  assertEquals([...decodeBase64(btoa("hey"), 100)], [104, 101, 121]);
  await assertRejects(async () => decodeBase64("A".repeat(5000), 100));
  await assertRejects(async () => decodeBase64("***", 100));
  await assertRejects(async () => decodeBase64("", 100));
});
