import { useState } from "react";
import { authPost } from "../api";
import { getLang, setLang, t } from "../i18n";
import { setToken } from "../session";

type Issued = { token: string; pairCode?: string };

/** Вход без Telegram: приглашение от владельца (новый человек) или код подключения (уже есть аккаунт). */
export default function Welcome() {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get("join") ?? "";
  const [mode, setMode] = useState<"join" | "pair">("join");
  const [code, setCode] = useState(fromLink);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<Issued | null>(null);

  const go = async () => {
    setBusy(true); setErr("");
    try {
      const device = { deviceName: "Web", platform: "pwa" };
      const r = mode === "join"
        ? await authPost<Issued>("/auth/join", {
            invite: code, firstName: name, consent: agree, lang: getLang(), ...device,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })
        : await authPost<Issued>("/auth/pair", { code, ...device });
      setToken(r.token);
      history.replaceState(null, "", location.pathname);
      // A friend who joined: show the one-time code for the Home Screen copy first (it starts with empty storage).
      if (r.pairCode) { setDone(r); setBusy(false); return; }
      location.reload();
    } catch {
      setErr(mode === "join" ? t("Приглашение не подошло или устарело.") : t("Код не подошёл или устарел."));
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="screen welcome">
        <h1>{t("Готово")}</h1>
        <p>{t("Чтобы приложение жило на экране «Домой»: нажми «Поделиться», затем «На экран Домой», открой его оттуда и выбери «У меня уже есть аккаунт». Введи этот код (действует 10 минут, один раз):")}</p>
        <p className="pair-code">{done.pairCode}</p>
        <button className="btn accent" onClick={() => location.reload()}>{t("Продолжить в браузере")}</button>
      </main>
    );
  }

  return (
    <main className="screen welcome">
      <h1>Life</h1>
      <p className="muted">{t("Сон, траты, еда и учёба в одном месте, с коучем в чате.")}</p>
      <button className="btn ghost" onClick={() => { setLang(getLang() === "ru" ? "en" : "ru"); setErr(""); }}>{getLang() === "ru" ? "English" : "Русский"}</button>
      <p className="muted">{mode === "join" ? t("Ты получил приглашение. Введи код, чтобы начать.") : t("Введи код из приложения Life Desk на Mac: Настройки, iPhone.")}</p>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t("Код")} autoCapitalize="characters" autoCorrect="off" aria-label={t("Код")} />
      {mode === "join" && (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Как тебя зовут")} maxLength={40} aria-label={t("Как тебя зовут")} />
          <label className="agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t("Я согласен, что мои данные (сон, траты, учёба и т. д.) хранятся в базе проекта. Другим участникам они не видны; владелец проекта технически имеет доступ к базе. Удалить всё можно в настройках.")}</span>
          </label>
        </>
      )}
      {err && <p className="bad" role="alert">{err}</p>}
      <button className="btn accent" disabled={busy || code.length < 4 || (mode === "join" && !agree)} onClick={go}>
        {mode === "join" ? t("Начать") : t("Подключить")}
      </button>
      <button className="btn ghost" onClick={() => setMode(mode === "join" ? "pair" : "join")}>
        {mode === "join" ? t("У меня уже есть аккаунт") : t("У меня приглашение")}
      </button>
    </main>
  );
}
