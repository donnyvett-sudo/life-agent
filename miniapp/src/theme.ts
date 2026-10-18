// Тема: системная (по Telegram / устройству), светлая или тёмная. Выбор хранится на устройстве.
import { useEffect, useState } from "react";
import { inTelegram, webApp } from "./tg";

export type ThemeMode = "system" | "light" | "dark";
const KEY = "theme";

// Совпадают с --bg в styles.css — чтобы шапка Telegram была того же цвета.
const BG = { light: "#f6f3ec", dark: "#151411" };

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* недоступно — по умолчанию */ }
  return "system";
}

function systemScheme(): "light" | "dark" {
  // Вне Telegram скрипт всё равно отдаёт colorScheme "light" — там верим устройству.
  if (inTelegram && webApp?.colorScheme) return webApp.colorScheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(mode: ThemeMode) {
  const scheme = mode === "system" ? systemScheme() : mode;
  document.documentElement.dataset.theme = scheme;
  try {
    webApp?.setHeaderColor?.(BG[scheme]);
    webApp?.setBackgroundColor?.(BG[scheme]);
    webApp?.setBottomBarColor?.(BG[scheme]);
  } catch { /* старые клиенты Telegram */ }
}

/** Применить сохранённую тему до первого рендера (без мигания). */
export function initTheme() {
  apply(readMode());
  const onChange = () => readMode() === "system" && apply("system");
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
  webApp?.onEvent?.("themeChanged", onChange);
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  useEffect(() => apply(mode), [mode]);
  return [
    mode,
    (m) => {
      try {
        localStorage.setItem(KEY, m);
      } catch { /* не критично */ }
      setMode(m);
    },
  ];
}

// Акцент от оболочки (iOS/Mac): window.__setAccent(light, dark) красит --accent; цвет текста на нём фиксирован ради контраста.
const ACCENT_KEY = "accent";
function paintAccent(light: string, dark: string) {
  const soft = (c: string) => {
    const n = parseInt(c.replace("#", ""), 16);
    return Number.isNaN(n) ? c : `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, 0.15)`;
  };
  let el = document.getElementById("accent-override");
  if (!el) {
    el = document.createElement("style");
    el.id = "accent-override";
    document.head.appendChild(el);
  }
  const L = `--accent:${light};--accent-soft:${soft(light)};--on-accent:#fff;`;
  const D = `--accent:${dark};--accent-soft:${soft(dark)};--on-accent:#151411;`;
  el.textContent = `:root,:root[data-theme="light"]{${L}}:root[data-theme="dark"]{${D}}`;
}

export function initAccent() {
  window.__setAccent = (light, dark) => {
    paintAccent(light, dark);
    try {
      localStorage.setItem(ACCENT_KEY, JSON.stringify({ light, dark }));
    } catch { /* не критично */ }
  };
  try {
    const v = JSON.parse(localStorage.getItem(ACCENT_KEY) ?? "null");
    if (v?.light && v?.dark) paintAccent(v.light, v.dark);
  } catch { /* битый JSON — игнорируем */ }
}
