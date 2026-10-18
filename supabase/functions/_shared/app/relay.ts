// Mac agent relay: the phone queues a question, Life Desk on the Mac claims it, runs Claude in the Study Agent folder
// and posts the answer into the inbox (the Feed). The Mac only talks to this API; nothing connects to the Mac.
import { check, db, type User } from "../db.ts";
import { dbDeps, notifyWith, type Message } from "../notify.ts";
import { HttpError } from "./finance.ts";

type Body = Record<string, unknown>;
type Job = { id: string; prompt: string; status: string; claimed_at: string | null };

export const MAX_OPEN = 5;
export const STALE_MIN = 30;   // longer than the Mac's own 25-minute limit
export const QUEUE_MIN = 30;   // a question nobody picked up in this time is closed: it would be answered against the wrong day
export const MAX_PER_HOUR = 20;

export async function enqueue(user: User, b: Body) {
  const prompt = String(b.prompt ?? "").trim();
  if (!prompt || prompt.length > 2000) throw new HttpError(400, "prompt must be 1-2000 characters");
  await expireStale(user);
  const { count } = await db.from("agent_jobs").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).in("status", ["queued", "running"]);
  if ((count ?? 0) >= MAX_OPEN) throw new HttpError(429, "too many open questions");
  const hour = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recent } = await db.from("agent_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", hour);
  if ((recent ?? 0) >= MAX_PER_HOUR) throw new HttpError(429, "too many questions this hour");
  const row = check(await db.from("agent_jobs").insert({ user_id: user.id, prompt }).select("id").single()) as { id: string };
  await dbDeps.insert(user.id, { kind: "user", body: "🖥 " + prompt.slice(0, 1000), actions: [] }).catch(() => {});
  return { id: row.id, status: "queued" };
}

/** Jobs the Mac never finished (it went to sleep or quit) are closed with a note instead of hanging forever. */
async function expireStale(user: User) {
  const cutoff = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
  const old0 = new Date(Date.now() - QUEUE_MIN * 60_000).toISOString();
  // An idle Mac polls every 20 s: look first, write only when something has actually expired.
  const { count: expired } = await db.from("agent_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id)
    .or(`and(status.eq.running,claimed_at.lt.${cutoff}),and(status.eq.queued,created_at.lt.${old0})`);
  if (!expired) return;
  const rows = check(
    await db.from("agent_jobs").update({ status: "failed", finished_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("status", "running").lt("claimed_at", cutoff).select("prompt"),
  ) as { prompt: string }[];
  // Questions nobody picked up: close them with a note.
  const old = new Date(Date.now() - QUEUE_MIN * 60_000).toISOString();
  const dropped = check(
    await db.from("agent_jobs").update({ status: "failed", finished_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("status", "queued").lt("created_at", old).select("prompt"),
  ) as { prompt: string }[];
  for (const r of dropped) {
    await notifyWith(notifyOnly, user, { kind: "system", body: `🖥 The Mac was not available: “${r.prompt.slice(0, 80)}” was not answered.`, actions: [] });
  }
  for (const r of rows) {
    await notifyWith(notifyOnly, user, { kind: "system", body: `🖥 The Mac did not finish: “${r.prompt.slice(0, 80)}”`, actions: [] });
  }
}
const notifyOnly = { insert: dbDeps.insert, telegram: async () => {} };

/** Oldest queued job, marked running. A second Mac (or a double poll) loses the race and gets null. */
export async function claim(user: User) {
  await expireStale(user);
  const next = check(
    await db.from("agent_jobs").select("id,prompt").eq("user_id", user.id).eq("status", "queued")
      .order("created_at").limit(1),
  ) as Job[];
  if (!next.length) return { job: null };
  const { count } = await db.from("agent_jobs").update({ status: "running", claimed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", next[0].id).eq("status", "queued");
  return { job: count ? { id: next[0].id, prompt: next[0].prompt } : null };
}

export async function finish(user: User, id: string, b: Body) {
  const ok = b.ok !== false;
  const answer = String(b.answer ?? "").trim().slice(0, 6000);
  const { count } = await db.from("agent_jobs").update({ status: ok ? "done" : "failed", finished_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id).eq("user_id", user.id).eq("status", "running");
  if (!count) throw new HttpError(409, "not running");
  const m: Message = { kind: "coach", body: "🖥 " + (answer || (ok ? "Done." : "The Mac could not answer.")), actions: [] };
  await notifyWith(notifyOnly, user, m);
  return { ok: true };
}
