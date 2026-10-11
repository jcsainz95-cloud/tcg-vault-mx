#!/usr/bin/env bash
#
# check-image-sharp.sh — G-SHARP: la imagen del backend carga `sharp` con SU binario nativo · devops
# =============================================================================
# Norma: API_CONTRACT §AC.11 (fotos de accesorios procesadas con `sharp`) y §AC.16 («que la imagen de Railway
# instala `sharp`: devops, con un arranque»). DEVOPS_NOTES §93.
#
# Por qué existe: `sharp` es un addon nativo. La imagen es Alpine (musl); el lockfile trae los binarios de TODAS
# las plataformas como opcionales y npm instala los que casan con `os`/`cpu` del que construye. Si un día el
# lockfile pierde `@img/sharp-linuxmusl-x64` (p. ej. regenerado con `--os`/`--libc` de otra máquina) o la base
# cambia de libc, el build SALE VERDE y el backend muere al arrancar en Railway con
# «Could not load the "sharp" module using the linuxmusl-x64 runtime» — porque `accessory-photo.ts` importa
# `sharp` al cargar el módulo, así que no es «falla la foto», es «no arranca la API».
#
# Qué comprueba, DENTRO de la imagen y SIN red (`--network none`: nada se descarga en tiempo de ejecución):
#   (A) `require('sharp')` funciona como el usuario del runtime.
#   (B) El binario cargado (leído de /proc/self/maps, no de lo que diga el paquete) es el de la plataforma real
#       del contenedor: `sharp-<linux|linuxmusl>-<arch>.node` + su `libvips-cpp`. En la base Alpine ⇒ linuxmusl.
#   (C) La tubería de §AC.11 funciona de verdad: decodifica un JPEG con `limitInputPixels` y `failOn: 'error'`,
#       `metadata()`, `rotate()`, `resize(contain)`, `webp()` ⇒ un WebP de las medidas esperadas.
#   (D) El módulo compilado que usa la app (`dist/modules/accessories/accessory-photo.js`) se carga sin error.
#
# Uso:   ./scripts/check-image-sharp.sh IMAGEN [--expect-libc musl|glibc]   (por defecto musl: la base es Alpine)
# Sale 0 si se cumple; 1 si no (con el motivo); 2 por uso. Necesita Docker y la imagen YA construida.
# Canario: scripts/check-image-sharp-canary.sh (rompe la imagen de tres formas y exige rojo).
# =============================================================================
set -uo pipefail

IMG="${1:-}"
[ -n "$IMG" ] || { echo "uso: $0 IMAGEN [--expect-libc musl|glibc]" >&2; exit 2; }
shift
EXPECT_LIBC="musl"
if [ "${1:-}" = "--expect-libc" ]; then
  case "${2:-}" in musl|glibc) EXPECT_LIBC="$2" ;; *) echo "--expect-libc musl|glibc" >&2; exit 2 ;; esac
fi
docker image inspect "$IMG" >/dev/null 2>&1 || { echo "✗ G-SHARP: la imagen '$IMG' no existe (¿se construyó?)" >&2; exit 1; }

# El script de node viaja por -e: la imagen runtime no tiene npm y no se le añade nada.
# shellcheck disable=SC2016
PROBE='
const fs = require("fs");
const expectLibc = process.argv[1];
const fail = (m) => { console.error("✗ G-SHARP: " + m); process.exit(1); };
let sharp;
try { sharp = require("sharp"); } catch (e) { fail("(A) require(\"sharp\") falla: " + e.message.split("\n")[0]); }
const maps = fs.readFileSync("/proc/self/maps", "utf8").split("\n").map((l) => l.trim().split(/\s+/).pop()).filter(Boolean);
const loaded = [...new Set(maps.filter((p) => /\/@img\/sharp-[^/]+\/lib\//.test(p)))];
const plat = (expectLibc === "musl" ? "linuxmusl" : "linux") + "-" + process.arch;
const addon = loaded.find((p) => new RegExp("/@img/sharp-" + plat + "/lib/sharp-" + plat + "[^/]*\\.node$").test(p));
const vips = loaded.find((p) => new RegExp("/@img/sharp-libvips-" + plat + "/lib/libvips-cpp\\.so").test(p));
if (!addon || !vips) fail("(B) el binario cargado no es el de " + plat + ". Cargados: " + JSON.stringify(loaded));
const hdr = process.report && process.report.getReport().header;
const isGlibc = Boolean(hdr && hdr.glibcVersionRuntime);
if ((expectLibc === "musl") === isGlibc) fail("(B) la libc del contenedor no es " + expectLibc + " (glibcVersionRuntime=" + (hdr && hdr.glibcVersionRuntime) + ")");
(async () => {
  const jpg = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#123456" } }).jpeg().toBuffer();
  const open = () => sharp(jpg, { limitInputPixels: 40000000, failOn: "error" });
  const meta = await open().metadata();
  if (meta.format !== "jpeg" || meta.width !== 120) fail("(C) metadata() inesperado: " + JSON.stringify({ f: meta.format, w: meta.width }));
  const out = await open().rotate().resize(64, 64, { fit: "contain", background: "#ffffff" }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  if (out.info.format !== "webp" || out.info.width !== 64 || out.info.height !== 64) fail("(C) salida inesperada: " + JSON.stringify(out.info));
  const mod = "/app/dist/modules/accessories/accessory-photo.js";
  if (!fs.existsSync(mod)) fail("(D) no existe " + mod + " en la imagen (¿se movió el módulo? ajustar este candado)");
  try { require(mod); } catch (e) { fail("(D) " + mod + " no carga: " + e.message.split("\n")[0]); }
  console.log("✓ G-SHARP: sharp " + sharp.versions.sharp + " (vips " + sharp.versions.vips + ") · " + plat +
    " · " + addon.split("/@img/")[1] + " · WebP " + out.info.width + "x" + out.info.height + " · accessory-photo.js carga");
})().catch((e) => fail("(C) la tubería de §AC.11 falla: " + e.message.split("\n")[0]));
'

docker run --rm --network none --entrypoint node "$IMG" -e "$PROBE" "$EXPECT_LIBC"
