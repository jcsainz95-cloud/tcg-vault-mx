#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// scripts/s3-local/server.js — endpoint S3 para la ruta NATIVA   ·  Propiedad: devops
// TCG Vault MX
// =============================================================================
// POR QUÉ EXISTE (hueco medido por QA, DEVOPS_NOTES §39.2)
//
//   `scripts/stack-native.sh` levanta Postgres y Redis nativos porque en este
//   entorno NO hay demonio de Docker (`/var/run/docker.sock` no existe). Para
//   MinIO no había equivalente, así que la ruta nativa se quedaba SIN object
//   storage — y el smoke que debía cubrirlo,
//   `backend/test/integration/infra-smoke.e2e-spec.ts`, tiene una rama que
//   **se salta a sí misma** cuando el PUT presignado devuelve 403 o falla la
//   conexión (`console.warn` + `return`, sin `E2E_STRICT_INFRA=true`).
//   Resultado: la subida del INE del buylist (`purpose: 'kyc_ine'`, la ÚNICA
//   subida del producto, y es PII) NO se ejercitaba y la corrida salía VERDE.
//   Un smoke que se salta a sí mismo en silencio no es un smoke.
//
//   El binario de MinIO no se puede descargar en esta máquina (`dl.min.io`
//   responde `CONNECT tunnel failed, 403` a través del proxy de egress —
//   medido). El registro npm SÍ es alcanzable. De ahí este arranque.
//
// QUÉ ES, CON PRECISIÓN (y qué NO es)
//   Es `s3rver` 3.7.1 (implementación S3 en Node, de uso común en tests) con
//   tres cosas añadidas por devops:
//     1. El par de credenciales se REGISTRA desde el entorno, para que la ruta
//        nativa use exactamente las mismas `S3_ACCESS_KEY_ID` /
//        `S3_SECRET_ACCESS_KEY` que `.env.example` y `docker-compose.yml`.
//        (s3rver trae un par fijo `S3RVER`/`S3RVER`; si la ruta nativa usara
//        ESE, el arnés nativo y el de Docker probarían configuraciones
//        distintas y la diferencia no se vería en ningún diff.)
//     2. Se RECHAZAN las escrituras ANÓNIMAS (sin `Authorization` ni
//        `X-Amz-Signature`). s3rver las acepta por defecto; MinIO y R2 no.
//        Sin esto, el día que el backend dejara de firmar la URL presignada
//        el stand-in devolvería 200 y el smoke pasaría — el mismo falso verde
//        que este fichero existe para impedir, con otra cara.
//     3. Se VERIFICA la firma SigV4 de las URLs PRESIGNADAS (las de query
//        `X-Amz-Signature`), que es la ruta del INE. ⚠️ ESTO NO ES UN EXTRA:
//        s3rver **no verifica SigV4** — su propio código lo dice, literal,
//        `lib/middleware/authentication.js`:
//            } else if (signature.version === 4) {
//              // Signature version 4 calculation is unimplemeneted
//              ctx.state.account = account;
//        Sólo comprueba que el `accessKeyId` exista. MEDIDO antes de escribir
//        esto: una URL presignada con el SECRETO EQUIVOCADO devolvía **200**.
//        Un stand-in que acepta cualquier firma convierte el smoke de subida en
//        otro smoke que no mide nada — exactamente el defecto que se venía a
//        cerrar. La verificación está más abajo (`verificarSigV4Presignada`).
//     4. Arranca el bucket vacío o lo reutiliza; nunca borra datos al arrancar.
//
//   NO es MinIO. Diferencias conocidas y DECLARADAS (DEVOPS_NOTES §39.2.3):
//     · No implementa políticas de bucket ⇒ **este stand-in NO sirve para
//       probar que el bucket es privado** (SEC-A5/v1.2.1). Esa propiedad se
//       verifica en la ruta Docker/CI (`docker-compose.yml`, servicio
//       `createbuckets` con `mc anonymous set none`) y en R2 en producción.
//     · No implementa versionado, lifecycle, ni multipart completo.
//     · La firma se verifica en las peticiones PRESIGNADAS (query). Las
//       peticiones con `Authorization:` (las que hace el backend server-side)
//       siguen con el comportamiento de s3rver: se comprueba el `accessKeyId`,
//       NO el HMAC. Declarado, no tapado.
//   Lo que SÍ prueba, que es lo que faltaba: que `POST /uploads/presign` produce
//   una URL que un servidor S3 **verifica y acepta**, y que el objeto queda
//   escrito. Eso es la ruta de subida del INE de punta a punta.
//
// USO (lo cablea `scripts/stack-native.sh`; también corre a mano):
//   S3_BUCKET=tcg-photos S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
//   S3_LOCAL_PORT=9000 S3_LOCAL_DIR=.native-stack/s3 node scripts/s3-local/server.js
//
// VARIABLES (todas con default de DESARROLLO LOCAL; ninguna es un secreto real)
//   S3_LOCAL_HOST        127.0.0.1   nunca 0.0.0.0: mismo criterio SEC-M4 que el compose
//   S3_LOCAL_PORT        9000        el mismo puerto que MinIO en docker-compose.yml
//   S3_LOCAL_DIR         .native-stack/s3
//   S3_BUCKET            tcg-photos
//   S3_ACCESS_KEY_ID     minioadmin
//   S3_SECRET_ACCESS_KEY minioadmin_local_dev
//   S3_LOCAL_ALLOW_ANON  (sin default) '1' desactiva la guarda (2). Existe para
//                        poder DEMOSTRAR que la guarda funciona (se rompe a
//                        propósito y se enseña el rojo). No la uses en un gate.
// =============================================================================
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const S3rver = require('s3rver');
// API interna de s3rver 3.7.x. Se toca a sabiendas y por eso la versión está
// CLAVADA (no `^`) en package.json: si un `npm update` la moviera, este require
// falla RUIDOSAMENTE al arrancar en vez de degradar a las credenciales fijas.
const AWSAccount = require('s3rver/lib/models/account');

const HOST = process.env.S3_LOCAL_HOST || '127.0.0.1';
const PORT = parseInt(process.env.S3_LOCAL_PORT || '9000', 10);
const BUCKET = process.env.S3_BUCKET || 'tcg-photos';
const ACCESS_KEY = process.env.S3_ACCESS_KEY_ID || 'minioadmin';
const SECRET_KEY = process.env.S3_SECRET_ACCESS_KEY || 'minioadmin_local_dev';
const ALLOW_ANON = process.env.S3_LOCAL_ALLOW_ANON === '1';
const DIR = path.resolve(
  process.env.S3_LOCAL_DIR || path.join(__dirname, '..', '..', '.native-stack', 's3'),
);

fs.mkdirSync(DIR, { recursive: true });

// --- (1) credenciales del entorno -------------------------------------------
if (!AWSAccount || !AWSAccount.DUMMY_ACCOUNT || typeof AWSAccount.DUMMY_ACCOUNT.createKeyPair !== 'function') {
  console.error(
    '[s3-local] s3rver cambió su modelo de cuentas: no puedo registrar las credenciales ' +
      'de `.env.example`. NO arranco degradado con otras credenciales — eso haría que el ' +
      'arnés nativo probase una configuración distinta de la del compose sin que se note. ' +
      'Fija la versión de s3rver a 3.7.1 (scripts/s3-local/package.json).',
  );
  process.exit(2);
}
AWSAccount.DUMMY_ACCOUNT.createKeyPair(ACCESS_KEY, SECRET_KEY);

const instance = new S3rver({
  address: HOST,
  port: PORT,
  silent: true,
  directory: DIR,
  configureBuckets: [{ name: BUCKET }],
});

// --- (2) guarda anti-anónimo -------------------------------------------------
// MinIO/R2 con el bucket privado (`mc anonymous set none`, docker-compose.yml
// servicio `createbuckets`) rechazan CUALQUIER petición sin firma, no sólo las
// de escritura. s3rver las acepta todas. La diferencia importa dos veces:
//   · escritura: es la regresión «el backend dejó de firmar el presign»;
//   · lectura:   el bucket guarda INE (PII). Un stand-in que sirve el objeto a
//     un `curl` pelado enseñaría un comportamiento que en producción es una
//     fuga. Medido antes de poner esta guarda: `GET` anónimo devolvía 200 y el
//     contenido del objeto.
// Se exige firma en TODO método. Consecuencia buscada: un sondeo de vida sin
// firmar recibe 403 — «403 = está vivo y es privado» es la lectura correcta, y
// así lo trata `stack-native.sh`.
function vieneFirmada(req) {
  if (req.headers.authorization) return true;
  const q = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?') + 1) : '';
  return /(^|&)X-Amz-Signature=/i.test(q) || /(^|&)Signature=/i.test(q);
}

// --- (3) verificación REAL de la firma SigV4 presignada ----------------------
// s3rver no la implementa (ver cabecera). Se implementa aquí sobre `crypto`,
// siguiendo el proceso de firma de AWS tal cual: canonical request → string to
// sign → clave derivada → HMAC. Sólo se aplica a las peticiones PRESIGNADAS
// (las que traen `X-Amz-Signature` en la query), que son las que produce
// `POST /uploads/presign`. Si algo no cuadra, se RECHAZA: fallar cerrado.
function uriEscape(s) {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
function sha256Hex(x) {
  return crypto.createHash('sha256').update(x).digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

// -> null si la firma es válida (o si la petición no es presignada);
//    string con el motivo si NO lo es.
function verificarSigV4Presignada(req) {
  const qIdx = req.url.indexOf('?');
  if (qIdx < 0) return null;
  const rawPath = req.url.slice(0, qIdx);
  const params = new URLSearchParams(req.url.slice(qIdx + 1));

  const provided = params.get('X-Amz-Signature');
  if (!provided) return null; // no presignada: la trata s3rver (o la guarda anónima)
  if (params.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256') {
    return `algoritmo no soportado: ${params.get('X-Amz-Algorithm')}`;
  }

  const credential = params.get('X-Amz-Credential') || '';
  const [keyId, fecha, region, servicio, terminador] = credential.split('/');
  if (!keyId || !fecha || !region || !servicio || terminador !== 'aws4_request') {
    return `X-Amz-Credential mal formado: "${credential}"`;
  }
  if (keyId !== ACCESS_KEY) {
    return `accessKeyId desconocido: "${keyId}" (este servidor sólo conoce "${ACCESS_KEY}")`;
  }
  const amzDate = params.get('X-Amz-Date');
  if (!amzDate) return 'falta X-Amz-Date';

  const signedHeaders = (params.get('X-Amz-SignedHeaders') || '').split(';').filter(Boolean);
  if (!signedHeaders.length) return 'falta X-Amz-SignedHeaders';

  const canonicalHeaders = signedHeaders
    .map((h) => {
      const v = req.headers[h.toLowerCase()];
      const val = Array.isArray(v) ? v.join(',') : v == null ? '' : String(v);
      return `${h.toLowerCase()}:${val.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');

  const canonicalQuery = [...params.entries()]
    .filter(([k]) => k !== 'X-Amz-Signature')
    .map(([k, v]) => [uriEscape(k), uriEscape(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  // En una URL presignada el cuerpo no está firmado: el hash va en la query
  // (`X-Amz-Content-Sha256`) y vale `UNSIGNED-PAYLOAD`.
  const payloadHash = params.get('X-Amz-Content-Sha256') || 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    req.method,
    rawPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.map((h) => h.toLowerCase()).join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${fecha}/${region}/${servicio}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${SECRET_KEY}`, fecha);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, servicio);
  const kSigning = hmac(kService, 'aws4_request');
  const esperada = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  if (esperada.length !== provided.length) return 'la firma no coincide (longitud distinta)';
  if (!crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(provided))) {
    return 'la firma NO coincide: el cliente firmó con otro secreto, otra región o otra petición';
  }
  return null;
}

const handler = instance.getMiddleware();

function denegar(res, motivo) {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Error><Code>SignatureDoesNotMatch</Code>' +
    `<Message>${motivo.replace(/[<&>]/g, '')}</Message>` +
    '</Error>';
  res.writeHead(403, { 'content-type': 'application/xml', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (!ALLOW_ANON && !vieneFirmada(req)) {
    denegar(
      res,
      'Peticion ANONIMA rechazada por s3-local (paridad con MinIO/R2: bucket privado, ' +
        'guarda SEC-A5/v1.2.1). Si esto sale en un smoke, el cliente NO esta firmando. ' +
        'Un 403 aqui tambien significa "el servidor esta VIVO".',
    );
    return;
  }
  if (!ALLOW_ANON) {
    let motivo = null;
    try {
      motivo = verificarSigV4Presignada(req);
    } catch (e) {
      motivo = `no pude verificar la firma: ${e && e.message ? e.message : e}`;
    }
    if (motivo) {
      console.error(`[s3-local] 403 ${req.method} ${req.url.split('?')[0]} — ${motivo}`);
      denegar(res, `${motivo}. Ver docs/DEVOPS_NOTES.md §39.2.`);
      return;
    }
  }
  handler(req, res);
});

instance
  .configureBuckets()
  .then(
    () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, HOST, resolve);
      }),
  )
  .then(() => {
    console.log(
      `[s3-local] escuchando en http://${HOST}:${PORT}  ·  bucket "${BUCKET}"  ·  datos en ${DIR}`,
    );
    console.log(
      `[s3-local] credenciales: accessKeyId="${ACCESS_KEY}" (secreto NO se imprime)  ·  ` +
        `escritura anonima: ${ALLOW_ANON ? 'PERMITIDA (S3_LOCAL_ALLOW_ANON=1 — NO es modo gate)' : 'RECHAZADA'}`,
    );
    console.log('[s3-local] NO es MinIO: no valida politicas de bucket. Ver docs/DEVOPS_NOTES.md §39.2.3.');
  })
  .catch((err) => {
    console.error(`[s3-local] no pude arrancar: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
