#!/usr/bin/env node
/**
 * delay-proxy.mjs — proxy HTTP de PRUEBA con fallos inyectados (API_CONTRACT §DYN.7: DYN-D1 y DYN-D2) · devops
 *
 * Proxy inverso sin dependencias que reenvía todo a `--upstream` y, a las peticiones GET cuya
 * ruta+consulta casa una regla, les aplica un fallo:
 *   --rule '<regex>=delay:<ms>'   espera <ms> antes de reenviar (criterio 937: «datos retrasados 5 s»)
 *   --rule '<regex>=503'          responde 503 sin reenviar   (criterio 937: «por separado fallando»)
 *   --rule '<regex>=pad:<KB>'     le mete al HTML <KB> de comentario incompresible justo tras `<head>`
 *                                 (canario de DYN-D1: «retraso artificial de la portada»)
 * Sin reglas es transparente. Dos usos en `scripts/home-perf/run.sh`:
 *   · entre la tienda y el API (DYN-D2): retrasa o tumba `/catalog/featured` y la vitrina;
 *   · delante de la tienda (canario de DYN-D1): engorda el HTML de la portada.
 *
 * POR QUÉ EL CANARIO ENGORDA Y NO RETRASA (medido el 2026-10-29, N=5 por perfil, LH 12.6.1): con el
 * perfil ESTÁNDAR (throttling simulado, Lantern) un retraso de 2 s del HTML en el servidor NO mueve el
 * FCP: `server-response-time` 2073 ms y FCP simulado 1410 ms, contra 110 ms y 1425 ms sin retraso (el
 * FCP observado sí sube a 2375 ms). La simulación no ve el TTFB del documento, pero sí sus BYTES: un HTML
 * más pesado tarda más en bajar en el Slow 4G simulado, igual que para un cliente de verdad.
 *
 * ⛔ SOLO FUERA DE PRODUCCIÓN, por construcción y no por disciplina:
 *   · escucha únicamente en 127.0.0.1;
 *   · se niega a arrancar si `--upstream` no es un host local (localhost / 127.0.0.1 / ::1),
 *     así que no puede quedar delante de tcghunt.mx ni del API de Railway;
 *   · no existe en ningún código de `frontend/` ni `backend/`: las variables del canario
 *     (`HOME_PERF_CANARY_PAD_KB`) solo las lee `run.sh`.
 * Candado: scripts/check-home-perf.sh (prueba el proxy, N=10, y su negativa a un upstream remoto).
 *
 * Uso: node delay-proxy.mjs --listen <puerto> --upstream http://127.0.0.1:<puerto> [--rule …]… [--log fichero]
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = { rules: [] };
for (let i = 0; i < args.length; i += 2) {
  const [k, v] = [args[i], args[i + 1]];
  if (v === undefined) die(`falta valor para ${k}`);
  if (k === '--listen') opt.listen = Number(v);
  else if (k === '--upstream') opt.upstream = v;
  else if (k === '--log') opt.log = v;
  else if (k === '--rule') {
    const eq = v.lastIndexOf('=');
    if (eq < 1) die(`regla mal formada: ${v}`);
    const action = v.slice(eq + 1);
    let fault;
    if (action === '503') fault = { kind: '503' };
    else if (/^delay:\d+$/.test(action)) fault = { kind: 'delay', ms: Number(action.slice(6)) };
    else if (/^pad:\d+$/.test(action)) fault = { kind: 'pad', kb: Number(action.slice(4)) };
    else die(`acción desconocida «${action}» (usa delay:<ms>, pad:<KB> o 503)`);
    opt.rules.push({ re: new RegExp(v.slice(0, eq)), fault, src: v });
  } else die(`opción desconocida ${k}`);
}
if (!Number.isInteger(opt.listen) || opt.listen <= 0) die('falta --listen <puerto>');
let up;
try { up = new URL(opt.upstream); } catch { die('falta --upstream http://127.0.0.1:<puerto>'); }
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(up.hostname) || up.protocol !== 'http:') {
  die(`upstream «${up.host}» no es local: este proxy es SOLO de prueba y no se pone delante de nada publicado`);
}

function die(msg) {
  process.stderr.write(`delay-proxy: ${msg}\n`);
  process.exit(2);
}
function log(line) {
  if (opt.log) appendFileSync(opt.log, `${new Date().toISOString()} ${line}\n`);
}
const accion = (f) => (f.kind === 'delay' ? `delay:${f.ms}` : f.kind === 'pad' ? `pad:${f.kb}` : '503');

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
function upstreamRequest(req, headers, onResponse, res) {
  const p = http.request(
    { protocol: up.protocol, hostname: up.hostname.replace(/^\[|\]$/g, ''), port: up.port, method: req.method, path: req.url, headers, agent },
    onResponse,
  );
  p.on('error', (e) => {
    log(`ERR ${req.method} ${req.url} ${e.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('delay-proxy: upstream no responde');
  });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  const rule = req.method === 'GET' ? opt.rules.find((r) => r.re.test(req.url)) : undefined;
  const headers = { ...req.headers, host: up.host };
  const forward = () =>
    upstreamRequest(req, headers, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    }, res);
  if (!rule) return forward();
  log(`${accion(rule.fault)} ${req.method} ${req.url}`);
  if (rule.fault.kind === '503') {
    req.resume();
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end('{"error":{"code":"SERVICE_UNAVAILABLE","message":"delay-proxy: fallo inyectado"}}');
  }
  if (rule.fault.kind === 'delay') return setTimeout(forward, rule.fault.ms);
  // pad: se pide SIN compresión, se bufferiza y se inserta el comentario tras la etiqueta <head …>.
  headers['accept-encoding'] = 'identity';
  upstreamRequest(req, headers, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      let body = Buffer.concat(chunks).toString('utf8');
      const isHtml = /text\/html/.test(String(r.headers['content-type'] ?? ''));
      if (isHtml) {
        const relleno = `<!-- canario home-perf: ${randomBytes(Math.ceil((rule.fault.kb * 1024 * 3) / 4)).toString('base64')} -->`;
        body = /<head[^>]*>/i.test(body) ? body.replace(/<head[^>]*>/i, (m) => m + relleno) : relleno + body;
      }
      const out = Buffer.from(body, 'utf8');
      const h = { ...r.headers, 'content-length': String(out.length) };
      delete h['transfer-encoding'];
      delete h['content-encoding'];
      res.writeHead(r.statusCode ?? 502, h);
      res.end(out);
    });
  }, res);
});
server.listen(opt.listen, '127.0.0.1', () => {
  log(`LISTEN 127.0.0.1:${opt.listen} -> ${up.origin} reglas=[${opt.rules.map((r) => r.src).join(' | ')}]`);
  process.stdout.write(`delay-proxy :${opt.listen} -> ${up.origin} (${opt.rules.length} regla/s)\n`);
});
// Salida inmediata: con conexiones keep-alive abiertas, `server.close()` esperaría a que el navegador las suelte.
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => process.exit(0));
