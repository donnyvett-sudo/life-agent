// Read-only copies of Study Agent files (notices, course info, files, sources, exam topics) for the phone.
import { check, db } from "./db.ts";

export const KINDS = ["notice", "course_info", "file", "source", "exam_topics"] as const;
export type DocKind = (typeof KINDS)[number];
export const MAX_PER_KIND = 2000;
const MAX_JSON = 40_000;

export type DocIn = { key: string; data: Record<string, unknown> };

/** Keeps only well-formed documents of a known kind: string key, plain-object data of limited size. */
export function cleanDocs(raw: unknown): Partial<Record<DocKind, DocIn[]>> {
  const out: Partial<Record<DocKind, DocIn[]>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const kind of KINDS) {
    const list = (raw as Record<string, unknown>)[kind];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const docs: DocIn[] = [];
    for (const d of list.slice(0, MAX_PER_KIND)) {
      const key = typeof d?.key === "string" ? d.key.trim().slice(0, 300) : "";
      const data = d?.data;
      if (!key || seen.has(key) || !data || typeof data !== "object" || Array.isArray(data)) continue;
      if (JSON.stringify(data).length > MAX_JSON) continue;
      seen.add(key);
      docs.push({ key, data: data as Record<string, unknown> });
    }
    out[kind] = docs;
  }
  return out;
}

/** For each kind that was sent, the set is replaced: new and changed keys upserted, missing ones removed. */
export async function syncDocs(userId: string, docs: Partial<Record<DocKind, DocIn[]>>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const kind of KINDS) {
    const list = docs[kind];
    if (!list) continue;
    if (list.length) {
      // seen_at is not in the payload, so an upsert leaves it alone.
      check(await db.from("study_docs").upsert(
        list.map((d) => ({ user_id: userId, kind, key: d.key, data: d.data, updated_at: new Date().toISOString() })),
        { onConflict: "user_id,kind,key" },
      ));
    }
    const have = check(await db.from("study_docs").select("key").eq("user_id", userId).eq("kind", kind)) as { key: string }[];
    const keep = new Set(list.map((d) => d.key));
    const gone = have.map((r) => r.key).filter((k) => !keep.has(k));
    // An empty or much shorter list means the source file was not read properly: keep the old copy.
    if (gone.length && (list.length === 0 || gone.length > Math.max(5, have.length * 0.5))) {
      console.warn("study_docs: kept", gone.length, kind, "rows, the list looked incomplete");
      counts[kind] = list.length;
      continue;
    }
    for (let i = 0; i < gone.length; i += 200) {
      check(await db.from("study_docs").delete().eq("user_id", userId).eq("kind", kind).in("key", gone.slice(i, i + 200)));
    }
    counts[kind] = list.length;
  }
  return counts;
}

export async function listDocs(userId: string, kind: string | null) {
  if (kind !== null && !(KINDS as readonly string[]).includes(kind)) return { docs: [] };
  let q = db.from("study_docs").select("kind, key, data, seen_at, updated_at").eq("user_id", userId).limit(MAX_PER_KIND);
  if (kind) q = q.eq("kind", kind);
  return { docs: check(await q) };
}

/** Marks notices read (all, or the given keys). */
export async function markNoticesSeen(userId: string, keys: unknown): Promise<number> {
  let q = db.from("study_docs").update({ seen_at: new Date().toISOString() }).eq("user_id", userId).eq("kind", "notice").is("seen_at", null);
  if (Array.isArray(keys)) q = q.in("key", keys.filter((k): k is string => typeof k === "string").slice(0, 500));
  const { data } = await q.select("id");
  return data?.length ?? 0;
}
