import { Bell, BellOff, Send } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { disablePush, enablePush, pushEnabled, pushSupported, refreshPush } from "../push";
import { Head } from "../ui";

type Action = { id: string; label: string; url?: string };
type Msg = { id: string; kind: string; body: string; actions: Action[]; created_at: string; handled_at: string | null };

const unesc = (s: string) => s.replace(/\\([[\]])/g, "$1"); // сервер экранирует скобки, чтобы текст друзей не стал ссылкой

/** **жирный** и переводы строк; остальное показываем как текст. */
function md(s: string): ReactNode {
  return s.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={j}>{unesc(p.slice(2, -2))}</b> : unesc(p)))}
    </Fragment>
  ));
}

/** Лента: разговор с коучем, все его сообщения с кнопками и строка ввода. Для входа без Telegram. */
export default function Feed() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const [push, setPush] = useState(false);
  useEffect(() => { refreshPush().then(() => pushEnabled()).then(setPush).catch(() => {}); }, []);

  const togglePush = async () => {
    setErr("");
    if (push) { await disablePush(); setPush(false); return; }
    const r = await enablePush().catch(() => "unavailable" as const);
    if (r === "ok") setPush(true);
    else setErr(r === "denied" ? t("Уведомления выключены в настройках браузера.") : r === "unsupported" ? t("Добавь приложение на экран «Домой», тогда уведомления заработают.") : t("Уведомления пока недоступны."));
  };

  const load = useCallback(async () => {
    try {
      const r = await api<{ messages: Msg[] }>("GET", "/inbox?limit=80");
      setMsgs([...r.messages].reverse());
      if (r.messages.some((m) => !("read_at" in m) || (m as { read_at?: string | null }).read_at == null)) {
        api("POST", "/inbox/read-all", {}).catch(() => {});
      }
    } catch { /* офлайн: оставляем, что есть */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  const send = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true); setErr(""); setText("");
    try { await api("POST", "/entry", { text: v }); await load(); }
    catch { setErr(t("Не отправилось. Проверь соединение.")); setText(v); }
    setBusy(false);
  };

  const act = async (a: Action) => {
    if (a.id === "open" && a.url?.startsWith("https://")) { window.open(a.url, "_blank", "noopener"); return; }
    try { await api("POST", "/actions", { id: a.id }); await load(); } catch { setErr(t("Не получилось.")); }
  };

  return (
    <>
      <Head title={t("Лента")} right={pushSupported() ? (
        <button className="gear" onClick={togglePush} aria-label={push ? t("Выключить уведомления") : t("Включить уведомления")}>
          {push ? <Bell size={20} aria-hidden /> : <BellOff size={20} aria-hidden />}
        </button>
      ) : undefined} />
      {msgs.length === 0 && <p className="muted">{t("Напиши коучу: «кофе 18», «съел 2 яйца» или «что на сегодня?».")}</p>}
      <div className="feed">
        {msgs.map((m) => (
          <div key={m.id} className={m.kind === "user" ? "bubble mine" : "bubble"}>
            <div>{md(m.body)}</div>
            {m.kind !== "user" && !m.handled_at && m.actions.length > 0 && (
              <div className="bubble-actions">
                {m.actions.map((a) => <button key={a.id} className="btn ghost" onClick={() => act(a)}>{a.label}</button>)}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {err && <p className="bad" role="alert">{err}</p>}
      <form className="feed-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Скажи коучу…")} aria-label={t("Скажи коучу…")} maxLength={1000} />
        <button className="btn accent" disabled={busy || !text.trim()} aria-label={t("Отправить")}><Send size={18} aria-hidden /></button>
      </form>
    </>
  );
}
