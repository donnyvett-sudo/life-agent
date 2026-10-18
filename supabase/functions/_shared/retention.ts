// Daily housekeeping for tables that only ever grew. Everything deleted here is derived, expired or already used.
import { db } from "./db.ts";

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

export async function cleanup(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const run = async (name: string, f: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await f();
    if (error) out[name] = error.message;
  };
  await run("auth_failures", () => db.from("auth_failures").delete().lt("at", iso(ago(1))));
  await run("idempotency_keys", () => db.from("idempotency_keys").delete().lt("created_at", iso(ago(1))));
  await run("pairing_codes", () => db.from("pairing_codes").delete().lt("expires_at", iso(ago(1))));
  await run("inbox", () => db.from("inbox").delete().lt("created_at", iso(ago(90))));
  await run("reminders", () => db.from("reminders").delete().lt("local_date", day(ago(14))));
  await run("agent_jobs", () => db.from("agent_jobs").delete().in("status", ["done", "failed"]).lt("created_at", iso(ago(7))));
  await run("devices", () => db.from("devices").delete().is("token_id", null)); // their token is gone: a dead row in the device list
  return out;
}
