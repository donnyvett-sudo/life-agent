# Security

## Reporting
Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab), not in a public issue. Include steps to reproduce. We aim to acknowledge within a week.

## Model, in short
- Every edge function sets `verify_jwt = false` and authenticates itself (API token, Telegram signature, cron secret). Keep that in mind when adding functions.
- Tables have RLS enabled with no policies and no grants to `anon`/`authenticated`: the database is reachable only with the service-role key, which lives only in the edge functions' environment. Per-user isolation is enforced in server code (every query filters by the authenticated `user_id`), not by per-row RLS policies.
- API tokens are random 256-bit values, stored as SHA-256, with scopes (`*`, `app`, `study`, `ingest`, `admin`, `agent`), revocation and a failed-attempt rate limit per salted IP hash (`RATE_SALT`; the IP is `cf-connecting-ip`, else the last `x-forwarded-for` hop). `?token=` in URLs is off unless `ALLOW_QUERY_TOKEN=1`.
- An `admin` or `*` token also controls the Mac agent relay (`agent` job queue): it can queue work that a desktop agent executes. Issue the `agent` scope only to the Mac, give everything else (Shortcuts, health checks) `ingest`, and treat `*` tokens like a password.
- Whoever holds the service-role key or database access (the operator/admin) can read all users' data. Tell your users.

## Operator checklist
- Never put the service-role key, Gemini key, VAPID private key or bot token in the miniapp, in git, or in a workflow file.
- Set `ALLOWED_ORIGINS` to the exact miniapp origin (never `*`), set `RATE_SALT` (random), and `TELEGRAM_WEBHOOK_SECRET` if you use Telegram.
- **Cost control (Gemini).** Every AI call is counted atomically per user per day and per deployment per UTC day (`GEMINI_DAILY_CAP`, default 500). That is a backstop, not billing protection: also use a Gemini key with a capped billing account and set a Google Cloud budget alert. Also set a Supabase spend cap and usage alerts.
- Run `scripts/bootstrap-owner.sql` before deploying the Telegram bot: on an empty database the first `/start` becomes the owner (or set `FIRST_OWNER_TG_ID`).
- Rotate the `bootstrap` token after first use; give the health workflow an `ingest`-scope token only.
- Enable GitHub secret scanning and private vulnerability reporting on your fork.
- Rotate any secret that was ever pasted somewhere public.
