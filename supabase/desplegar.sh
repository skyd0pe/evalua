#!/usr/bin/env bash
# Publica la función `api` en Supabase. Uso: SUPABASE_ACCESS_TOKEN=... ./supabase/desplegar.sh
# (el token es el de la cuenta, de supabase.com/dashboard/account/tokens; no se guarda en el repositorio)
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-ncdeygqoschrejwcbjwl}"
cd "$(dirname "$0")"
tmp=.build; mkdir -p "$tmp"   # carpeta de trabajo (ignorada por git)
{ cat ../core.js; printf '\nexport { api, TABLAS };\n'; } > "$tmp/core.mjs"
curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=api" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -F 'metadata={"entrypoint_path":"index.ts","name":"api","verify_jwt":false}' \
  -F "file=@functions/api/index.ts;filename=index.ts" \
  -F "file=@$tmp/core.mjs;filename=core.mjs"
echo
