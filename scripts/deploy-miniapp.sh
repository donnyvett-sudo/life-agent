#!/usr/bin/env bash
# Builds the miniapp into miniapp/dist. Host the folder on any static host (GitHub Pages, Netlify, Cloudflare Pages...).
# Required: VITE_API_URL (https://<ref>.supabase.co/functions/v1/api). Optional: VITE_BASE (path prefix, default "/"),
# VITE_BOT_USERNAME (only for the legacy Telegram module). No secrets belong in the build.
set -euo pipefail
cd "$(dirname "$0")/../miniapp"
: "${VITE_API_URL:?set VITE_API_URL}"
npm ci --no-fund --no-audit
npm run build
touch dist/.nojekyll
cp dist/index.html dist/404.html   # SPA fallback for GitHub Pages
echo "Built miniapp/dist. Publish it to your static host."
