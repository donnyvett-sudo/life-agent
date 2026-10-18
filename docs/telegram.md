# Telegram module (optional, legacy)

Life Agent started as a Telegram bot. The `telegram-bot` function, `_shared/telegram.ts` and the `tg_id` columns remain as an optional channel. The system runs without it: the miniapp, the API, pairing codes and invites do not need Telegram, and `users.tg_id` is nullable.

To enable: create a bot with @BotFather, then `SUPABASE_PROJECT_REF=<ref> scripts/setup-telegram.sh` (stores `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, registers the webhook). Set `BOT_USERNAME`. **Run `scripts/bootstrap-owner.sql` before deploying the bot**: the first `/start` on an empty database creates the owner, so anyone who finds the bot first would take it. Optionally set the `FIRST_OWNER_TG_ID` secret (your numeric Telegram id) so only that id can claim an empty database. Everyone else needs an invite link.

To disable: don't deploy the function (or `supabase functions delete telegram-bot`), and set `users.notify_telegram = false`. Inbox and Web Push keep working.

No secrets or ids are stored in this repo; the bot reads everything from function secrets.
