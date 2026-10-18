import { api } from "./api";

/** Web Push нужен только входу без Telegram; на iPhone работает после «На экран Домой» (iOS 16.4+). */
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Вызывать из нажатия кнопки: iOS показывает запрос разрешения только по жесту. */
export async function enablePush(): Promise<"ok" | "denied" | "unsupported" | "unavailable"> {
  if (!pushSupported()) return "unsupported";
  const { key } = await api<{ key: string | null }>("GET", "/push/key");
  if (!key) return "unavailable";
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api("POST", "/push/subscribe", sub.toJSON());
  return "ok";
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("POST", "/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}

/** On every launch: permission was granted earlier but the browser lost the subscription (iOS does that) — subscribe again silently. */
export async function refreshPush() {
  try {
    if (!pushSupported() || Notification.permission !== "granted" || (await pushEnabled())) return;
    await enablePush();
  } catch { /* not critical */ }
}
