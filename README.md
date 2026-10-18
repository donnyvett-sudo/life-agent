# Life Agent

A self-hosted personal life tracker with an AI front door. One Supabase project holds your sleep, supplements, habits, money, food, study and work data; a small React app (PWA) shows it; a Gemini-powered agent turns free text like *"lunch 35, took my vitamins"* into structured records. Built for one person, friends can join by invite.

> Status: personal project made public. Much of the UI and code comments are in Russian with English translations (`i18n_en.ts`); contributions of more languages are welcome.

## Architecture

```
 miniapp (React PWA, static host) ──HTTPS──▶ Supabase Edge Functions (Deno) ──service role──▶ Postgres (RLS on, no client access)
 iOS Shortcuts / scripts ───────X-Token────▶   api · quick-entry · sleep-webhook · body-webhook · study-sync · health
 pg_cron (every minute) ────────────────────▶   scheduler  (reminders, digests, push)
 optional Telegram bot ──────────────────────▶  telegram-bot (legacy, see docs/telegram.md)
```

- **Postgres + RLS.** Migrations in `supabase/migrations/`. RLS is enabled on every table with no policies and no grants for `anon`/`authenticated`, so the database is unreachable from clients. Only edge functions, holding the service-role key, touch it.
- **Edge functions** (`supabase/functions/`): `api` (everything the app calls; routes in `_shared/app/routes.ts`), `scheduler` (cron tick), webhooks for Shortcuts, `health` (liveness probe). All run with `verify_jwt = false` and authenticate on their own.
- **Auth without passwords.** Personal API tokens (SHA-256 at rest, labelled, revocable, rate-limited on failures) with **scopes**: `*` (full), `app`, `study`, `ingest` (webhooks only), `admin` (owner controls), `agent` (a desktop relay). A new device is added with a one-time **pairing code** (10 min) minted from an already-signed-in device; a friend joins with an owner-issued **invite code** plus an explicit consent step.
- **Smart agent.** A Gemini call (`_shared/understand.ts`, `agent.ts`) turns free text or voice into intents (expense, meal, habit, sleep...). The model only reads; every write goes through the same deterministic functions the UI uses. Deletions and big edits ask for confirmation; the last change can be undone. Per-user daily quota (`quota.ts`).
- **Push notifications.** Everything the system says goes to an in-app inbox (feed) and, if enabled, Web Push (VAPID) and/or Telegram.
- **Multi-user isolation.** Every table has `user_id`; every server query is scoped to the authenticated user. This is app-level isolation on top of "RLS locks out clients", not per-row RLS policies. **The operator (anyone with the service-role key or DB access) can read all data.** Say so to your friends.

## Setup

Prereqs: a [Supabase](https://supabase.com) project, Supabase CLI (`npx supabase`), Deno 2, Node 20+, a Gemini API key (optional but needed for AI features).

1. **Migrations.** `npx supabase link --project-ref <ref>` then `npx supabase db push`. Before the first cron tick, store your project URL in Vault (SQL editor):
   `select vault.create_secret('https://<ref>.supabase.co', 'project_url');`
   (`cron_secret` is created by the init migration.) Enable `pg_cron`, `pg_net` and Vault if your project has not.
2. **Secrets.** See `supabase/functions/.env.example` for the full list: `GEMINI_API_KEY`, `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT`, `MINIAPP_URL`, `ALLOWED_ORIGINS`, `DEFAULT_TZ`, `DEFAULT_CURRENCY`, optional `GITHUB_TOKEN`, optional Telegram ones. Set with `SUPABASE_PROJECT_REF=<ref> scripts/set-secret.sh NAME` (hidden prompt) or `supabase secrets set`.
3. **Deploy functions.** `SUPABASE_PROJECT_REF=<ref> scripts/deploy.sh`.
4. **First user.** Run `scripts/bootstrap-owner.sql` in the SQL editor; it returns the admin's `ingest_token`. That is your first full-scope credential.
5. **Miniapp.** `cp miniapp/.env.example miniapp/.env.local`, set `VITE_API_URL=https://<ref>.supabase.co/functions/v1/api` (and `VITE_BASE` for a sub-path host), then `VITE_API_URL=... scripts/deploy-miniapp.sh` and upload `miniapp/dist` to any static host (GitHub Pages, Netlify, Cloudflare Pages). Put its origin in `ALLOWED_ORIGINS` and URL in `MINIAPP_URL`.
6. **Liveness (optional).** `.github/workflows/health.yml` pings `health` every 6h; add repo secrets `HEALTH_URL` and `HEALTH_TOKEN`.
7. **iPhone Shortcuts (optional).** `docs/shortcut-*.md` (Russian) describe sleep, body and quick-entry shortcuts that post to the webhook functions with an `ingest`-scope token.

## Develop / test
```sh
cd supabase/functions && SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test --allow-env --allow-read _shared/
cd miniapp && npm ci && npm run build        # `/?mock` in dev shows demo data without a backend
```
See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CLAUDE.md](CLAUDE.md).

## Known limitations
- The ledger's base currency is CNY (column `amount_cny`); display currency, time zone and language are per-user settings, only CNY/KZT/USD are supported, and category rules/parsers contain Russian-language phrases.
- The `study-sync` / `agent` relay endpoints integrate with a private desktop workflow ("Study Agent"); they are optional and inert if unused.
- Exact-balance import tools for third-party apps were removed from this release; see `imports/README.md` for the CSV layout.

## License
MIT, see [LICENSE](LICENSE).
