import { check, db, type User } from "./db.ts";

/**
 * Changes some keys of users.state against the row as it is NOW, not against the copy loaded when the request began:
 * two requests (the app and the bot) that touch different keys no longer erase each other's.
 */
export async function patchState(user: User, patch: Record<string, unknown>, remove: string[] = []): Promise<void> {
  const row = check(await db.from("users").select("state").eq("id", user.id).maybeSingle()) as { state: Record<string, unknown> } | null;
  const fresh: Record<string, unknown> = { ...(row?.state ?? user.state), ...patch };
  for (const k of remove) delete fresh[k];
  check(await db.from("users").update({ state: fresh }).eq("id", user.id));
  user.state = fresh;
}
