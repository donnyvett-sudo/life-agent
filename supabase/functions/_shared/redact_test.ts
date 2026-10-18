import { assertEquals } from "jsr:@std/assert@1";
import { redact } from "./redact.ts";

Deno.test("redact: bot token removed from an error URL", () => {
  assertEquals(redact("fetch https://api.telegram.org/bot123456:AAE-x_y9/sendMessage failed"), "fetch https://api.telegram.org/bot<redacted>/sendMessage failed");
  assertEquals(redact("nothing here"), "nothing here");
});
