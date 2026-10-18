# Contributing

Issues and pull requests are welcome.

## Dev loop
```sh
# Edge functions (Deno 2)
cd supabase/functions
SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test --allow-env --allow-read _shared/
SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno check */index.ts

# Miniapp (React + Vite)
cd miniapp && npm ci && npm run build      # i18n check + tsc + vite build
VITE_API_URL=... npm run dev               # or open /?mock for built-in demo data
```

## Rules
- Tests must not touch the network or a real database; use fakes (see `tokens_test.ts`, `pairing_test.ts`).
- Schema changes go in a new file in `supabase/migrations/` (never edit an applied one). Every table: `user_id`, RLS enabled.
- Routine logic is deterministic code; the LLM only reads/understands text, and every write goes through the same functions the UI uses.
- User-facing strings are Russian keys with English values in `i18n_en.ts` (miniapp and functions); `npm run build` and the i18n test fail on a missing translation. Adding more languages is a good first contribution.
- Never commit secrets, real exports or personal data. Use obviously fake values in tests and fixtures.
