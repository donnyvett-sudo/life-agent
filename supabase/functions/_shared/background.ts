// Work that may outlive the HTTP answer. While a request is being captured (POST /entry) the work is awaited,
// so its output lands in the answer; otherwise it is handed to the edge runtime.
import { capturing } from "./telegram.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export async function background(task: () => Promise<void>): Promise<void> {
  if (capturing()) {
    await task().catch((e) => console.error("background", e));
    return;
  }
  const p = task().catch((e) => console.error("background", e));
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
}
