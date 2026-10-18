// Единая точка конфигурации. Модель Gemini меняется здесь или через env GEMINI_MODEL.
// Модели пробуются по порядку: если одна перегружена/недоступна — следующая.
// GEMINI_MODEL в env ставит свою модель первой.
export const GEMINI_MODELS = [
  ...(Deno.env.get("GEMINI_MODEL") ? [Deno.env.get("GEMINI_MODEL")!] : []),
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];
// Default time zone for new users (IANA name). Override with the DEFAULT_TZ secret.
export const DEFAULT_TZ = Deno.env.get("DEFAULT_TZ") ?? "UTC";

// Повтор напоминаний о добавках, если нет ответа (минуты).
export const REPEAT_AFTER_MIN = { supp_lunch: 40, supp_evening: 20 } as const;
export const SNOOZE_MIN = 15;
export const LOW_STOCK_DAYS = 5;
// Насколько можно опоздать с плановым сообщением (если cron лежал) — дальше пропускаем.
export const MAX_LATE_MIN = 60;

// Public URL of the hosted miniapp and (optional, legacy Telegram module) the bot username. Set both as secrets.
export const MINIAPP_URL = Deno.env.get("MINIAPP_URL") ?? "";
export const BOT_USERNAME = Deno.env.get("BOT_USERNAME") ?? "";
// Сколько живёт ссылка-приглашение.
export const INVITE_DAYS = 7;
