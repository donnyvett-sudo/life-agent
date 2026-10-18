# Development notes

Self-hosted life tracker: Supabase (Postgres + Deno edge functions) + React/Vite miniapp. See README.md for architecture.

## Layout
- `supabase/migrations/` schema, append-only. `supabase/functions/<name>/index.ts` thin HTTP entrypoints; logic in `supabase/functions/_shared/` (routes in `_shared/app/`). Tests sit next to code as `*_test.ts`.
- `miniapp/` React 19 + Vite; `src/api.ts` is the only network layer, `src/mock.ts` demo data (`/?mock` in dev).
- `scripts/` ops helpers; they require `SUPABASE_PROJECT_REF` and never print secrets.

## Conventions
- TypeScript everywhere; times stored in UTC, shown in the user's time zone.
- Multi-user from day one: `user_id` on every table, RLS enabled, all access via the service role from edge functions, every query filtered by the authenticated user.
- Routine = deterministic code. The LLM only interprets text/voice/photos; writes use the shared functions. Send the LLM as little personal data as possible.
- Every edge function authenticates itself (`verify_jwt = false`); new ones must too.
- Strings: Russian key + English value in `i18n_en.ts`; builds/tests fail on a missing translation.
- Secrets only from `Deno.env` / Supabase secrets; client bundle contains no secrets. Never commit `.env*`, exports or real personal data.

## Commands
- Tests: `cd supabase/functions && SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test --allow-env --allow-read _shared/`
- Type-check: `deno check */index.ts` (same env); miniapp: `npm run build`.
