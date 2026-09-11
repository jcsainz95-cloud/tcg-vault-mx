#!/usr/bin/env python3
# =============================================================================
# canary.py — BLANCO DELIBERADAMENTE VULNERABLE para autoprobar el DAST · devops
# =============================================================================
# ⚠️  ESTO NO ES CÓDIGO DE LA APLICACIÓN. No se despliega, no se importa, no
#     comparte red con nada real. Vive aquí y solo lo levanta el job `selftest`
#     de .github/workflows/security-dast.yml (perfil `selftest` del compose).
#
# POR QUÉ EXISTE
# ---------------------------------------------------------------------------
# Un candado que no se puede poner ROJO no es un candado: es confianza falsa.
# El DAST de este repo llevaba desde su creación sin blanco (apuntaba a un
# staging inexistente), así que nadie había visto NUNCA al escáner encontrar
# algo ni al gate bloquear nada. "El escáner está cableado" era una creencia,
# no una medición.
#
# Este canario es la MEDICIÓN: planta vulnerabilidades conocidas, el mismo
# ZAP con el mismo `security/zap/baseline.conf` y el mismo
# `security/scripts/dast-gate.sh` lo escanean, y el job de selftest exige que
# el gate salga en ROJO. Si algún día alguien rompe el escáner, relaja
# `baseline.conf` hasta dejarlo inerte, o el gate deja de leer los informes,
# el selftest se pone VERDE-cuando-debía-ser-ROJO y el job falla.
#
# INVERSIÓN DEL VEREDICTO: en el job de selftest, gate ROJO = selftest OK.
#
# LO QUE PLANTA (y qué regla de ZAP debe cazarlo)
#   /                    índice con enlaces (para que el spider llegue a todo)
#   /boom                HTTP 500 + traza y error de SQL   -> 90022 (pasivo)
#   /search?q=<payload>  reflejo crudo en HTML             -> 40012 (activo)
#   /download?file=…     lectura de fichero sin sanear     -> 6     (activo)
#
# Se plantan CUATRO y basta con que UNA dispare: el selftest afirma «el gate
# se puso rojo», no «esta regla concreta disparó». Así el selftest no se
# vuelve frágil ante un cambio de firmas de ZAP. Dos son PASIVAS a propósito,
# para que el selftest siga valiendo con el perfil `baseline`.
#
# Sin dependencias: stdlib de Python. Sirve en 0.0.0.0:8080.
# =============================================================================
import html
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("CANARY_PORT", "8080"))

INDEX = """<!doctype html><html lang="en"><head><title>DAST canary</title></head>
<body>
<h1>DAST self-test canary</h1>
<p>Blanco deliberadamente vulnerable. NO es la aplicacion.</p>
<ul>
  <li><a href="/search?q=canary">buscar</a></li>
  <li><a href="/download?file=readme.txt">descargar</a></li>
  <li><a href="/boom">boom</a></li>
</ul>
<form action="/search" method="GET">
  <input type="text" name="q" value="canary">
  <input type="submit" value="Buscar">
</form>
</body></html>"""

# Traza sintetica: dispara "Application Error Disclosure" (ZAP 90022) por el
# patron de error de servidor + mensaje de motor SQL en el cuerpo.
BOOM = """<!doctype html><html><body><h1>Internal Server Error</h1><pre>
org.postgresql.util.PSQLException: ERROR: syntax error at or near "'"
  Position: 42
    at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2725)
    at org.postgresql.jdbc.PgStatement.executeInternal(PgStatement.java:513)
    at com.example.vault.CardRepository.findByName(CardRepository.java:88)
Microsoft OLE DB Provider for ODBC Drivers error '80040e14'
</pre></body></html>"""


class Canary(BaseHTTPRequestHandler):
    server_version = "DASTCanary/1.0"

    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        raw = body.encode("utf-8", "replace")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path in ("/", "/index.html"):
            return self._send(200, INDEX)

        if u.path == "/boom":
            # 500 + traza: Application Error Disclosure (pasivo).
            return self._send(500, BOOM)

        if u.path == "/search":
            # XSS reflejado: el parametro entra CRUDO en el HTML. A proposito.
            term = q.get("q", [""])[0]
            return self._send(
                200,
                "<!doctype html><html><body><h1>Resultados</h1>"
                "<p>Buscaste: " + term + "</p>"
                '<form action="/search" method="GET">'
                '<input type="text" name="q"><input type="submit"></form>'
                "</body></html>",
            )

        if u.path == "/download":
            # Path traversal: se concatena la ruta sin sanear. A proposito.
            name = q.get("file", ["readme.txt"])[0]
            base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "www")
            try:
                with open(os.path.join(base, name), "rb") as fh:
                    data = fh.read()
            except OSError as exc:
                return self._send(404, "<html><body>no: %s</body></html>" % html.escape(str(exc)))
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)

        return self._send(404, "<html><body>404</body></html>")

    def log_message(self, fmt, *args):
        sys.stderr.write("canary %s\n" % (fmt % args))


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Canary).serve_forever()
