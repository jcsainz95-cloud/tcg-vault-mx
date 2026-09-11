/**
 * kyc-ine-links.e2e-spec.ts — **v1.69 (P-78) contra la app REAL y Postgres REAL.**
 * API_CONTRACT §M6-K (candados **K-1, K-2, K-3, K-4, K-5, K-6, K-7**) · ARCHITECTURE §4.49.
 *
 * ⭐ **Por qué esta suite existe y no basta la unitaria:** §M6-K.9 dice, con todas las letras, que
 * **K-1 se comprueba LLAMANDO al endpoint con un token de operador, «saltándose la pantalla», y no
 * leyendo el decorador**. Un `@Roles` bien escrito y un guard mal montado se leen igual en el
 * código; solo se distinguen por HTTP. Lo mismo vale para `Cache-Control`, que ninguna aserción de
 * unidad puede ver salir por el cable.
 *
 * ⚠️ **No hace falta MinIO/R2 vivo:** firmar un presigned GET es una operación **local** (HMAC sobre
 * la petición). Lo que se mide aquí es **quién puede pedirlo, qué sale y qué queda registrado** — no
 * que el objeto exista.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const FRONT_KEY = 'kyc_ine/2026-09-11/e2e-front.png';
const BACK_KEY = 'kyc_ine/2026-09-11/e2e-back.png';

describe('E2E — §M6-K: leer el INE, decidir con motivo, y que el cliente lo sepa', () => {
  let h: E2EHarness;
  let adminToken: string;
  let operatorToken: string;
  let customerToken: string;
  let userId: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customerToken = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    userId = u!.id;
  });

  afterAll(async () => {
    // Se deja el KYC del fixture como estaba: sin imágenes, sin decisión.
    if (h && userId) {
      await h.prisma.kycProfile.updateMany({
        where: { userId },
        data: {
          ineFrontKey: null,
          ineBackKey: null,
          kycStatus: 'none',
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
          verifiedAt: null,
          verifiedBy: null,
        },
      });
      await h.prisma.auditLog.deleteMany({ where: { action: 'user.kyc.reveal_ine', entityId: userId } });
    }
    await h?.close();
  });

  /** Deja al usuario con INE completo en archivo (sin subir nada a R2: solo las keys). */
  async function withIne(front: string | null = FRONT_KEY, back: string | null = BACK_KEY) {
    await h.prisma.kycProfile.upsert({
      where: { userId },
      create: { userId, ineFrontKey: front, ineBackKey: back, kycStatus: 'pending' },
      update: { ineFrontKey: front, ineBackKey: back },
    });
  }

  describe('K-1 · el rol, medido LLAMANDO (no leyendo el decorador)', () => {
    it('⛔ `vault_operator` ⇒ 403 FORBIDDEN — la decisión (a) del dueño es literal', async () => {
      await withIne();
      const res = await h.api('GET', `/admin/users/${userId}/kyc/ine-links`, { token: operatorToken });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      // ⛔ Y ni de refilón una URL o una key en el cuerpo del rechazo.
      expect(res.text).not.toContain('X-Amz-Signature');
      expect(res.text).not.toContain('kyc_ine/');
    });

    it('⛔ `customer` ⇒ 403 (aunque sea SU PROPIA identidad: esta ruta no es del cliente)', async () => {
      const res = await h.api('GET', `/admin/users/${userId}/kyc/ine-links`, { token: customerToken });
      expect(res.status).toBe(403);
    });

    it('⛔ sin sesión ⇒ 401 UNAUTHENTICATED', async () => {
      const res = await h.api('GET', `/admin/users/${userId}/kyc/ine-links`);
      expect(res.status).toBe(401);
    });
  });

  describe('K.2 · la respuesta del `super_admin`', () => {
    it('200 con dos enlaces firmados, TTL 120 y `Cache-Control: no-store`', async () => {
      await withIne();
      const res = await h.api('GET', `/admin/users/${userId}/kyc/ine-links`, { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(userId);
      expect(res.body.expiresInSeconds).toBe(120);
      expect(res.body.front.url).toContain('X-Amz-Signature=');
      expect(res.body.back.url).toContain('X-Amz-Signature=');
      // ⭐ Hallazgo de `seguridad`: la respuesta transporta DOS credenciales portadoras.
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      // El enlace fuerza descarga (S-B3): no se puede navegar a él como documento.
      expect(decodeURIComponent(res.body.front.url)).toContain('response-content-disposition=attachment');
      // ⛔ K.1.1 — las keys NO son campos de la respuesta.
      expect(res.body).not.toHaveProperty('ineFrontKey');
      expect(res.body).not.toHaveProperty('ineBackKey');
    });

    it('K-10 · con UNA sola key ⇒ 422 INE_NOT_ON_FILE y `details` dice cuál falta', async () => {
      await withIne(FRONT_KEY, null);
      const res = await h.api('GET', `/admin/users/${userId}/kyc/ine-links`, { token: adminToken });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INE_NOT_ON_FILE');
      expect(res.body.error.details).toEqual({ frontOnFile: true, backOnFile: false });
      await withIne();
    });

    it('404 con un usuario inexistente (no es un oráculo de existencia adicional)', async () => {
      const res = await h.api('GET', '/admin/users/00000000-0000-4000-8000-000000000000/kyc/ine-links', {
        token: adminToken,
      });
      expect(res.status).toBe(404);
    });
  });

  describe('K-2 · ninguna respuesta de admin lleva una object key', () => {
    it('`GET /admin/users` y `GET /admin/users/:id` con `super_admin` no matchean /kyc_ine\\//', async () => {
      await withIne();
      const list = await h.api('GET', '/admin/users?pageSize=100', { token: adminToken });
      expect(list.status).toBe(200);
      expect(list.text).not.toMatch(/kyc_ine\//);

      const detail = await h.api('GET', `/admin/users/${userId}`, { token: adminToken });
      expect(detail.status).toBe(200);
      expect(detail.text).not.toMatch(/kyc_ine\//);
      // La ficha sigue diciendo solo `ineOnFile`, y ahora además los campos del cotejo.
      expect(detail.body.kycProfile.ineOnFile).toBe(true);
      expect(detail.body).toHaveProperty('nameSource');
      expect(Array.isArray(detail.body.recentShipmentRecipients)).toBe(true);
    });
  });

  describe('K-4 · la bitácora contesta «¿quién miró esta identidad, y cuántas veces?»', () => {
    it('3 llamadas ⇒ 3 filas `user.kyc.reveal_ine` en `?scope=target`, sin URLs guardadas', async () => {
      await withIne();
      await h.prisma.auditLog.deleteMany({ where: { action: 'user.kyc.reveal_ine', entityId: userId } });
      for (let i = 0; i < 3; i++) {
        const res = await h.api('GET', `/admin/users/${userId}/kyc/ine-links`, { token: adminToken });
        expect(res.status).toBe(200);
      }
      const audit = await h.api('GET', `/admin/users/${userId}/audit?scope=target&pageSize=100`, {
        token: adminToken,
      });
      const reveals = (audit.body.data as { action: string; entityType: string; entityId: string }[]).filter(
        (r) => r.action === 'user.kyc.reveal_ine',
      );
      expect(reveals).toHaveLength(3);
      expect(reveals[0].entityType).toBe('User');
      expect(reveals[0].entityId).toBe(userId);

      // ⛔ Ni la URL firmada ni la key llegaron a la fila (se lee la BD, no la proyección).
      const rows = await h.prisma.auditLog.findMany({
        where: { action: 'user.kyc.reveal_ine', entityId: userId },
      });
      for (const row of rows) {
        const after = JSON.stringify(row.after);
        expect(after).toContain('front');
        expect(after).not.toContain('X-Amz-Signature');
        expect(after).not.toContain('kyc_ine/');
      }
    });
  });

  describe('K-5 / K-6 / K-7 · decidir con motivo, y que el cliente lo sepa', () => {
    it('K-5 · rechazar sin motivo ⇒ 422 KYC_REJECTION_REASON_REQUIRED; 2 y 501 chars ⇒ VALIDATION_ERROR', async () => {
      const sin = await h.api('PATCH', `/admin/users/${userId}/kyc`, {
        token: adminToken,
        json: { kycStatus: 'rejected' },
      });
      expect(sin.status).toBe(422);
      expect(sin.body.error.code).toBe('KYC_REJECTION_REASON_REQUIRED');
      expect(sin.body.error.details).toEqual({ field: 'rejectionReason' });

      for (const reason of ['no', 'x'.repeat(501)]) {
        const res = await h.api('PATCH', `/admin/users/${userId}/kyc`, {
          token: adminToken,
          json: { kycStatus: 'rejected', rejectionReason: reason },
        });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details).toMatchObject({ field: 'rejectionReason', min: 3, max: 500 });
      }

      // ⛔ Motivo SIN rechazar: tampoco se acepta en silencio.
      const sobra = await h.api('PATCH', `/admin/users/${userId}/kyc`, {
        token: adminToken,
        json: { kycStatus: 'verified', rejectionReason: 'un motivo que nadie pidió' },
      });
      expect(sobra.status).toBe(422);
      expect(sobra.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('K-6 · tras el rechazo, el CLIENTE lee el motivo exacto en `GET /users/me/kyc`', async () => {
      const motivo = 'No se alcanza a leer el reverso: la foto está cortada.';
      const patch = await h.api('PATCH', `/admin/users/${userId}/kyc`, {
        token: adminToken,
        json: { kycStatus: 'rejected', rejectionReason: `  ${motivo}  ` },
      });
      expect(patch.status).toBe(200);
      expect(patch.body.rejectionReason).toBe(motivo);

      const mine = await h.api('GET', '/users/me/kyc', { token: customerToken });
      expect(mine.status).toBe(200);
      expect(mine.body.kycStatus).toBe('rejected');
      expect(mine.body.rejectionReason).toBe(motivo);
    });

    it('K-8 · el cliente NO recibe ningún dial de política, con ningún nombre', async () => {
      const mine = await h.api('GET', '/users/me/kyc', { token: customerToken });
      for (const prohibido of [
        'ineThresholdCents',
        'thresholdCents',
        'capPerRequestCents',
        'capPerMonthCents',
        'monthUsedCents',
      ]) {
        expect(mine.body).not.toHaveProperty(prohibido);
      }
    });

    it('§M6-K.5 · `?quotedTotalCents=N` devuelve un VEREDICTO y nunca la cifra del umbral', async () => {
      const alto = await h.api('GET', '/users/me/kyc?quotedTotalCents=99999900', { token: customerToken });
      expect(alto.status).toBe(200);
      expect(alto.body.ineRequiredForTotal).toBe(true);
      const bajo = await h.api('GET', '/users/me/kyc?quotedTotalCents=1', { token: customerToken });
      expect(bajo.body.ineRequiredForTotal).toBe(false);
      expect(JSON.stringify(bajo.body)).not.toMatch(/\b300000\b/);

      const malo = await h.api('GET', '/users/me/kyc?quotedTotalCents=abc', { token: customerToken });
      expect(malo.status).toBe(422);
      expect(malo.body.error.details).toEqual({ field: 'quotedTotalCents' });
    });

    it('K-7 · re-subir devuelve a `pending` y limpia el motivo; un `PUT` solo-CLABE NO toca `kycStatus`', async () => {
      // Se parte de `verified` (el caso que el defecto A6 rompía).
      const verificado = await h.api('PATCH', `/admin/users/${userId}/kyc`, {
        token: adminToken,
        json: { kycStatus: 'verified' },
      });
      expect(verificado.status).toBe(200);
      expect(verificado.body).not.toHaveProperty('rejectionReason');

      // (a) Solo CLABE ⇒ el estado NO se mueve. Cambiar la cuenta de banco no es cambiar de cara.
      const soloClabe = await h.api('PUT', '/users/me/kyc', {
        token: customerToken,
        json: { clabe: '012345678901234599' },
      });
      expect(soloClabe.status).toBe(200);
      expect(soloClabe.body.kycStatus).toBe('verified');
      expect(soloClabe.body.clabeOnFile).toBe(true);

      // (b) Con keys de INE ⇒ vuelve a `pending` y el motivo anterior queda limpio en la columna.
      const conIne = await h.api('PUT', '/users/me/kyc', {
        token: customerToken,
        json: { ineFrontUploadKey: 'kyc_ine/2026-09-11/nuevo-front.png', ineBackUploadKey: BACK_KEY },
      });
      expect(conIne.status).toBe(200);
      expect(conIne.body.kycStatus).toBe('pending');
      expect(conIne.body).not.toHaveProperty('rejectionReason');
      const row = await h.prisma.kycProfile.findUnique({ where: { userId } });
      expect(row!.rejectionReason).toBeNull();
      expect(row!.reviewedAt).toBeNull();
      expect(row!.ineFrontKey).toBe('kyc_ine/2026-09-11/nuevo-front.png');
    });
  });
});
