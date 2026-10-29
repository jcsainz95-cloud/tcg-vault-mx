#!/usr/bin/env python3
"""Servidor de maqueta para los candados de stack-native.sh (devops).

Responde 200 a todo GET. En /api/v1/health devuelve {"status":"ok","uptime":<s desde que arrancó>},
la misma clave que lee assert-serving-head.sh. Solo escucha en 127.0.0.1. Uso:
    python3 -I fake-health-server.py <puerto>
Lo arranca y lo apaga (por PID) el candado que lo usa; nunca queda vivo.
"""
import http.server
import json
import sys
import time

START = time.time()


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path.startswith('/api/v1/health'):
            body = json.dumps({'status': 'ok', 'uptime': int(time.time() - START)}).encode()
            ctype = 'application/json'
        else:
            body = b'<!doctype html><html><head><title>maqueta</title></head><body><h1>maqueta</h1></body></html>'
            ctype = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # silencio
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
