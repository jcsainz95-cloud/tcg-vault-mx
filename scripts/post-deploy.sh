#!/usr/bin/env bash
# =============================================================================
# scripts/post-deploy.sh — Secuencia POST-DEPLOY del release · Propiedad: devops
# TCG Vault MX — Marketplace TCG con Bóveda (Pokémon, México)
# =============================================================================
# QUÉ HACE (y POR QUÉ existe — cierre de D-4 del techlead, regla 10 de CLAUDE.md):
#   `prisma migrate deploy` NO basta para este release. Quedan pasos de DATOS y de
#   CUT-OVER que las migraciones no cubren y que deben correr DESPUÉS de aplicar
#   migraciones y ANTES de anunciar el release. Este orquestador los ejecuta EN ORDEN.
#
# ESTADO v2.0 (P-48, 2026-08-24) — QUÉ CAMBIÓ EN ESTE SCRIPT:
#   · Se RETIRÓ el «PASO 3 — backfill P-34 (reshape de tiers T2=25%)». La etapa E8 de
#     P-48 borró `backend/prisma/backfill-p34-tiered-pricing.ts` (retiro sin residuos de
#     la superficie de tiers), así que la llamada apuntaba a un archivo inexistente y el
#     `set -euo pipefail` tumbaba el post-deploy entero. NO se reemplaza por otro script:
#     ese backfill migraba `sales_price_rules`/`buylist_price_rules`/`pricing_tier_map` al
#     shape tiered, y esas cinco claves ya NO LAS LEE NADIE (§4.36.2/§4.36.9b). Sus filas
#     quedan huérfanas e INERTES en `ConfigSetting` a propósito (rollback barato +
#     diagnóstico); NO se borran aquí ni en ningún otro paso.
#   · Se AÑADIÓ el cut-over de la curva (§4.36.9c): «repriciar el catálogo» NO es un
#     UPDATE masivo — el precio de venta NO está persistido, se resuelve EN LECTURA — es
#     RE-RESOLVER con `POST /admin/inventory/publish-all`. Ver DEVOPS_NOTES §29.
#   · SIN variables de entorno nuevas del sistema: la curva es DATO (setting `pricing_curve`
#     en BD), no configuración de entorno. Y no requiere seed: si la fila no existe, el
#     backend cae al default de §N.2 (`SETTING_DEFAULTS`), que es exactamente lo que el
#     seed escribiría. La fila se materializa sola con el primer `PUT /admin/pricing/curve`.
#
# CÓMO CORRERLO (patrón §11.F: env de Railway inyectado, DB de prod por red):
#   Desde la RAÍZ del repo, con el backend ya desplegado (o para prod):
#       railway run --service backend --environment production bash scripts/post-deploy.sh
#   O directamente con la DB objetivo:
#       DATABASE_URL='postgres://…' bash scripts/post-deploy.sh
#   Requisitos locales: `cd backend && npm ci` (necesita ts-node + @prisma/client;
#   la imagen NO se usa aquí — esto corre en la máquina del operador contra la DB).
#
# IDEMPOTENTE: seguro correrlo varias veces. `migrate deploy` es no-op si ya aplicó; el
# backfill M-39 detecta su propio trabajo (FK ya ligada) y no duplica; `publish-all` es
# idempotente por `batchKey` y su guardia atómica impide doble publicación. Money-safe:
# NUNCA escribe $0; sin dato de mercado la pieza va a la COLA de pendientes, jamás a venta.
#
# VARIABLES OPCIONALES:
#   SKIP_MIGRATE=1     — saltar `migrate deploy` (útil: el contenedor ya lo corrió al
#                        arrancar; aquí es sólo doble-check idempotente).
#   ADMIN_BASE_URL     — p. ej. https://api.tudominio.com/api/v1 ; si se define junto
#   ADMIN_JWT            con ADMIN_JWT (super_admin), los pasos por HTTP (3, 4 y 5) se
#                        pueden disparar desde aquí. Si faltan, se imprime la instrucción
#                        manual equivalente.
#   RUN_PUBLISH_ALL=1  — OPT-IN explícito del cut-over (paso 4). NO se dispara solo aunque
#                        haya credenciales: `publish-all` EXPONE PIEZAS A LA VENTA y esa
#                        decisión se toma a propósito, no de rebote por correr el script.
#   PUBLISH_ALL_BATCH_KEY — clave de idempotencia del paso 4 (default `p48-cutover-v2.0`).
#                        Repetir con la MISMA clave devuelve el resultado guardado
#                        (`idempotentReplay: true`) sin re-publicar. Para forzar una pasada
#                        NUEVA (p. ej. tras curar dato de mercado), pasa otra clave.
# =============================================================================
set -euo pipefail

# --- Localizar backend/ (los backfills importan ../src, corren desde backend/) ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"

log()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$BACKEND_DIR" ] || die "No existe $BACKEND_DIR (¿corres desde la raíz del repo?)."
: "${DATABASE_URL:?DATABASE_URL no está definida. Usa 'railway run … bash scripts/post-deploy.sh' o expórtala.}"

cd "$BACKEND_DIR"

# ¿Hay credenciales de admin para los pasos por HTTP? (3, 4 y 5)
HAS_ADMIN_HTTP=0
if [ -n "${ADMIN_BASE_URL:-}" ] && [ -n "${ADMIN_JWT:-}" ]; then HAS_ADMIN_HTTP=1; fi

log "Contexto"
echo "  backend:      $BACKEND_DIR"
# Ofusca credenciales del DSN al imprimir (host visible, password no).
echo "  DATABASE_URL: $(printf '%s' "$DATABASE_URL" | sed -E 's#(//[^:]+):[^@]+@#\1:****@#')"
echo "  admin HTTP:   $([ "$HAS_ADMIN_HTTP" = 1 ] && echo 'disponible (ADMIN_BASE_URL + ADMIN_JWT)' || echo 'NO configurado → pasos 3/4/5 quedan manuales')"

# -----------------------------------------------------------------------------
# PASO 1 — Migraciones (M-39 SealedProduct + M-40 PendingPriceEntry.sealedProductId
#   + M-41 instrumentación de la curva). Las TRES son ADITIVAS y reversibles (sin DROP,
#   sin backfill destructivo, sin migración de dinero). El contenedor ya las corre al
#   arrancar (CMD del Dockerfile.backend); aquí es doble-check idempotente salvo
#   SKIP_MIGRATE=1. M-41 es la ÚNICA migración pendiente de este stream respecto a `main`.
# -----------------------------------------------------------------------------
if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
  log "PASO 1 — prisma migrate deploy  [SALTADO por SKIP_MIGRATE=1]"
else
  log "PASO 1 — prisma migrate deploy  (aplica M-39 + M-40 + M-41; idempotente)"
  npx prisma migrate deploy
  ok "Migraciones al día."
fi

# -----------------------------------------------------------------------------
# PASO 2 — Backfill M-39: cura del sellado ETB→Tropius (idempotente, money-safe).
#   Deriva SealedProduct de los items sellados ya mapeados y liga sealedProductId.
#   Los sellados SIN MAPEO quedan null + reporte de reconciliación (no bloquea).
#   M-41 NO tiene backfill: es aditiva pura (columnas nullable = filas históricas `null`).
# -----------------------------------------------------------------------------
log "PASO 2 — backfill M-39 (sellado ETB→Tropius)  ts-node prisma/backfill-m39-sealed-product.ts"
npx ts-node prisma/backfill-m39-sealed-product.ts
ok "Backfill M-39 completado."

# -----------------------------------------------------------------------------
# PASO 3 — unify-rarities (COSMÉTICO; re-deriva Card.rarityCanonical).
#   Es un endpoint HTTP super_admin (POST /admin/catalog/unify-rarities), no un script
#   de DB. Idempotente (2ª corrida = 0 updates). NO bloquea el deploy.
#   v2.0: sigue siendo cosmético. El guardarraíl «premium en el piso» NO depende de este
#   backfill — `isPremiumCanonicalRarity()` acepta la rareza CRUDA o la canónica, y los
#   call-sites le pasan `card.rarity`. Esto solo endereza el agrupado de `/admin/pricing/rarities`.
# -----------------------------------------------------------------------------
log "PASO 3 — unify-rarities (cosmético; NO bloquea)"
if [ "$HAS_ADMIN_HTTP" = 1 ]; then
  HTTP_CODE="$(curl -sS -o /tmp/unify-rarities.out -w '%{http_code}' \
      -X POST "$ADMIN_BASE_URL/admin/catalog/unify-rarities" \
      -H "Authorization: Bearer $ADMIN_JWT" \
      -H "Content-Type: application/json" || echo 000)"
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    ok "unify-rarities disparado (HTTP $HTTP_CODE): $(cat /tmp/unify-rarities.out)"
  else
    warn "unify-rarities devolvió HTTP $HTTP_CODE (cosmético, NO bloquea). Reintenta a mano."
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
# PASO 4 — CUT-OVER v2.0 (P-48, §4.36.9c): RE-RESOLVER el catálogo con la curva.
#   NO hay migración de dinero y NO hay UPDATE masivo: el precio de venta no está
#   persistido (§4.26b, se resuelve en lectura), así que lo YA publicado adopta la curva
#   solo con el deploy. Lo que este paso cubre son las piezas `platform` en `in_stock`
#   que aún NO están publicadas: las re-evalúa con la curva, publica lo que ahora resuelve
#   y ESCALA a la cola lo que cae en `pending` / `premium_at_floor`.
#   OPT-IN (RUN_PUBLISH_ALL=1): expone piezas a la venta ⇒ decisión deliberada.
#   Idempotente por `batchKey`; tolerante por-ítem (ningún fallo individual tumba el lote).
#   Se CONSERVAN intactos los overrides manuales (§N.6 los declara absolutos): revisarlos
#   es tarea del DUEÑO, no de este script (§4.36.9c-5, DEVOPS_NOTES §29.5).
# -----------------------------------------------------------------------------
PUBLISH_ALL_BATCH_KEY="${PUBLISH_ALL_BATCH_KEY:-p48-cutover-v2.0}"
log "PASO 4 — CUT-OVER P-48: re-resolver el catálogo con la curva (publish-all)"
if [ "${RUN_PUBLISH_ALL:-0}" != "1" ]; then
  cat <<EOF
  ↷ NO se disparó (falta el opt-in explícito RUN_PUBLISH_ALL=1). Es deliberado: publicar
    EXPONE PIEZAS A LA VENTA. Para correrlo desde aquí:
        RUN_PUBLISH_ALL=1 ADMIN_BASE_URL=… ADMIN_JWT=… bash scripts/post-deploy.sh
    O a mano, con un JWT de super_admin:
        curl -X POST "\$ADMIN_BASE_URL/admin/inventory/publish-all" \\
             -H "Authorization: Bearer <super_admin_JWT>" -H "Content-Type: application/json" \\
             -d '{"batchKey":"$PUBLISH_ALL_BATCH_KEY"}'
    Filtros opcionales del body: {"setId":"…"} y {"productType":"raw|graded|sealed"} —
    útiles para hacer el cut-over por partes (p. ej. un set primero). Ver DEVOPS_NOTES §29.
EOF
elif [ "$HAS_ADMIN_HTTP" != 1 ]; then
  die "RUN_PUBLISH_ALL=1 pero faltan ADMIN_BASE_URL/ADMIN_JWT (super_admin). El cut-over NO corrió."
else
  echo "  batchKey: $PUBLISH_ALL_BATCH_KEY  (misma clave ⇒ replay idempotente, NO re-publica)"
  PUB_OUT="$(mktemp -t post-deploy-publish-all.XXXXXX.json)"
  HTTP_CODE="$(curl -sS -o "$PUB_OUT" -w '%{http_code}' \
      -X POST "$ADMIN_BASE_URL/admin/inventory/publish-all" \
      -H "Authorization: Bearer $ADMIN_JWT" \
      -H "Content-Type: application/json" \
      -d "{\"batchKey\":\"$PUBLISH_ALL_BATCH_KEY\"}" || echo 000)"
  if [ "$HTTP_CODE" != "200" ]; then
    die "publish-all devolvió HTTP $HTTP_CODE — el catálogo NO se re-resolvió. NO anuncies el release.
     Respuesta: $(head -c 800 "$PUB_OUT")
     Cuerpo completo en: $PUB_OUT"
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -r '"  selected=\(.summary.selected) published=\(.summary.published) alreadyListed=\(.summary.alreadyListed) pendingPrice=\(.summary.pendingPrice) failed=\(.summary.failed) replay=\(.idempotentReplay)"' "$PUB_OUT" \
      || head -c 800 "$PUB_OUT"
    if [ "$(jq -r '.idempotentReplay' "$PUB_OUT")" = "true" ]; then
      warn "REPLAY idempotente: devolvió el resultado guardado de una corrida previa con esta batchKey."
      warn "Si querías una pasada NUEVA, re-corre con otra PUBLISH_ALL_BATCH_KEY."
    fi
  else
    head -c 800 "$PUB_OUT"; echo
  fi
  rm -f "$PUB_OUT"
  ok "Cut-over disparado. Revisa la cola de pendientes en el PASO 5 antes de anunciar."
fi

# -----------------------------------------------------------------------------
# PASO 5 — DIAGNÓSTICO de la cola de precio pendiente (§4.36.9c-3). NO bloquea, pero es
#   la señal que decide si el release se anuncia: `premium_at_floor` debe ser del orden de
#   ≈3 por cada 333 cartas. Un volumen MUCHO mayor NO es un guardarraíl ruidoso: es PISO
#   MAL CALIBRADO o DATO DE MERCADO ROTO — y eso se escala al dueño/arquitecto, no se
#   silencia. Los `counts` ignoran `?reason=` y respetan `?context=` (contrato §M2).
# -----------------------------------------------------------------------------
log "PASO 5 — cola de pendientes por razón (diagnóstico del cut-over; NO bloquea)"
if [ "$HAS_ADMIN_HTTP" = 1 ]; then
  PEND_OUT="$(mktemp -t post-deploy-pending.XXXXXX.json)"
  HTTP_CODE="$(curl -sS -o "$PEND_OUT" -w '%{http_code}' \
      -X GET "$ADMIN_BASE_URL/admin/pricing/pending" \
      -H "Authorization: Bearer $ADMIN_JWT" || echo 000)"
  if [ "$HTTP_CODE" = "200" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -r '"  counts → no_market=\(.counts.no_market) premium_at_floor=\(.counts.premium_at_floor) unknown=\(.counts.unknown)"' "$PEND_OUT" \
        || head -c 600 "$PEND_OUT"
    else
      head -c 600 "$PEND_OUT"; echo
    fi
    echo "  Referencia (§4.36.9c-3): premium_at_floor ≈ 3 por cada 333 cartas. Muy por encima ⇒"
    echo "  piso mal calibrado o mercado roto ⇒ escalar al dueño/arquitecto ANTES de anunciar."
  else
    warn "No pude leer la cola (HTTP $HTTP_CODE). Revísala a mano en M2 antes de anunciar."
  fi
  rm -f "$PEND_OUT"
else
  cat <<'EOF'
  ↷ Manual (sin ADMIN_BASE_URL/ADMIN_JWT):
      curl "$ADMIN_BASE_URL/admin/pricing/pending?reason=premium_at_floor" \
           -H "Authorization: Bearer <super_admin_JWT>"
    Mira `counts.premium_at_floor` (≈3 por cada 333 cartas). Muy por encima ⇒ piso mal
    calibrado o dato de mercado roto ⇒ escalar. Ver DEVOPS_NOTES §29.4.
EOF
fi

# -----------------------------------------------------------------------------
# PASO 6 — Nota de saneo legacy (deuda D-3, NO se automatiza aquí).
# -----------------------------------------------------------------------------
log "PASO 6 — Saneo legacy de sellado (deuda D-3) — SÓLO NOTA, no bloquea"
cat <<'EOF'
  Si en M2 aparecen filas pendientes de sellado duplicadas/huérfanas
  (gradeKey='sealed' SIN sealedProductId) de altas previas al fix, requieren un
  barrido puntual (registrado en TECH_DEBT / BACKEND_NOTES). Es deuda de rol BACKEND,
  no de devops, y NO bloquea el deploy. Revisar en la cola de precio pendiente de M2.
EOF

# -----------------------------------------------------------------------------
# PASO 7 — Sincronizar presentaciones de sellado por set (MANUAL, requiere egress).
#   «Sincronizar» de cada set trae presentaciones de sellado desde tcgcsv.com (egress
#   real; en local daba 403). No se automatiza aquí: se dispara desde el back-office /
#   endpoint por set con super_admin, tras verificar salud.
#   v2.0: el SELLADO NO entra a la curva (§4.36.10) — conserva su spread por presentación.
# -----------------------------------------------------------------------------
log "PASO 7 — Sincronizar sellado por set (MANUAL, requiere egress a tcgcsv.com)"
cat <<'EOF'
  Por cada set con sellado: usar «Sincronizar» en M2 (back-office) o el endpoint
  por-set con super_admin. Requiere egress real a tcgcsv.com (en local/CI: 403).
  Idempotente y money-safe (repuebla presentaciones/precios; no borra PriceReference).
  Ver DEVOPS_NOTES §27.6.
EOF

log "POST-DEPLOY COMPLETADO — pasos automatizables OK."
echo "  Pendientes manuales: unify-rarities (si no se disparó por HTTP), el cut-over"
echo "  publish-all (si no se pasó RUN_PUBLISH_ALL=1), la REVISIÓN DE OVERRIDES heredados"
echo "  por el dueño (§29.5) y el sync de sellado por set (paso 7)."
echo "  Recién entonces se anuncia el release."
