import { assertEquals } from "jsr:@std/assert@1";
import { cleanDocs, MAX_PER_KIND } from "./study_docs.ts";

Deno.test("cleanDocs keeps good documents and drops bad ones", () => {
  const r = cleanDocs({
    notice: [{ key: "a", data: { t: 1 } }, { key: "a", data: { t: 2 } }, { key: "", data: {} }, { key: "b", data: [] }, { data: {} }, null],
    file: [{ key: "x", data: { path: "p" } }],
    unknown: [{ key: "z", data: {} }],
  });
  assertEquals(r.notice?.map((d) => d.key), ["a"]);           // duplicate, empty, array data, no key: gone
  assertEquals(r.file?.length, 1);
  assertEquals("unknown" in r, false);
  assertEquals(r.course_info, undefined);                      // a kind that was not sent is left alone
});

Deno.test("cleanDocs limits count and size", () => {
  const many = Array.from({ length: MAX_PER_KIND + 50 }, (_, i) => ({ key: `k${i}`, data: {} }));
  assertEquals(cleanDocs({ source: many }).source?.length, MAX_PER_KIND);
  assertEquals(cleanDocs({ course_info: [{ key: "c", data: { markdown: "x".repeat(50_000) } }] }).course_info?.length, 0);
  assertEquals(cleanDocs("nonsense"), {});
});
