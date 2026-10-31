#!/usr/bin/env python3
"""API de admin de maqueta para el candado de check-graded-estimate-dials.sh (devops).

Sirve, solo en 127.0.0.1 y solo con `Authorization: Bearer ...`, tres JSON de un directorio:
    GET /api/v1/admin/settings                        -> <dir>/settings.json
    GET /api/v1/admin/pricing/graded-estimates        -> <dir>/m2.json
    GET /api/v1/admin/pricing/graded-estimates/budget -> <dir>/budget.json
El directorio se relee en cada petición: el candado cambia de escenario reescribiendo ficheros.
Uso: python3 -I fake-admin-api.py <puerto> <dir>
"""
import http.server
import os
import sys

DIR = sys.argv[2]
RUTAS = {
    '/api/v1/admin/settings': 'settings.json',
    '/api/v1/admin/pricing/graded-estimates': 'm2.json',
    '/api/v1/admin/pricing/graded-estimates/budget': 'budget.json',
}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if not self.headers.get('Authorization', '').startswith('Bearer '):
            return self._send(401, b'{"error":{"code":"UNAUTHORIZED"}}')
        f = RUTAS.get(self.path.split('?')[0])
        p = os.path.join(DIR, f) if f else None
        if not p or not os.path.exists(p):
            return self._send(404, b'{"error":{"code":"NOT_FOUND"}}')
        with open(p, 'rb') as fh:
            self._send(200, fh.read())

    def _send(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
