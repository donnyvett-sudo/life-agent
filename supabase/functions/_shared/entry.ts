// The text pipeline behind both the Telegram bot and POST /entry: one place decides what a phrase means.
import type { Account } from "./finance.ts";
import { type Currency, isLunch, type ParsedEntry, parseEntry } from "./parse.ts";
import { type User, userCurrency } from "./db.ts";
import { accountHint, accountsOf, applyTransfer, handleTransfer, handleTransferEdit, looksLikeTransfer } from "./transferbot.ts";
import { checkinAnswer } from "./cards.ts";
import { coachReply } from "./chat.ts";
import { fmtNum, parseWeight, saveWeight } from "./body.ts";
import { handleEdit } from "./editbot.ts";
import { inWizard, promiseText } from "./promises.ts";
import { localNow } from "./time.ts";
import { logEntry } from "./moneybot.ts";
import { looksLikeMoney, parseSpoken, parseSpokenAI, spokenCurrency } from "./spoken.ts";
import { mealEditAnswer, mealText, parseEatText } from "./food.ts";
import { moneyAnswer } from "./spend.ts";
import { send, typing } from "./telegram.ts";
import { sendSupplementReminder } from "./supplements.ts";
import { t } from "./i18n.ts";
import { takeAi } from "./quota.ts";
import { background } from "./background.ts";
import { askChoice, execute, understand } from "./understand.ts";
import { realDeps } from "./understand_deps.ts";

/** Currency of the user: amounts without a currency word are counted in it. */
const cur = (u: User) => userCurrency(u) as Currency;

/** Запись (расход/доход) или разговор с коучем. */
export async function handleText(user: User, text: string, quoted?: string) {
  // После ✏️ под карточкой еды следующее сообщение — правка.
  if (user.state.meal_edit && await mealEditAnswer(user, text)) return;
  // Бот задал вопрос (чек-ин карточек) — следующее сообщение и есть ответ.
  if (await checkinAnswer(user, text)) return;
  // Мастер обещания ждёт одну строку — она не трата и не вопрос коучу.
  if (inWizard(user)) {
    const step = await promiseText(user, text);
    if (step) {
      await send(user.tg_id, step.text, step.keyboard);
      return;
    }
  }
  // Перевод между своими счетами разбираем раньше правок и трат: «перекинул 50000 тенге
  // с Каспи на WeChat» — не расход «Каспи» и не команда «поменяй».
  if ((await handleTransfer(user, text)) !== null) return;
  // Пока перевод — самая свежая запись, «не 690, а 685» относится к нему, а не к давней трате.
  if ((await handleTransferEdit(user, text)) !== null) return;
  // Правка идёт первой: «поменяй на 25» — это не новая трата.
  const edited = await handleEdit(user, text);
  if (edited !== null) {
    if (edited) await send(user.tg_id, edited);
    return;
  }
  // Вес — раньше трат: иначе «вес 71.4» уйдёт в расходы с названием «вес».
  const kg = parseWeight(text);
  if (kg !== null) {
    await saveWeight(user, kg);
    await send(user.tg_id, t(user, "Вес {kg} кг записан.", { kg: fmtNum(user, kg, 1) }));
    return;
  }
  // Счета читаем из базы, только если во фразе есть число: разговор с коучем запросов не стоит.
  const named = /\d/.test(text) ? await namedAccount(user, text) : { account: null, text };
  // Быстрый путь без ИИ: вся фраза — одна однозначная запись («кофе 18»).
  const entry = parseEntry(named.text, cur(user));
  if (entry) {
    const e = onAccount(entry, text, named.account);
    await logEntry(user, text, e, 0, "bot", named.account?.id);
    if (isLunch(e, localNow(user.tz).minutes)) await sendSupplementReminder(user, "lunch", "meal");
    return;
  }
  // Вопрос про деньги считаем сами: точные цифры, лимит ИИ не тратится.
  const money = await moneyAnswer(user, text);
  if (money) {
    await send(user.tg_id, money);
    return;
  }
  // Всё остальное понимает модель: одна фраза может быть тратой, едой, привычкой и вопросом сразу.
  if (await takeAi(user)) {
    const u = await understand(user, text, quoted).catch((e) => { console.warn("understand", String(e)); return null; });
    if (u) {
      if (u.ask) await askChoice(user, u.ask);
      const done = await execute(user, u.actions, text, realDeps);
      if (u.ask && !u.question) return;
      if (done && !u.question) return;
      // A question, a correction the actions could not express, or plain talk: the coach answers (with its own tools).
      background(async () => {
        await typing(user.tg_id);
        const out = await coachReply(user, quoted ? `(${t(user, "Ответ на сообщение")}: «${quoted.slice(0, 300)}»)\n${text}` : text);
        const hint = u.needsFiles ? "\n\n" + t(user, "Подробно по файлам курса ответит агент на Mac: в Ленте нажми 🖥 и спроси там.") : "";
        await send(user.tg_id, out.text + hint, out.keyboard);
      });
      return;
    }
  }
  // Запасной путь (нет лимита или модель недоступна): прежние правила.
  const eaten = parseEatText(text);
  if (eaten) {
    background(() => mealText(user, eaten));
    return;
  }
  // Живая фраза: «потратил 35 на обед», «вчера такси 18 и кофе 25».
  if (looksLikeMoney(text) || looksLikeTransfer(text)) {
    let spoken = parseSpoken(named.text, cur(user));
    // Разбор фразы моделью — тоже обращение к ИИ. Нет лимита — ниже ответит coachReply с текстом лимита.
    if (!spoken.length && await takeAi(user)) {
      const ai = await parseSpokenAI(text, cur(user)).catch(() => ({ entries: [], transfer: null }));
      // Одно обращение к модели отвечает и за перевод, и за траты.
      if (ai.transfer && (await applyTransfer(user, ai.transfer)) !== null) return;
      spoken = ai.entries;
    }
    if (spoken.length) {
      let lunch = false;
      for (const raw of spoken) {
        const e = onAccount(raw, text, named.account);
        await logEntry(user, text, e, e.daysAgo, "bot", named.account?.id);
        lunch ||= e.daysAgo === 0 && isLunch(e, localNow(user.tz).minutes);
      }
      if (lunch) await sendSupplementReminder(user, "lunch", "meal");
      return;
    }
  }
  // Ответ Gemini может занять десятки секунд — отвечаем Telegram сразу, коуча считаем в фоне,
  // иначе Telegram не дождётся webhook и пришлёт апдейт повторно.
  background(async () => {
    await typing(user.tg_id);
    const out = await coachReply(user, text);
    await send(user.tg_id, out.text, out.keyboard);
  });
}
/**
 * Счёт, названный во фразе: «обед 35 с вичата» ляжет на WeChat, а не на основной счёт.
 * Возвращает ещё и фразу без хвоста про счёт — из неё получится чистое название записи.
 */
async function namedAccount(user: User, text: string): Promise<{ account: Account | null; text: string }> {
  const accounts = await accountsOf(user.id);
  return accounts.length > 1 ? accountHint(text, accounts) : { account: null, text };
}
/**
 * Валюта записи, когда в фразе её не назвали: валюта названного счёта.
 * «Пополнил Kaspi на 20000» — это тенге, а не юани по умолчанию.
 */
function onAccount<T extends ParsedEntry>(e: T, text: string, account: Account | null): T {
  return account && !spokenCurrency(text) ? { ...e, currency: account.currency as Currency } : e;
}
