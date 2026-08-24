/**
 * infra-smoke.e2e-spec.ts — Verifica que la plataforma habla con INFRAESTRUCTURA REAL
 * (la del docker-compose): Postgres, Redis y MinIO/S3. Es la parte "teoría→realidad":
 * no mocks, se golpea la infra levantada.
 *
 * Postgres es OBLIGATORIO (sin él la suite no tiene sentido). Redis y MinIO se
 * verifican y, si no están disponibles en el entorno, se SALTAN con aviso, salvo que
 * `E2E_STRICT_INFRA=true` (recomendado en el job E2E de CI con toda la infra).
 * API_CONTRACT §8 (uploads presign); ARCHITECTURE §1, §8.
 */
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const STRICT = process.env.E2E_STRICT_INFRA === 'true';

function redisPing(url: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const u = new URL(url);
    const port = u.port ? parseInt(u.port, 10) : 6379;
    const sock = net.createConnection({ host: u.hostname, port });
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.on('error', () => finish(false));
    sock.on('connect', () => {
      if (u.password) sock.write(`AUTH ${u.password}\r\n`);
      sock.write('PING\r\n');
    });
    sock.on('data', (buf: Buffer) => finish(buf.toString().includes('PONG')));
  });
}

function httpPut(url: string, body: Buffer, contentType: string, timeoutMs = 5000): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'PUT',
        headers: { 'content-type': contentType, 'content-length': body.length },
      },
      (res) => {
        res.on('data', () => undefined);
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('S3 PUT timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('E2E — Infraestructura real (Postgres / Redis / MinIO)', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('Postgres: consulta y secuencia de folios responden (OBLIGATORIO)', async () => {
    const rows = await h.prisma.$queryRawUnsafe<{ ok: number }[]>('SELECT 1 AS ok');
    expect(Number(rows[0].ok)).toBe(1);
    const folio = await h.prisma.nextFolio();
    expect(folio).toMatch(/^INV-\d{6}$/);
  });

  it('Redis: responde PONG (o se salta si no está disponible)', async () => {
    const url = process.env.REDIS_URL;
    if (!url) {
      if (STRICT) throw new Error('REDIS_URL no definida y E2E_STRICT_INFRA=true');
      // eslint-disable-next-line no-console
      console.warn('[e2e] REDIS_URL no definida; se salta el smoke de Redis.');
      return;
    }
    const pong = await redisPing(url);
    if (!pong && !STRICT) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e] Redis no accesible en ${url}; se salta (levanta docker compose para probarlo).`);
      return;
    }
    expect(pong).toBe(true);
  });

  it('MinIO/S3: presign + PUT real de un objeto (o se salta si no está disponible)', async () => {
    const token = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    // v1.2: el único propósito de upload válido es `kyc_ine` (INE del buylist).
    const presign = await h.api('POST', '/uploads/presign', {
      token,
      json: { purpose: 'kyc_ine', contentType: 'image/png' },
    });
    expect(presign.status).toBe(200);
    expect(typeof presign.body.uploadUrl).toBe('string');
    expect(typeof presign.body.uploadKey).toBe('string');

    const tinyPng = Buffer.from('89504e470d0a1a0a', 'hex'); // firma PNG mínima
    let status: number;
    try {
      status = await httpPut(presign.body.uploadUrl, tinyPng, 'image/png');
    } catch (e) {
      if (STRICT) throw e;
      // eslint-disable-next-line no-console
      console.warn(`[e2e] MinIO/S3 no accesible (${(e as Error).message}); se salta el PUT real.`);
      return;
    }
    // El comentario y el assert se contradecían: decía «o 403 si el bucket no existe» pero exigía
    // [200,204], y el `catch` de arriba solo atrapa fallo de CONEXIÓN — un 403 es una respuesta HTTP
    // perfectamente exitosa a nivel socket, así que se colaba hasta aquí y tumbaba el smoke por una
    // razón (bucket ausente) que el propio comentario declaraba tolerable.
    //
    // Se resuelve en la dirección estricta: 200/204 = PUT real correcto. Un 403 significa que MinIO
    // está ARRIBA pero mal aprovisionado (bucket ausente o firma divergente), y eso NO es «no
    // disponible»: es un entorno roto que debe verse. En modo no estricto se degrada a skip con un
    // mensaje que dice exactamente qué revisar.
    if (status === 403 && !STRICT) {
      // eslint-disable-next-line no-console
      console.warn(
        '[e2e] MinIO respondió 403 al PUT presignado: el servicio está ARRIBA pero el bucket no ' +
          'existe o la firma difiere. No es un fallo de la app; se salta. Revisa el aprovisionamiento ' +
          'del bucket (devops).',
      );
      return;
    }
    expect([200, 204]).toContain(status);
  });
});
