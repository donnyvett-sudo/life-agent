/** Strips Telegram bot tokens (…/bot<id>:<secret>/…) from text before it is logged. */
export const redact = (s: string): string => s.replace(/bot[0-9]+:[\w-]+/g, "bot<redacted>");
