#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// scripts/s3-local/probe-credentials.js — «¿el s3-local que escucha en este
//   puerto acepta MIS credenciales?»                              · devops
// =============================================================================
// DE DÓNDE VIENE (2026-10-05, pendiente de la rama `claude/arreglos-panel`)
//
//   `infra-smoke` y `kyc-ine-links` fallaban con 403 al hacer PUT a la URL
//   presignada del INE. Medido en el log del s3-local que ocupaba :9000
//   (`/home/user/tcg-skyd/.native-stack/s3.log`): 28 líneas
//       [s3-local] 403 PUT /tcg-photos/kyc_ine/… — la firma NO coincide
//   El servidor era de OTRO clon (`tcg-skyd`). Cada clon genera su propio
//   `S3_SECRET_ACCESS_KEY` en `<clon>/.native-stack/secrets.env` (S-88-1), y
//   `start_s3` de `stack-native.sh` REUTILIZABA cualquier cosa que respondiera en
//   el puerto («ya respondía en :9000, se reutiliza»). El backend del clon B
//   firmaba con el secreto de B contra un servidor que solo conoce el de A ⇒
//   403 SignatureDoesNotMatch. No es un defecto del producto ni del test: es el
//   arnés juntando dos clones en un recurso compartido (O-8, en el recurso
//   «puerto»).
//
// QUÉ HACE
//   Firma (SigV4, query presignada, sin SDK) un GET a un objeto que NO existe y
//   mira la respuesta:
//     · 404/200  ⇒ la firma fue aceptada: el servidor conoce mi secreto.  rc 0
//     · 403 con `SignatureDoesNotMatch` o «accessKeyId desconocido»
//                ⇒ el servidor firma con OTRO secreto (otro clon).        rc 1
//     · cualquier otra cosa (sin conexión, 5xx, 403 de otra clase)        rc 2
//   ⛔ No imprime el secreto ni la URL firmada. No escribe nada en el almacén.
//
// Uso (lo llama `stack-native.sh`; también a mano):
//   S3_LOCAL_HOST=127.0.0.1 S3_LOCAL_PORT=9000 S3_BUCKET=tcg-photos \
//   S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… node scripts/s3-local/probe-credentials.js
// =============================================================================
'use strict';

const crypto = require('crypto');
const http = require('http');

const HOST = process.env.S3_LOCAL_HOST || '127.0.0.1';
const PORT = Number(process.env.S3_LOCAL_PORT || '9000');
const BUCKET = process.env.S3_BUCKET || 'tcg-photos';
const KEY_ID = process.env.S3_ACCESS_KEY_ID || '';
const SECRET = process.env.S3_SECRET_ACCESS_KEY || '';
const REGION = process.env.S3_REGION || 'us-east-1';

if (!KEY_ID || !SECRET) {
  console.log('NO_CONCLUYENTE|faltan S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY en el entorno');
  process.exit(2);
}

const esc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d, 'utf8').digest();

const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fecha = amzDate.slice(0, 8);
const scope = `${fecha}/${REGION}/s3/aws4_request`;
const rawPath = `/${BUCKET}/__sonda-credenciales__/${crypto.randomBytes(8).toString('hex')}`;
const q = new Map([
  ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
  ['X-Amz-Credential', `${KEY_ID}/${scope}`],
  ['X-Amz-Date', amzDate],
  ['X-Amz-Expires', '60'],
  ['X-Amz-SignedHeaders', 'host'],
]);
const canonicalQuery = [...q.entries()]
  .map(([k, v]) => [esc(k), esc(v)])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  .map(([k, v]) => `${k}=${v}`)
  .join('&');
const hostHeader = `${HOST}:${PORT}`;
const canonicalRequest = ['GET', rawPath, canonicalQuery, `host:${hostHeader}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonicalRequest)].join('\n');
const kSigning = hmac(hmac(hmac(hmac(`AWS4${SECRET}`, fecha), REGION), 's3'), 'aws4_request');
const firma = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

const req = http.get(
  { host: HOST, port: PORT, path: `${rawPath}?${canonicalQuery}&X-Amz-Signature=${firma}`, headers: { host: hostHeader }, timeout: 5000 },
  (r) => {
    let b = '';
    r.on('data', (d) => (b += d));
    r.on('end', () => {
      const code = (b.match(/<Code>([^<]+)<\/Code>/) || [])[1] || '-';
      if (r.statusCode === 404 || r.statusCode === 200) {
        console.log(`ACEPTA|${r.statusCode} ${code}`);
        process.exit(0);
      }
      if (r.statusCode === 403 && (code === 'SignatureDoesNotMatch' || /accessKeyId desconocido|firma NO coincide/.test(b))) {
        console.log(`OTRO_SECRETO|${r.statusCode} ${code}`);
        process.exit(1);
      }
      console.log(`NO_CONCLUYENTE|${r.statusCode} ${code}`);
      process.exit(2);
    });
  },
);
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', (e) => {
  console.log(`NO_CONCLUYENTE|${e.message}`);
  process.exit(2);
});
