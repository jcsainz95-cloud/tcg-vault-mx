/**
 * `buylist-step-guard.e2e-spec.ts` — **INVARIANTE S (API_CONTRACT §M5-S, v1.68) CONTRA POSTGRES REAL.**
 * Propiedad: backend. Cierre de P-58; ARCHITECTURE §4.48.1 y §4.48.9.
 *
 * `receive` solo desde `en_transito` (idempotente en `recibida`); `verify` solo desde `recibida`
 * (idempotente en `verificacion`). Otro estado **vivo** ⇒ `409 INVALID_TRANSITION` con
 * `details: { verb, from, allowedFrom, idempotentOn }`. Terminal ∨ `closedAt ≠ null` ⇒ `409 CONFLICT`
 * (§M5-T gana). **Cero escritura** en los dos rechazos.
 *
 * ### Por qué vive aquí además de en `buylist.m5s-step-guard.spec.ts`
 * La guarda **es** el `where` del `updateMany`; lo que distingue el código arreglado del roto es el
 * motor. El unitario prueba la FORMA de la guarda con un fake que evalúa el `where`; esto prueba la
 * CONDUCTA del sistema por HTTP (guards, `ValidationPipe`, filtro de excepciones, Postgres).
 *
 * ### Norma de esta carpeta
 * El ESTADO se puede montar por `h.prisma` (S-1 siembra los once `SellRequestStatus` sobre una fila
 * real, porque la API no fabrica terminales a voluntad); la CONDUCTA se prueba por la puerta. S-2 va
 * entera por HTTP (`offer → offer-response → confirm-shipment → receive → verify`).
 *
 * ### Candados (§M5-S)
 * | Mutación | Cae |
 * |---|---|
 * | **m5**: volver a `liveRequestWhere()` (o quitar el término de estado) | S-1: 5 filas por verbo pasan a `200` |
 * | «arreglar» la cadena permitiendo `verify` desde `en_transito` | S-2 invertida (`409` ⇒ `200`, `verifiedAt` sellado) |
 * | quitar `closedAt: null` | S-1: la fila de P1 responde `INVALID_TRANSITION` en vez de `CONFLICT` |
 */
import { SellRequestStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { SELL_REQUEST_TERMINAL_STATES } from '../../src/common/sell-request-states';

const CLABE_A = '012345678901234567';
const TERMINAL = SELL_REQUEST_TERMINAL_STATES as readonly SellRequestStatus[];
const ALL = Object.values(SellRequestStatus);
const LIVE = ALL.filter((s) => !TERMINAL.includes(s));

const STEPS = {
  receive: { allowedFrom: ['en_transito'], idempotentOn: 'recibida', fecha: 'receivedAt' },
  verify: { allowedFrom: ['recibida'], idempotentOn: 'verificacion', fecha: 'verifiedAt' },
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('E2E — §M5-S · `receive`/`verify` exigen el PASO CORRECTO (P-58)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let charizardId: string;
  let addressId: string;

  function createRequest() {
    return h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: charizardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_A,
        addressId,
      },
    });
  }

  /** Lleva una solicitud recién creada hasta `en_transito` POR LA PUERTA (pasos 2-4 del pacto). */
  async function hastaEnTransito(): Promise<string> {
    const created = await createRequest();
    expect(created.status).toBe(201);
    const srId = created.body.sellRequestId as string;
    const item = await h.prisma.sellRequestItem.findFirst({ where: { sellRequestId: srId } });
    const offer = await h.api('POST', `/admin/buylist/${srId}/offer`, {
      token: operatorToken,
      json: { lines: [{ itemId: item!.id, decision: 'buy' }] },
    });
    expect(offer.status).toBe(200);
    const accept = await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
      token: customerToken,
      json: { decision: 'accept' },
    });
    expect(accept.status).toBe(200);
    // Sin guía, a propósito: `confirm-shipment` no la exige (`guideMissing` en bitácora).
    const shipped = await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, {
      token: operatorToken,
      json: {},
    });
    expect(shipped.status).toBe(200);
    const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(row!.status).toBe('en_transito');
    return srId;
  }

  const verb = (v: 'receive' | 'verify', srId: string) =>
    h.api('POST', `/admin/buylist/${srId}/${v}`, { token: operatorToken });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    charizardId = card!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    const addr = await h.prisma.address.findFirst({ where: { userId: u!.id } });
    addressId = addr!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  // ===========================================================================================
  // S-1 — LA MATRIZ 11 × 2, sobre una fila REAL cuyo estado se siembra por `h.prisma`
  // ===========================================================================================
  describe('S-1 · la matriz 11 × 2 (más la fila de P1)', () => {
    const CERRADO = new Date('2026-09-05T00:00:00Z');
    const SELLADA = new Date('2026-09-02T00:00:00Z');
    let srId: string;

    beforeAll(async () => {
      const created = await createRequest();
      expect(created.status).toBe(201);
      srId = created.body.sellRequestId;
    });

    /** Deja la fila en `status`, viva o cerrada, con las fechas que se pidan. */
    async function siembra(status: SellRequestStatus, over: Record<string, unknown> = {}) {
      await h.prisma.sellRequest.update({
        where: { id: srId },
        data: {
          status,
          closedAt: TERMINAL.includes(status) ? CERRADO : null,
          receivedAt: null,
          verifiedAt: null,
          ...over,
        },
      });
      await h.prisma.sellRequestItem.updateMany({
        where: { sellRequestId: srId },
        data: { itemStatus: 'cotizada' },
      });
    }

    it('el enum sigue teniendo ONCE estados (7 vivos + 4 terminales): la matriz los cubre todos', () => {
      expect(ALL).toHaveLength(11);
      expect(LIVE).toHaveLength(7);
      expect(TERMINAL).toHaveLength(4);
    });

    for (const v of ['receive', 'verify'] as const) {
      const step = STEPS[v];
      describe(`${v}`, () => {
        it.each(step.allowedFrom.map((s) => [s]))(
          'desde `%s` ⇒ 200, transiciona y sella la fecha (y mueve los ítems)',
          async (from) => {
            await siembra(from);
            const res = await verb(v, srId);
            expect(res.status).toBe(200);
            expect(res.body.status).toBe(step.idempotentOn);
            const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
            expect(row!.status).toBe(step.idempotentOn);
            expect(row![step.fecha]).toBeInstanceOf(Date);
          },
        );

        it(`desde \`${step.idempotentOn}\` ⇒ 200 idempotente y ⛔ NO re-sella \`${step.fecha}\``, async () => {
          await siembra(step.idempotentOn, { [step.fecha]: SELLADA });
          const res = await verb(v, srId);
          expect(res.status).toBe(200);
          expect(res.body.status).toBe(step.idempotentOn);
          const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
          expect(row![step.fecha]).toEqual(SELLADA);
        });

        const otrosVivos = LIVE.filter(
          (s) => !(step.allowedFrom as readonly string[]).includes(s) && s !== step.idempotentOn,
        );
        it.each(otrosVivos.map((s) => [s]))(
          'desde el VIVO `%s` ⇒ 409 INVALID_TRANSITION con el `details` normativo y CERO escritura',
          async (from) => {
            await siembra(from);
            const res = await verb(v, srId);
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('INVALID_TRANSITION');
            expect(res.body.error.details).toEqual({
              verb: v,
              from,
              allowedFrom: [...step.allowedFrom],
              idempotentOn: step.idempotentOn,
            });
            const despues = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
            expect(despues!.status).toBe(from);
            expect(despues![step.fecha]).toBeNull();
            expect(despues!.closedAt).toBeNull();
            const items = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: srId } });
            expect(items.every((i) => i.itemStatus === 'cotizada')).toBe(true);
          },
        );

        it.each(TERMINAL.map((s) => [s]))(
          'desde el terminal `%s` ⇒ 409 CONFLICT { status, closedAt } (§M5-T gana), no INVALID_TRANSITION',
          async (from) => {
            await siembra(from);
            const res = await verb(v, srId);
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CONFLICT');
            expect(res.body.error.details.status).toBe(from);
            expect(new Date(res.body.error.details.closedAt)).toEqual(CERRADO);
            const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
            expect(row!.status).toBe(from);
            expect(row![step.fecha]).toBeNull();
          },
        );

        it('⚠️ la fila de P1 (`verificacion` con `closedAt` sellado) ⇒ 409 CONFLICT, no INVALID_TRANSITION', async () => {
          await siembra('verificacion', { closedAt: CERRADO, receivedAt: SELLADA, verifiedAt: SELLADA });
          const res = await verb(v, srId);
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('CONFLICT');
          expect(res.body.error.details.status).toBe('verificacion');
          expect(new Date(res.body.error.details.closedAt)).toEqual(CERRADO);
          const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
          expect(row!.status).toBe('verificacion');
          expect(row!.receivedAt).toEqual(SELLADA);
          expect(row!.verifiedAt).toEqual(SELLADA);
        });
      });
    }
  });

  // ===========================================================================================
  // S-2 — LA CADENA DE LA MESA (directa) SIGUE; LA INVERTIDA SE CORTA. Todo por la puerta.
  // ===========================================================================================
  describe('S-2 · la cadena `confirm-shipment → receive → verify` con 20 ms', () => {
    it('directa: `200 · 200 · 200`, estado final `verificacion` con LAS DOS fechas', async () => {
      const srId = await hastaEnTransito();
      const rec = await verb('receive', srId);
      await sleep(20);
      const ver = await verb('verify', srId);
      expect(rec.status).toBe(200);
      expect(ver.status).toBe(200);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('verificacion');
      expect(row!.receivedAt).toBeInstanceOf(Date);
      expect(row!.verifiedAt).toBeInstanceOf(Date);
    });

    it('directa SIN esperar la respuesta (lanzadas con 20 ms de desfase, como la bitácora): 5/5 en verde', async () => {
      // O-3: una tirada no verifica nada que dependa del orden. Se lanza `verify` 20 ms después de
      // `receive` SIN esperar a que `receive` conteste; Postgres serializa los dos `UPDATE` sobre la
      // fila y el `where` de `verify` se re-evalúa sobre la versión que `receive` dejó. Se reporta
      // la proporción, no un «funcionó».
      const resultados: string[] = [];
      for (let i = 0; i < 5; i++) {
        const srId = await hastaEnTransito();
        const pRec = verb('receive', srId);
        await sleep(20);
        const pVer = verb('verify', srId);
        const [rec, ver] = await Promise.all([pRec, pVer]);
        const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        resultados.push(`${rec.status}·${ver.status}·${row!.status}`);
      }
      expect(resultados).toEqual(Array(5).fill('200·200·verificacion'));
    });

    it('invertida: `confirm-shipment → verify → receive` ⇒ `200 · 409 INVALID_TRANSITION · 200`, final `recibida` SIN `verifiedAt`', async () => {
      // Hasta v1.67 esta cadena terminaba en `recibida` con `verifiedAt` sellado — un estado que
      // ningún paso del pacto produce y que `isPayable` (`receivedAt ∧ verifiedAt`) leía como legítimo.
      const srId = await hastaEnTransito();
      const ver = await verb('verify', srId);
      await sleep(20);
      const rec = await verb('receive', srId);
      expect(ver.status).toBe(409);
      expect(ver.body.error.code).toBe('INVALID_TRANSITION');
      expect(ver.body.error.details).toEqual({
        verb: 'verify',
        from: 'en_transito',
        allowedFrom: ['recibida'],
        idempotentOn: 'verificacion',
      });
      expect(rec.status).toBe(200);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('recibida');
      expect(row!.receivedAt).toBeInstanceOf(Date);
      expect(row!.verifiedAt).toBeNull();
    });

    it('el paquete que llega sin `confirm-shipment`: `receive` desde `aceptada` ⇒ 409, y tras el clic ⇒ 200', async () => {
      const created = await createRequest();
      const srId = created.body.sellRequestId as string;
      const item = await h.prisma.sellRequestItem.findFirst({ where: { sellRequestId: srId } });
      await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operatorToken,
        json: { lines: [{ itemId: item!.id, decision: 'buy' }] },
      });
      await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
        token: customerToken,
        json: { decision: 'accept' },
      });
      // El vendedor dice «ya lo mandé»: NO mueve el estado (criterio 138). Sigue `aceptada`.
      await h.api('POST', `/buylist/requests/${srId}/declare-shipped`, { token: customerToken });
      const temprano = await verb('receive', srId);
      expect(temprano.status).toBe(409);
      expect(temprano.body.error.code).toBe('INVALID_TRANSITION');
      expect(temprano.body.error.details.from).toBe('aceptada');
      // No es un agujero: es un clic — y deja `shipmentConfirmedAt` registrado, que antes se perdía.
      const shipped = await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, {
        token: operatorToken,
        json: {},
      });
      expect(shipped.status).toBe(200);
      const rec = await verb('receive', srId);
      expect(rec.status).toBe(200);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('recibida');
      expect(row!.shipmentConfirmedAt).toBeInstanceOf(Date);
    });
  });
});
