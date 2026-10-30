#!/usr/bin/env python3
"""seed-image-host.py — el host de imágenes del seed, con bytes de peso REAL (DYN-D1, DYN-D3) · devops

El seed sintético (`backend/prisma/seed-e2e.ts`) apunta el arte a `https://img.e2e.local/…`, un host que no
resuelve; el proxy del API de `run.sh` lo reescribe a `https://images.scrydex.com/e2e/…` para que la URL esté
en `remotePatterns` y el optimizador de Next (`/_next/image`) acepte la foto líder (§DYN.6.6).

Este servidor sirve esas rutas de dos formas, sin salir nunca a internet:
  · HTTPS en <puerto>        para el Chrome de Lighthouse (`--host-resolver-rules` MAP de los hosts de
                             imagen a 127.0.0.1:<puerto>, `--ignore-certificate-errors`);
  · HTTP  en <puerto-http>   para el `next start` del arnés: el optimizador pide la foto al origen desde el
                             servidor, y `next-image-origin.cjs` le desvía esa petición aquí.

LA FOTO LÍDER PESA COMO LA REAL (DYN-D3, D-DYN-9). Medido por frontend el 2026-10-29 sobre 40 cartas de
producción: `large` de scrydex = PNG 733×1024 de 471 KB-1.23 MB, mediana ~880 KB, y su WebP 640 q75 ~67 KB.
Hasta v1.114.2 este host servía un ruido de 200×280 y 168 KB, y el verde de escritorio en CI se apoyaba en él.
`LIDER` es un PNG 733×1024 GENERADO de forma determinista (bandas suaves + bloques de 10 px + ruido fino, filtro
Sub): ~929 KB en el origen y ~63 KB en WebP 640 q75 (medido con el sharp del frontend). La huella fijada es la
de los píxeles filtrados (`HUELLA_LIDER`), no la del PNG: la salida de zlib cambia entre implementaciones y los
píxeles no. Al arrancar comprueba huella y peso (≥ PESO_MIN_LIDER); si no cuadran, NO sirve (rc 3).
Candado: scripts/check-home-perf.sh (huella, peso, y que `run.sh` exige el peso en el origen).

Uso: python3 -I seed-image-host.py <puerto https> <cert.pem> <key.pem> <puerto http>
     python3 -I seed-image-host.py --huella        # imprime «<bytes del PNG líder> <huella>» y sale
"""
import hashlib
import http.server
import math
import random
import ssl
import struct
import sys
import threading
import zlib

ANCHO, ALTO = 733, 1024
PESO_MIN_LIDER = 800 * 1024
HUELLA_LIDER = 'bec432ea5397736f16d21287c48ea0e2aa76c4be02825eb3e1dde31eb8cdcb7a'


def _chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def _png(width, height, filtered):
    return (b'\x89PNG\r\n\x1a\n' + _chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + _chunk(b'IDAT', zlib.compress(filtered, 9)) + _chunk(b'IEND', b''))


def lider_filtrado():
    """Píxeles de la foto líder, ya con el byte de filtro Sub por fila (lo que va dentro de IDAT)."""
    rnd = random.Random(1)
    bloque, amp_bloque, amp_fino = 10, 84, 2
    nb = (ANCHO + bloque - 1) // bloque
    filas = [[int(110 + 90 * math.sin(y / 37.0 + c)) for c in range(3)] for y in range(ALTO)]
    cols = [[int(60 * math.sin(x / 29.0 + 1.3 * c)) for c in range(3)] for x in range(ANCHO)]
    out = bytearray()
    bloques = b''
    for y in range(ALTO):
        if y % bloque == 0:
            bloques = rnd.randbytes(nb * 3)
        ruido = rnd.randbytes(ANCHO * 3)
        f = filas[y]
        linea = bytearray(ANCHO * 3)
        for x in range(ANCHO):
            cx, i, b = cols[x], 3 * x, 3 * (x // bloque)
            for c in range(3):
                v = f[c] + cx[c] + (bloques[b + c] % amp_bloque) - amp_bloque // 2 + (ruido[i + c] % amp_fino) - amp_fino // 2
                linea[i + c] = 0 if v < 0 else (255 if v > 255 else v)
        out.append(1)  # filtro Sub
        out += bytes(((linea[i] - (linea[i - 3] if i >= 3 else 0)) & 0xFF) for i in range(len(linea)))
    return bytes(out)


def chica():
    """La miniatura de las otras tejas (~60 KB de ruido 120×168, sin cambio desde 2026-10-29)."""
    rnd = random.Random(2)
    raw = bytearray()
    for _ in range(168):
        raw.append(0)
        raw.extend(rnd.getrandbits(8) for _ in range(120 * 3))
    return _png(120, 168, bytes(raw))


FILTRADO = lider_filtrado()
LIDER = _png(ANCHO, ALTO, FILTRADO)
HUELLA = hashlib.sha256(FILTRADO).hexdigest()

if len(sys.argv) > 1 and sys.argv[1] == '--huella':
    print(len(LIDER), HUELLA)
    sys.exit(0)
if HUELLA != HUELLA_LIDER or len(LIDER) < PESO_MIN_LIDER:
    sys.stderr.write(f'seed-image-host: foto líder distinta de la fijada (huella {HUELLA}, {len(LIDER)} B; '
                     f'se espera {HUELLA_LIDER} y ≥ {PESO_MIN_LIDER} B). No sirvo una sustituta.\n')
    sys.exit(3)
CHICA = chica()


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):  # noqa: N802
        body = LIDER if 'hires' in self.path else CHICA
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *a):
        sys.stdout.write('%s %s\n' % (self.command, self.path))
        sys.stdout.flush()


tls = http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(sys.argv[2], sys.argv[3])
tls.socket = ctx.wrap_socket(tls.socket, server_side=True)
plano = http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[4])), H)
threading.Thread(target=plano.serve_forever, daemon=True).start()
sys.stdout.write(f'líder {len(LIDER)} B huella {HUELLA[:12]} · https :{sys.argv[1]} · http :{sys.argv[4]}\n')
sys.stdout.flush()
tls.serve_forever()
