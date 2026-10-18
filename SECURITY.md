# Security

## Reporting
Please report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab), not in a public issue. Include steps to reproduce. We aim to acknowledge within a week.

## Model, in short
- Every edge function sets `verify_jwt = false` and authenticates itself (API token, Telegram signature, cron secret). Keep that in mind when adding functions.
- Tables have RLS enabled with no policies and no grants to `anon`/`authenticated`: the database is reachable only with the service-role key, which lives only in the edge functions' environment. Per-user isolation is enforced in server code (every query filters by the authenticated `user_id`), not by per-row RLS policies.
- API tokens are random 256-bit values, stored as SHA-256, with scopes (`*`, `app`, `study`, `ingest`, `admin`, `agent`), revocation and a failed-attempt rate limit per salted IP hash.
- Whoever holds the service-role key or database access (the operator/admin) can read all users' data. Tell your users.

## Operator checklist
- Never put the service-role key, Gemini key, VAPID private key or bot token in the miniapp, in git, or in a workflow file.
- Set `ALLOWED_ORIGINS` to your miniapp origin only, and set `TELEGRAM_WEBHOOK_SECRET` (it also salts IP hashes).
- Rotate any secret that was ever pasted somewhere public.
