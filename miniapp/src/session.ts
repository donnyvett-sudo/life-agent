// Вход без Telegram (PWA): личный токен устройства лежит в localStorage этого браузера.
const KEY = "device.token";

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(t: string) {
  try { localStorage.setItem(KEY, t); } catch { /* приватный режим: вход не переживёт перезапуск */ }
}
export function clearToken() {
  try { localStorage.removeItem(KEY); } catch { /* не критично */ }
}
