#!/usr/bin/env python3
"""seed-image-host.py — el host de imágenes del seed, de verdad, para medir el LCP (DYN-D1) · devops

El seed sintético (`backend/prisma/seed-e2e.ts`) apunta el arte de las cartas a `https://img.e2e.local/…`,
un host que no resuelve. Con las imágenes rotas, Lighthouse no tiene imagen que contar como LCP y el LCP
cae al texto del hero: el umbral de LCP de 936 saldría verde SIN MEDIR la imagen de la teja líder, que es
el elemento LCP en producción (medido por frontend: `images.scrydex.com/…/large`, 122 KB).

Este servidor sirve, por HTTPS en 127.0.0.1, un PNG determinista de peso parecido (ruido, ~120-170 KB, no
comprime) a cualquier ruta. Chrome llega aquí con `--host-resolver-rules="MAP img.e2e.local 127.0.0.1:<p>"`
y `--ignore-certificate-errors` (SOLO en el Chrome de Lighthouse de `run.sh`). El certificado es efímero y
autofirmado, generado por `run.sh` con openssl en su directorio de salida. Cabeceras como un CDN
(`cache-control: public, max-age=31536000`).

Uso: python3 -I seed-image-host.py <puerto> <cert.pem> <key.pem>
"""
import http.server
import random
import ssl
import struct
import sys
import zlib


def png(width, height, seed):
    rnd = random.Random(seed)
    raw = bytearray()
    for _ in range(height):
        raw.append(0)  # filtro None
        raw.extend(rnd.getrandbits(8) for _ in range(width * 3))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))


GRANDE = png(200, 280, 1)   # ~168 KB: el «_hires» de la teja
CHICA = png(120, 168, 2)    # ~60 KB: la miniatura


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = GRANDE if 'hires' in self.path else CHICA
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(sys.argv[2], sys.argv[3])
srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
srv.serve_forever()
