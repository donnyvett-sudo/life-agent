#!/usr/bin/env bash
# Деплой всех Edge Functions (нужен `npx supabase login`).
set -euo pipefail
: "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF (your Supabase project ref)}"
cd "$(dirname "$0")/.."
npx -y supabase functions deploy --project-ref "$SUPABASE_PROJECT_REF" --use-api "$@"
