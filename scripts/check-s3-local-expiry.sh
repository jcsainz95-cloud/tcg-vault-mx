#!/usr/bin/env bash
#
# check-s3-local-expiry.sh — «¿caduca de verdad el enlace presignado del INE?»
#                                                        · devops · G-4 / D-S3-3
# =============================================================================
# DE DÓNDE VIENE (ARCHITECTURE §4.51.5 G-4, desviación D-S3-3, 2026-09-11)
# ---------------------------------------------------------------------------
# `KYC_INE_VIEW_URL_TTL_SECONDS` (default 120 s, clamp ≤300) es un DIAL DE
# EXPOSICIÓN DE PII. Este candado afirma la propiedad que el dial promete:
# **una URL de vista del INE vencida NO se sirve.**
#
# ⚠️⚠️ CORRECCIÓN MEDIDA AL MOTIVO ORIGINAL. `ARCHITECTURE §4.51.5` (G-4) y la
# desviación `D-S3-3` dicen que «una URL presignada vencida se aceptaría».
# **Es FALSO.** Medido con `S3_LOCAL_ALLOW_ANON=1`, que desactiva TODA la capa
# propia: la URL vencida ya recibía `403 AccessDenied / "Request has expired"`
# con `<X-Amz-Expires>`, `<Expires>` y `<ServerTime>` ⇒ **s3rver ya comprueba la
# caducidad**. En la misma corrida, una firma con el secreto equivocado SÍ
# pasaba ⇒ lo que s3rver no hace es la FIRMA, no la caducidad.
# ⇒ El enlace del INE **nunca** fue eterno. G-4 no cerró un agujero abierto.
#
# Entonces, ¿qué mide este candado? DOS cosas distintas, y las separa:
#   (1) LA PROPIEDAD: vencida ⇒ 403. La sostienen DOS capas (la nuestra y
#       s3rver), así que quitar una no la tumba — y por eso una mutación no
#       puede ponerla roja. Decirlo es parte de la medición.
#   (2) QUÉ CAPA RESPONDE: el mensaje de la capa propia es distinguible
#       («venció hace Ns … G-4»); el de s3rver es escueto. La mutación demuestra
#       que hoy responde la NUESTRA y que, al quitarla, el efecto lo sostiene
#       s3rver. Eso es lo que un futuro «esto sobra, lo quito» necesita saber.
#
# CÓMO FIRMA (y por qué no depende del SDK de AWS)
# ---------------------------------------------------------------------------
# Construye la URL presignada con `crypto`, siguiendo SigV4. Para que un fallo
# del propio firmador no se confunda con «caduca», cada corrida comprueba LAS DOS
# caras con el MISMO firmador:
#   · URL FRESCA  ⇒ 200  (prueba que el firmador es correcto)
#   · URL VENCIDA ⇒ 403 `AccessDenied` + «Request has expired»
# Lo único que cambia entre las dos es la marca de tiempo.
#
# Uso:  ./scripts/check-s3-local-expiry.sh [N]     (N = tiradas, def. 3)
# Sale 0 si las N tiradas dan las dos caras y la mutación sale roja N/N.
# =============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1:-3}"
FALLOS=0; PASADAS=0
ok()  { PASADAS=$((PASADAS+1)); printf '\033[1;32m  ✔ %s\033[0m\n' "$*"; }
mal() { FALLOS=$((FALLOS+1));  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "::error::sin node no puedo medir. NO concluyente."; exit 2; }
[ -d "$ROOT_DIR/scripts/s3-local/node_modules" ] || {
  echo "::error::falta scripts/s3-local/node_modules (npm ci en scripts/s3-local). NO concluyente."; exit 2; }

TMP="$(mktemp -d -t s3-expiry-XXXXXX)"; trap 'rm -rf "$TMP"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null' EXIT

# --- El cliente: firma SigV4 presignada a mano y devuelve el código HTTP -----
cat >"$TMP/cliente.cjs" <<'JS'
const crypto = require('crypto'), http = require('http');
const [,, puerto, clave, secreto, bucket, desfaseSeg, expiresSeg] = process.argv;
const HOST = '127.0.0.1', KEY = 'kyc_ine/expiry-probe.txt';
const esc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d, 'utf8').digest();
// `desfaseSeg` retrasa la firma hacia el pasado: así se fabrica una URL VENCIDA
// sin esperar. (Sin él habría que dormir, y el candado tardaría N×TTL.)
const t = new Date(Date.now() - Number(desfaseSeg) * 1000);
const amzDate = t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fecha = amzDate.slice(0, 8), region = 'us-east-1', servicio = 's3';
const scope = `${fecha}/${region}/${servicio}/aws4_request`;
const rawPath = `/${bucket}/${KEY}`;
const q = new Map([
  ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
  ['X-Amz-Credential', `${clave}/${scope}`],
  ['X-Amz-Date', amzDate],
  ['X-Amz-Expires', String(expiresSeg)],
  ['X-Amz-SignedHeaders', 'host'],
]);
const canonicalQuery = [...q.entries()].map(([k, v]) => [esc(k), esc(v)])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
const canonicalHeaders = `host:${HOST}:${puerto}\n`;
const canonicalRequest = ['GET', rawPath, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonicalRequest)].join('\n');
const kSigning = hmac(hmac(hmac(hmac(`AWS4${secreto}`, fecha), region), servicio), 'aws4_request');
const firma = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
const url = `${rawPath}?${canonicalQuery}&X-Amz-Signature=${firma}`;
http.get({ host: HOST, port: Number(puerto), path: url, headers: { host: `${HOST}:${puerto}` } }, (r) => {
  let b = ''; r.on('data', (d) => (b += d));
  r.on('end', () => {
    const code = (b.match(/<Code>([^<]+)<\/Code>/) || [])[1] || '';
    // `PROPIA` = respondió la capa de este repo (su mensaje es inconfundible);
    // `S3RVER` = respondió la comprobación interna de s3rver.
    const capa = /venci\u00f3 hace/.test(b) ? 'PROPIA' : (/Request has expired/.test(b) ? 'S3RVER' : '-');
    console.log(`${r.statusCode}|${code}|${capa}`);
  });
}).on('error', (e) => { console.log(`ERR|${e.message}|-`); });
JS

CLAVE="probe_$RANDOM"; SECRETO="secreto_local_$RANDOM$RANDOM"
PUERTO=""

# `$1` = ruta del server.js a ejercitar (el real, o una copia mutada).
# ⚠️ PUERTO NUEVO EN CADA ARRANQUE. Con un puerto fijo, si el servidor anterior
# tarda en soltarlo, la sonda de vida CONECTA CON EL VIEJO y la medición se hace
# contra el binario equivocado — que fue exactamente lo que me pasó al escribir
# esto: la mutación salía 0/N porque respondía el servidor SIN mutar.
arrancar() {
  PUERTO=$(( 9200 + RANDOM % 600 ))
  rm -rf "$TMP/data"; mkdir -p "$TMP/data"
  node -e 'require("net").connect('"$PUERTO"',"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' 2>/dev/null \
    && { echo "::error::el puerto $PUERTO ya estaba ocupado; no mido contra un servidor ajeno."; return 1; }
  S3_LOCAL_HOST=127.0.0.1 S3_LOCAL_PORT="$PUERTO" S3_LOCAL_DIR="$TMP/data" \
  S3_BUCKET=tcg-photos S3_ACCESS_KEY_ID="$CLAVE" S3_SECRET_ACCESS_KEY="$SECRETO" \
    node "$1" >"$TMP/srv.log" 2>&1 &
  SRV=$!
  for _ in $(seq 1 40); do
    node -e 'require("net").connect('"$PUERTO"',"127.0.0.1").on("connect",()=>process.exit(0)).on("error",()=>process.exit(1))' 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}
parar() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""; }
pedir() { node "$TMP/cliente.cjs" "$PUERTO" "$CLAVE" "$SECRETO" tcg-photos "$1" "$2"; }

echo "── G-4 · ¿caduca de verdad la URL presignada del INE? ──"

# =============================== EL SERVIDOR REAL ===========================
arrancar "$ROOT_DIR/scripts/s3-local/server.js" || { echo "::error::el servidor real no arrancó. NO concluyente."; exit 2; }
FRESCAS=0; VENCIDAS=0
for _ in $(seq 1 "$N"); do
  # Fresca: firmada ahora, TTL 120 s (el default del INE).
  # ACEPTADA = el verificador la dejó pasar = CUALQUIER cosa menos 403. Aquí es
  # `404 NoSuchKey`: la petición llegó a s3rver y el objeto no existe (no se sube
  # nada a propósito — lo que se mide es el VEREDICTO DE LA FIRMA, no el objeto).
  # Medido: con la firma mal, este mismo camino da 403 SignatureDoesNotMatch.
  [ "$(pedir 0 120 | cut -d'|' -f1)" != "403" ] && FRESCAS=$((FRESCAS+1))
  # vencida: firmada hace 300 s con TTL 120 s ⇒ venció hace 180 s
  r="$(pedir 300 120)"
  [ "$(cut -d'|' -f1 <<<"$r")" = "403" ] && [ "$(cut -d'|' -f2 <<<"$r")" = "AccessDenied" ] \
    && [ "$(cut -d'|' -f3 <<<"$r")" = "PROPIA" ] && VENCIDAS=$((VENCIDAS+1))
done
parar
[ "$FRESCAS" -eq "$N" ] && ok "URL FRESCA (TTL 120 s) ⇒ ACEPTADA (404 NoSuchKey, no 403) · $FRESCAS/$N — el firmador del candado es correcto" \
  || mal "URL fresca RECHAZADA en $((N-FRESCAS)) de $N: el firmador falla y la otra cara no concluye"
[ "$VENCIDAS" -eq "$N" ] && ok "URL VENCIDA ⇒ 403 AccessDenied, y responde LA CAPA PROPIA · $VENCIDAS/$N" \
  || mal "URL vencida: no salió 403 desde la capa propia en $((N-VENCIDAS)) de $N"

# ================= MUTACIÓN: quitar la comprobación de caducidad ============
# ⚠️ Lo que esta mutación demuestra NO es «sin esto, la URL vencida pasa» —eso
# sería falso: s3rver la sigue rechazando—. Demuestra CUÁL de las dos capas
# responde hoy, que es justo lo que hay que saber antes de tocar cualquiera.
# Esperado al mutar: sigue habiendo 403, pero ya NO lo firma la capa propia.
mkdir -p "$TMP/mut"
cp -r "$ROOT_DIR/scripts/s3-local/." "$TMP/mut/"
python3 - "$TMP/mut/server.js" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
ini = s.index('  const venceEnMs = firmadaEnMs + expiresSeg * 1000;')
fin = s.index('  const signedHeaders =')
bloque = s[ini:fin]
assert 'Request has expired' in bloque, 'no encontré el bloque de caducidad'
open(p, 'w').write(s[:ini] + s[fin:])
PY
arrancar "$TMP/mut/server.js" || { echo "::error::el servidor mutado no arrancó. NO concluyente."; exit 2; }
ROJO=0
for _ in $(seq 1 "$N"); do
  # La MISMA petición vencida: sin nuestra comprobación, el 403 lo pone s3rver.
  rm_="$(pedir 300 120)"
  [ "$(cut -d'|' -f1 <<<"$rm_")" = "403" ] && [ "$(cut -d'|' -f3 <<<"$rm_")" = "S3RVER" ] && ROJO=$((ROJO+1))
done
parar
[ "$ROJO" -eq "$N" ] && ok "m-g4 · sin la capa propia, el 403 lo pone S3RVER · $ROJO/$N ⇒ la propiedad tiene DOS capas y el candado sabe cuál responde" \
  || mal "m-g4 · al mutar no respondió s3rver como se esperaba ($ROJO/$N): revisar, la lectura de capas no es fiable"

echo
if [ "$FALLOS" -eq 0 ]; then
  printf '\033[1;32m✓ G-4: %s/%s — la URL vencida del INE no se sirve (dos capas), y se sabe cuál responde.\033[0m\n' "$PASADAS" "$PASADAS"
  exit 0
fi
printf '\033[1;31m✗ G-4: %s fallo(s) de %s.\033[0m\n' "$FALLOS" "$((PASADAS+FALLOS))"
exit 1
