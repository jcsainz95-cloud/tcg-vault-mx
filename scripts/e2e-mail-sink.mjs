#!/usr/bin/env node
// =============================================================================
// e2e-mail-sink.mjs — buzón FALSO de Resend para el E2E real (solo CI) · devops
// =============================================================================
// POR QUÉ EXISTE (2026-11-04, run 41757369935 de e2e-real.yml)
//   `frontend/e2e/cuenta-correo.spec.ts` (CTA-E3/E4/E5) lee el enlace con token
//   del CORREO que manda el backend. En local (`stack-native.sh`, NODE_ENV=development
//   sin RESEND_API_KEY) el backend usa `NoopMailAdapter` y escribe el cuerpo en su log.
//   En e2e-real NO: el stack es `docker-compose.staging.yml` con NODE_ENV=production,
//   `env.validation.ts` EXIGE RESEND_API_KEY y el preflight le da una EFÍMERA ⇒ el
//   backend usa `ResendMailAdapter` y cada envío muere en api.resend.com con
//   «API key is invalid» (medido en el log del run). No hay cuerpo en ningún log.
//
// QUÉ HACE
//   El SDK `resend` (4.8.0, fijado en backend/package-lock.json) toma su URL base de
//   `process.env.RESEND_BASE_URL` (dist/index.js: `process.env.RESEND_BASE_URL ||
//   "https://api.resend.com"`). `docker-compose.e2e-mail.yml` se la apunta a ESTE
//   proceso, que responde como Resend a `POST /emails` y apunta destinatario, asunto
//   y TEXTO del correo en un fichero con el formato que el spec ya lee (el del Noop:
//   `to=<correo> subject="…"` y el cuerpo debajo). Así el backend corre el adaptador
//   de PRODUCCIÓN de punta a punta (SDK + HTTP) y nada sale del runner.
//
// LÍMITES (no negociables)
//   · Nunca escribe cabeceras: la `Authorization: Bearer` es la llave (efímera, pero
//     es una llave). Solo `to`, `cc`, `subject` y `text`.
//   · Solo CI. El candado `scripts/check-mail-sink-scope.sh` exige que
//     RESEND_BASE_URL viva ÚNICAMENTE en `docker-compose.e2e-mail.yml` y que solo
//     `e2e-real.yml` use ese override: en producción redirigiría TODO el correo
//     (enlaces de reseteo incluidos) a otro sitio.
//
// Uso: node scripts/e2e-mail-sink.mjs --port 8025 --out /ruta/mail.log
//   GET /health → 200 «ok» (para esperar a que escuche).
// =============================================================================
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(arg('port', '8025'));
const OUT = arg('out', '');
if (!OUT) {
  console.error('e2e-mail-sink: falta --out <fichero>');
  process.exit(2);
}
writeFileSync(OUT, '', { mode: 0o644 });

const MAX_BODY = 5 * 1024 * 1024;

function list(v) {
  if (Array.isArray(v)) return v.join(', ');
  return typeof v === 'string' ? v : '';
}

function reply(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/emails') {
    reply(res, 404, { name: 'not_found', message: `e2e-mail-sink: ${req.method} ${req.url} no existe aquí` });
    return;
  }
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      reply(res, 413, { name: 'validation_error', message: 'cuerpo demasiado grande' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let msg;
    try {
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      reply(res, 422, { name: 'validation_error', message: 'JSON inválido' });
      return;
    }
    const to = list(msg.to);
    if (!to) {
      reply(res, 422, { name: 'validation_error', message: 'falta `to`' });
      return;
    }
    const id = randomUUID();
    const cc = list(msg.cc);
    const subject = typeof msg.subject === 'string' ? msg.subject : '';
    const text = typeof msg.text === 'string' ? msg.text : '';
    // Mismo formato que NoopMailAdapter: el spec busca `to=<correo> ` y el enlace después.
    appendFileSync(
      OUT,
      `[E2E MAIL SINK] ${new Date().toISOString()} id=${id} to=${to}${cc ? ` cc=${cc}` : ''} subject=${JSON.stringify(subject)}\n${text}\n[/E2E MAIL SINK]\n`,
    );
    reply(res, 200, { id });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`e2e-mail-sink escuchando en :${PORT} → ${OUT}`);
});
