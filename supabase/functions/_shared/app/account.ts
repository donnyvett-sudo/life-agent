// Account control over HTTP, so nothing needs the Telegram bot: export my data, delete my account, manage friends (owner).
import { collect, transactionsCsv } from "../backup.ts";
import { db, type User } from "../db.ts";
import { deleteAccount, friends, pendingInvites, revokeInvite, setAllowed } from "../invites.ts";
import { createPairingCode, dbPairingStore } from "../pairing.ts";
import { dbDeps } from "../notify.ts";
import { HttpError } from "./finance.ts";

type Body = Record<string, unknown>;

/** {filename, content}: the app saves or shares it as a file. Tokens are not part of it. */
export async function exportData(user: User, format: string | null) {
  const b = await collect(user);
  const day = new Date().toISOString().slice(0, 10);
  return format === "csv"
    ? { filename: `life-transactions-${day}.csv`, content: transactionsCsv(b) }
    : { filename: `life-export-${day}.json`, content: JSON.stringify(b) };
}

/** Deletes the caller's own account and everything under it. The owner cannot: the bot and the invites hang on them. */
export async function removeAccount(user: User, b: Body) {
  if (user.is_owner) throw new HttpError(403, "the owner account cannot be deleted");
  if (b.confirm !== "DELETE") throw new HttpError(400, "confirmation required");
  const owner = user.invited_by;
  const name = user.first_name ?? "A friend";
  await deleteAccount(user);
  if (owner) await dbDeps.insert(owner, { kind: "system", body: `${name} deleted their account.`, actions: [] }).catch(() => {});
  return { ok: true };
}

function ownerOnly(user: User) {
  if (!user.is_owner) throw new HttpError(403, "owner only");
}

export async function friendsList(user: User) {
  ownerOnly(user);
  const [list, pend] = await Promise.all([friends(user.id), pendingInvites(user.id)]);
  return {
    friends: list.map((f) => ({ id: f.id, name: f.first_name ?? "—", allowed: f.is_allowed })),
    invites: pend.map((i) => ({ code: i.code, expiresAt: i.expires_at })),
  };
}

export async function setFriendAccess(user: User, id: string, b: Body) {
  ownerOnly(user);
  if (typeof b.allowed !== "boolean") throw new HttpError(400, "allowed required");
  if (!(await setAllowed(user.id, id, b.allowed))) throw new HttpError(404, "no such friend");
  if (!b.allowed) await db.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", id).is("revoked_at", null); // closing access also ends their sessions
  return friendsList(user);
}

export async function revokeFriendInvite(user: User, code: string) {
  ownerOnly(user);
  if (!(await revokeInvite(user.id, code))) throw new HttpError(404, "no such invite");
  return friendsList(user);
}

/** The owner re-opens a friend's access (a lost phone, a Home Screen copy): a fresh one-time code for that friend. */
export async function friendCode(user: User, id: string) {
  ownerOnly(user);
  const mine = (await friends(user.id)).find((f) => f.id === id);
  if (!mine || !mine.is_allowed) throw new HttpError(404, "no such friend");
  return createPairingCode(dbPairingStore, id, ["app", "ingest"]);
}
