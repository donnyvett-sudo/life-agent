// Обещания по HTTP: список в обе стороны и создание без мастера бота. Ответы друга и отмена идут через /actions (pr*).
import { check, db, type User } from "../db.ts";
import { circle, createPromise, type Promise_ } from "../promises.ts";
import { localNow, shiftDate } from "../time.ts";
import { HttpError } from "./finance.ts";

type Body = Record<string, unknown>;
const name = (u: { first_name: string | null }) => u.first_name ?? "Friend";

export async function promisesList(user: User) {
  const [mine, toMe, friends] = await Promise.all([
    db.from("promises").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(40),
    db.from("promises").select("*").eq("to_user_id", user.id).order("created_at", { ascending: false }).limit(40),
    circle(user),
  ]);
  const names = new Map<string, string>();
  const rows = [...(check(mine) as Promise_[]), ...(check(toMe) as Promise_[])];
  const ids = [...new Set(rows.flatMap((p) => [p.user_id, p.to_user_id]))];
  if (ids.length) {
    for (const u of check(await db.from("users").select("id,first_name").in("id", ids)) as { id: string; first_name: string | null }[]) {
      names.set(u.id, name(u));
    }
  }
  const out = (p: Promise_) => ({
    id: p.id, title: p.title, due: p.due_date, status: p.status, kind: p.check_kind, penalty: p.penalty,
    from: names.get(p.user_id) ?? "Friend", to: names.get(p.to_user_id) ?? "Friend", proof: !!p.proof_file_id,
  });
  return {
    mine: (check(mine) as Promise_[]).map(out),
    toMe: (check(toMe) as Promise_[]).map(out),
    friends: friends.map((f) => ({ id: f.id, name: name(f) })),
    today: localNow(user.tz).date,
  };
}

/** body: {to, title, due, kind: "friend" | "sleep"}. Фото-доказательство пока только через бота. */
export async function createPromiseFromApp(user: User, b: Body) {
  const friend = (await circle(user)).find((f) => f.id === b.to);
  if (!friend) throw new HttpError(400, "unknown friend");
  const title = String(b.title ?? "").trim().slice(0, 120);
  if (title.length < 3) throw new HttpError(400, "title too short");
  const today = localNow(user.tz).date;
  const due = String(b.due ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < today || due > shiftDate(today, 365)) throw new HttpError(400, "bad due date");
  const kind = b.kind === "sleep" ? "sleep" : "friend";
  await createPromise(user, { to: friend.id, title, due }, kind);
  return promisesList(user);
}
