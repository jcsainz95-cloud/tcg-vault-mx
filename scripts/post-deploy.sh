#!/usr/bin/env bash
# =============================================================================
# scripts/post-deploy.sh — Secuencia POST-DEPLOY del release · Propiedad: devops
# TCG Vault MX — Marketplace TCG con Bóveda (Pokémon, México)
# =============================================================================
# QUÉ HACE (y POR QUÉ existe — cierre de D-4 del techlead, regla 10 de CLAUDE.md):
#   `prisma migrate deploy` NO basta para este release. Los cambios de DATOS money-
#   críticos (reshape de tiers P-34 T2=25% + cura del sellado M-39) viven en scripts
#   idempotentes que corren DESPUÉS de aplicar migraciones y ANTES de anunciar el
#   release. Este orquestador los ejecuta EN ORDEN y se DETIENE si el backfill de
#   precios encuentra una tabla editada a mano ("ACCIÓN REQUERIDA") — porque colapsar
#   rareza→tier con valores manuales es AMBIGUO y toca dinero: lo decide un humano.
#
# CÓMO CORRERLO (patrón §11.F: env de Railway inyectado, DB de prod por red):
#   Desde la RAÍZ del repo, con el backend ya desplegado (o para prod):
#       railway run --service backend --environment production bash scripts/post-deploy.sh
#   O directamente con la DB objetivo:
#       DATABASE_URL='postgres://…' bash scripts/post-deploy.sh
#   Requisitos locales: `cd backend && npm ci` (necesita ts-node + @prisma/client;
#   la imagen NO se usa aquí — esto corre en la máquina del operador contra la DB).
#
# IDEMPOTENTE: seguro correrlo varias veces. `migrate deploy` es no-op si ya aplicó;
# los dos backfills detectan su propio trabajo (shape tiered / FK ya ligada) y no
# duplican. Money-safe: NUNCA escribe $0 ni regla vacía; ante duda, PARA y escala.
#
# VARIABLES OPCIONALES:
#   SKIP_MIGRATE=1     — saltar `migrate deploy` (útil: el contenedor ya lo corrió al
#                        arrancar; aquí es sólo doble-check idempotente).
#   ADMIN_BASE_URL     — p. ej. https://api.tudominio.com/api/v1 ; si se define junto
#   ADMIN_JWT            con ADMIN_JWT (super_admin), el paso 4 (unify-rarities) se
#                        dispara solo por HTTP. Si faltan, se imprime la instrucción
#                        manual (es cosmético, NO bloquea).
# =============================================================================
set -euo pipefail

# --- Localizar backend/ (los backfills importan ../src, corren desde backend/) ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$BACKEND_DIR" ] || die "No existe $BACKEND_DIR (¿corres desde la raíz del repo?)."
: "${DATABASE_URL:?DATABASE_URL no está definida. Usa 'railway run … bash scripts/post-deploy.sh' o expórtala.}"

cd "$BACKEND_DIR"

log "Contexto"
echo "  backend:      $BACKEND_DIR"
# Ofusca credenciales del DSN al imprimir (host visible, password no).
echo "  DATABASE_URL: $(printf '%s' "$DATABASE_URL" | sed -E 's#(//[^:]+):[^@]+@#\1:****@#')"

# -----------------------------------------------------------------------------
# PASO 1 — Migraciones (M-39 SealedProduct + M-40 PendingPriceEntry.sealedProductId).
#   Ambas ADITIVAS y reversibles (sin DROP, sin backfill destructivo). El contenedor
#   ya las corre al arrancar; aquí es doble-check idempotente salvo SKIP_MIGRATE=1.
# -----------------------------------------------------------------------------
if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
  log "PASO 1 — prisma migrate deploy  [SALTADO por SKIP_MIGRATE=1]"
else
  log "PASO 1 — prisma migrate deploy  (aplica M-39 + M-40; idempotente)"
  npx prisma migrate deploy
  ok "Migraciones al día."
fi

# -----------------------------------------------------------------------------
# PASO 2 — Backfill M-39: cura del sellado ETB→Tropius (idempotente, money-safe).
#   Deriva SealedProduct de los items sellados ya mapeados y liga sealedProductId.
#   Los sellados SIN MAPEO quedan null + reporte de reconciliación (no bloquea).
# -----------------------------------------------------------------------------
log "PASO 2 — backfill M-39 (sellado ETB→Tropius)  ts-node prisma/backfill-m39-sealed-product.ts"
npx ts-node prisma/backfill-m39-sealed-product.ts
ok "Backfill M-39 completado."

# -----------------------------------------------------------------------------
# PASO 3 — Backfill P-34: RESHAPE de tiers (T2=25%). MONEY-CRÍTICO.
#   Idempotente. Si el reporte imprime «ACCIÓN REQUERIDA» (una tabla de precios fue
#   editada a mano en M2 y DIVERGE del default original), el script NO la toca
#   (money-safe) → aquí PARAMOS y escalamos al humano: el mapeo rareza→tier de esa
#   tabla lo define una persona (es dinero). No se anuncia el release hasta cerrarlo.
# -----------------------------------------------------------------------------
log "PASO 3 — backfill P-34 (reshape de tiers T2=25%)  MONEY-CRÍTICO"
P34_LOG="$(mktemp -t post-deploy-p34.XXXXXX.log)"
set +e
npx ts-node prisma/backfill-p34-tiered-pricing.ts 2>&1 | tee "$P34_LOG"
P34_RC=${PIPESTATUS[0]}
set -e
if [ "$P34_RC" -ne 0 ]; then
  die "El backfill P-34 FALLÓ (exit $P34_RC). Revisa el log arriba. NO anuncies el release."
fi
if grep -q "ACCIÓN REQUERIDA" "$P34_LOG"; then
  printf '\n\033[1;31m════════════════════════════════════════════════════════════════════\033[0m\n'
  die "P-34: «ACCIÓN REQUERIDA» — una tabla de precios DIVERGE del default (editada a mano).
     El reshape rareza→tier NO se aplicó a esa tabla (money-safe: no se tocó dinero).
     PARADA CONTROLADA. Escala al humano/arquitecto para definir el mapeo a mano.
     El release NO se anuncia hasta resolverlo. Log: $P34_LOG"
fi
rm -f "$P34_LOG"
ok "Backfill P-34 aplicado (o ya estaba tiered). Sin divergencias money-críticas."

# -----------------------------------------------------------------------------
# PASO 4 — unify-rarities (pendiente COSMÉTICO de P-34; re-deriva Card.rarityCanonical).
#   Es un endpoint HTTP super_admin (POST /admin/catalog/unify-rarities), no un script
#   de DB. Idempotente (2ª corrida = 0 updates). NO bloquea el deploy.
# -----------------------------------------------------------------------------
log "PASO 4 — unify-rarities (cosmético; NO bloquea)"
if [ -n "${ADMIN_BASE_URL:-}" ] && [ -n "${ADMIN_JWT:-}" ]; then
  HTTP_CODE="$(curl -sS -o /tmp/unify-rarities.out -w '%{http_code}' \
      -X POST "$ADMIN_BASE_URL/admin/catalog/unify-rarities" \
      -H "Authorization: Bearer $ADMIN_JWT" \
      -H "Content-Type: application/json" || echo 000)"
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    ok "unify-rarities disparado (HTTP $HTTP_CODE): $(cat /tmp/unify-rarities.out)"
  else
    printf '\033[1;33m  ⚠ unify-rarities devolvió HTTP %s (cosmético, NO bloquea). Reintenta a mano.\033[0m\n' "$HTTP_CODE"
  fi
else
  cat <<'EOF'
  ↷ Manual (no se definieron ADMIN_BASE_URL/ADMIN_JWT). Con un JWT de super_admin:
      curl -X POST "$ADMIN_BASE_URL/admin/catalog/unify-rarities" \
           -H "Authorization: Bearer <super_admin_JWT>" -H "Content-Type: application/json"
    Idempotente y cosmético; puede correrse después. NO bloquea el anuncio del release.
EOF
fi

# -----------------------------------------------------------------------------
# PASO 5 — Nota de saneo legacy (deuda D-3, NO se automatiza aquí).
# -----------------------------------------------------------------------------
log "PASO 5 — Saneo legacy de sellado (deuda D-3) — SÓLO NOTA, no bloquea"
cat <<'EOF'
  Si en M2 aparecen filas pendientes de sellado duplicadas/huérfanas
  (gradeKey='sealed' SIN sealedProductId) de altas previas al fix, requieren un
  barrido puntual (registrado en TECH_DEBT / BACKEND_NOTES). Es deuda de rol BACKEND,
  no de devops, y NO bloquea el deploy. Revisar en la cola de precio pendiente de M2.
EOF

# -----------------------------------------------------------------------------
# PASO 6 — Sincronizar presentaciones de sellado por set (MANUAL, requiere egress).
#   «Sincronizar» de cada set trae presentaciones de sellado desde tcgcsv.com (egress
#   real; en local daba 403). No se automatiza aquí: se dispara desde el back-office /
#   endpoint por set con super_admin, tras verificar salud.
# -----------------------------------------------------------------------------
log "PASO 6 — Sincronizar sellado por set (MANUAL, requiere egress a tcgcsv.com)"
cat <<'EOF'
  Por cada set con sellado: usar «Sincronizar» en M2 (back-office) o el endpoint
  por-set con super_admin. Requiere egress real a tcgcsv.com (en local/CI: 403).
  Idempotente y money-safe (repuebla presentaciones/precios; no borra PriceReference).
  Ver DEVOPS_NOTES §27.6.
EOF

log "POST-DEPLOY COMPLETADO — pasos automatizables OK."
echo "  Pendientes manuales: unify-rarities (si no se disparó por HTTP) y el sync"
echo "  de sellado por set (paso 6). Recién entonces se anuncia el release."
