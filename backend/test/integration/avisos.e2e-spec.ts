import { KycStatus, SellOfferState, SellRequestStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

/**
 * # §R — LA CAMPANA Y EL CICLO DEL AVISO, CONTRA LA APP REAL Y POSTGRES REAL
 *
 * Cubre `C-AV-2` (por HTTP), `C-AV-6(c)`, `C-AV-7` (**las dos cláusulas**, la segunda **sembrada por
 * SQL** porque el intake no puede crearla) y `C-AV-8` (**byte a byte**, en las dos superficies).
 *
 * ## Por qué estos candados NO se cierran con la suite unitaria
 * - El **401 del invitado**, el **`no-store`** y la **ruta** (`/me/pendings`, no `/users/me/pendings`)
 *   dependen del guard y del prefijo **montados**: un `@Roles` bien escrito con un guard mal montado
 *   **se leen igual en el código**.
 * - La **cláusula (b)** del predicado es una consulta contra datos reales, y su caso interesante —la
 *   solicitud viva que exige INE y no lo tiene— **no existe en el mundo de los mocks porque nadie lo
 *   simula**: aquí se **siembra**, que es la única forma de crearlo (`API_CONTRACT §R.2.3`).
 * - `C-AV-8` exige comparar **la misma respuesta antes y después** de que exista una oferta en
 *   `pending_authorization`. Eso es un byte a byte sobre HTTP, no una aserción sobre un mock.
 *
 * ## ⭐ LA BANDEJA
 * El puerto de correo de la app (`NoopMailAdapter` en CI, sin `RESEND_API_KEY`) es un **singleton**:
 * se le espía `send` y **esa es la bandeja**. Es lo que permite contar **por exceso** — un correo de
 * más aparece aquí aunque nadie lo esperara.
 */

type PendingsBody = { pendings: { code: string; since: string }[] };

describe('§R — `GET /me/pendings` y el ciclo del aviso (E2E)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let adminToken: string;
  let customerId: string;
  let bandeja: MailMessage[];
  let spy: jest.SpyInstance;
  const sembradas: string[] = [];

  const pendings = (token?: string) =>
    h.api<PendingsBody>('GET', '/me/pendings', token ? { token } : {});

  const rechazar = (motivo: string) =>
    h.api('PATCH', `/admin/users/${customerId}/kyc`, {
      token: adminToken,
      json: { kycStatus: 'rejected', rejectionReason: motivo },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: E2E_USERS.customer.email },
      select: { id: true },
    });
    customerId = user.id;

    // La bandeja: el puerto real de la app, espiado.
    const port = h.app.get<MailPort>(MAIL_PORT);
    bandeja = [];
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (sembradas.length > 0) {
      await h.prisma.sellRequest.deleteMany({ where: { id: { in: sembradas } } });
    }
    // Se deja el expediente como estaba: sin decisión y sin sello.
    await h.prisma.kycProfile.updateMany({
      where: { userId: customerId },
      data: {
        kycStatus: KycStatus.none,
        rejectionReason: null,
        reviewedAt: null,
        reviewedBy: null,
        kycRejectionNoticeSentAt: null,
      },
    });
    await h?.close();
  });

  beforeEach(() => {
    bandeja.length = 0;
  });

  // ---------------------------------------------------------------- forma del endpoint
  describe('la forma del endpoint (§R.2.1)', () => {
    it('⛔ sin sesión ⇒ 401 (la campana NO aplica al invitado, y se declara)', async () => {
      const res = await pendings();
      expect(res.status).toBe(401);
    });

    it('con sesión y sin nada pendiente ⇒ 200 `{"pendings":[]}` + `Cache-Control: no-store`', async () => {
      await h.prisma.kycProfile.updateMany({
        where: { userId: customerId },
        data: { kycStatus: KycStatus.none, kycRejectionNoticeSentAt: null },
      });
      const res = await pendings(customerToken);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ pendings: [] }); // ⛔ ni 204 ni 404: vacío es la respuesta normal
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('⛔ un parámetro de query desconocido NO cambia la respuesta (no hay ejes que clasificar)', async () => {
      const a = await pendings(customerToken);
      const b = await h.api<PendingsBody>('GET', '/me/pendings?code=identity_action_required', {
        token: customerToken,
      });
      expect(b.status).toBe(200);
      expect(b.text).toBe(a.text);
    });

    it('⛔ el `GET` no escribe nada: el sello del aviso sigue como estaba', async () => {
      const antes = await h.prisma.kycProfile.findUnique({
        where: { userId: customerId },
        select: { kycRejectionNoticeSentAt: true, updatedAt: true },
      });
      await pendings(customerToken);
      const despues = await h.prisma.kycProfile.findUnique({
        where: { userId: customerId },
        select: { kycRejectionNoticeSentAt: true, updatedAt: true },
      });
      expect(despues).toEqual(antes);
      expect(bandeja).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- C-AV-2 + C-AV-7(a) + C-AV-6(c)
  describe('⭐⭐ C-AV-2 — un aviso por ciclo, y C-AV-7(a) — el predicado del rechazo', () => {
    it('(a) DOS rechazos seguidos sin resubida ⇒ UN correo, y el pendiente aparece UNA vez', async () => {
      const r1 = await rechazar('La foto está borrosa.');
      expect(r1.status).toBe(200);
      expect(bandeja).toHaveLength(1);
      expect(bandeja[0].to).toBe(E2E_USERS.customer.email);

      const p1 = await pendings(customerToken);
      expect(p1.body.pendings).toEqual([
        { code: 'identity_action_required', since: expect.any(String) },
      ]);

      const r2 = await rechazar('Falta el reverso de la INE.');
      expect(r2.status).toBe(200);
      expect(bandeja).toHaveLength(1); // ⛔ el segundo correo NO sale

      // (b) …y el motivo NUEVO sí le llega, por el portal.
      const kyc = await h.api<{ rejectionReason?: string }>('GET', '/users/me/kyc', {
        token: customerToken,
      });
      expect(kyc.body.rejectionReason).toBe('Falta el reverso de la INE.');

      // El pendiente sigue siendo UNO: la campana no acumula.
      const p2 = await pendings(customerToken);
      expect(p2.body.pendings).toHaveLength(1);
    });

    it('(c) tras RESUBIR, un rechazo nuevo SÍ manda el segundo correo', async () => {
      // La resubida real (`PUT /users/me/kyc`) exige un presign con permiso (`KycUploadGrant`), que
      // es otro flujo. Lo que §R.4.a norma es **el efecto**: el bloque que limpia el motivo limpia
      // también el sello. Se reproduce ese efecto y se mide lo que importa: que el ciclo REARRANCA.
      await h.prisma.kycProfile.updateMany({
        where: { userId: customerId },
        data: {
          kycStatus: KycStatus.pending,
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
          kycRejectionNoticeSentAt: null,
        },
      });
      // ⭐ C-AV-6(c): resuelto el pendiente, DESAPARECE — sin que nadie apague nada.
      const p = await pendings(customerToken);
      expect(p.body).toEqual({ pendings: [] });

      const r = await rechazar('Sigue sin leerse.');
      expect(r.status).toBe(200);
      expect(bandeja).toHaveLength(1); // ⇐ rojo con cero: el silencio permanente es el defecto peor
    });

    it('⛔ `verified` ⇒ cero correos, cero campana (pregunta 71: «no se manda nada»)', async () => {
      const res = await h.api('PATCH', `/admin/users/${customerId}/kyc`, {
        token: adminToken,
        json: { kycStatus: 'verified' },
      });
      expect(res.status).toBe(200);
      expect(bandeja).toHaveLength(0);
      const p = await pendings(customerToken);
      expect(p.body).toEqual({ pendings: [] });
    });

    it('⛔ `pending` y `none` tampoco encienden la campana (son decisión, no olvido)', async () => {
      for (const kycStatus of [KycStatus.pending, KycStatus.none]) {
        await h.prisma.kycProfile.updateMany({ where: { userId: customerId }, data: { kycStatus } });
        const p = await pendings(customerToken);
        expect({ kycStatus, body: p.body }).toEqual({ kycStatus, body: { pendings: [] } });
      }
    });
  });

  // ---------------------------------------------------------------- C-AV-7(b)
  describe('C-AV-7(b) — la cláusula de la solicitud viva, SEMBRADA (única forma de crearla)', () => {
    it('una `SellRequest` viva con `ineRequired ∧ ¬ineProvided` ⇒ UN pendiente', async () => {
      // ⚠️ El intake responde `422 INE_REQUIRED` en ese caso, así que esta fila **no se puede crear
      // por la API**. Se siembra a propósito: el predicado nombra **la obligación**, no la
      // alcanzabilidad de hoy. ⛔ QA no debe perseguirla por el camino del cotizador.
      const sr = await h.prisma.sellRequest.create({
        data: {
          userId: customerId,
          status: SellRequestStatus.cotizada,
          quotedTotalCents: 100000,
          ineRequired: true,
          ineProvided: false,
        },
        select: { id: true, createdAt: true },
      });
      sembradas.push(sr.id);

      const p = await pendings(customerToken);
      expect(p.body.pendings).toEqual([
        { code: 'identity_action_required', since: sr.createdAt.toISOString() },
      ]);
    });

    it('cerrada (`closedAt`) o terminal ⇒ el pendiente DESAPARECE', async () => {
      await h.prisma.sellRequest.updateMany({
        where: { id: { in: sembradas } },
        data: { status: SellRequestStatus.rechazada, closedAt: new Date() },
      });
      const p = await pendings(customerToken);
      expect(p.body).toEqual({ pendings: [] });
    });
  });

  // ---------------------------------------------------------------- C-AV-8
  describe('⭐⭐ C-AV-8 — la oferta PENDIENTE DE AUTORIZACIÓN no se filtra (criterio 204)', () => {
    it('con una oferta en `pending_authorization`: la respuesta es BYTE A BYTE la de antes', async () => {
      const antes = await pendings(customerToken);

      const sr = await h.prisma.sellRequest.create({
        data: {
          userId: customerId,
          status: SellRequestStatus.cotizada,
          quotedTotalCents: 500000,
          offerState: SellOfferState.pending_authorization,
          offerGrossCents: 500000,
          offerNetCents: 482000,
          offerShippingFeeCents: 18000,
        },
        select: { id: true },
      });
      sembradas.push(sr.id);

      const despues = await pendings(customerToken);
      expect(despues.status).toBe(antes.status);
      expect(despues.text).toBe(antes.text); // byte a byte
      // …y la BANDEJA, la otra superficie: CERO correos por existir esa oferta.
      expect(bandeja).toHaveLength(0);
    });
  });
});
