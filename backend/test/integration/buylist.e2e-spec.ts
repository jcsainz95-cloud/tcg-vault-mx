/**
 * buylist.e2e-spec.ts — Integración/E2E contra Postgres real.
 * Cubre: cotizador público por RAREZA (v1.3.1: fixed/pct/fallback/precio pendiente), topes por
 * solicitud, INE sobre el tope, CLABE a nombre propio, pipeline cherry-pick +
 * conversión a inventario, y pago SPEI (money-out solo super_admin).
 * API_CONTRACT §6, §M5; ARCHITECTURE §4.2; PROJECT criterios 12–16, 26.
 *
 * ⚠ v2.0 (P-48, ARCHITECTURE §4.36): el cotizador devuelve `rarity` (INFORMATIVO) + **`priceBasis`**;
 * `appliedRule` se RETIRÓ (ya no hay `{mode,value}`: no hay reglas, hay CURVA). El monto **no depende
 * de la rareza ni del acabado** (criterio 84): sale de `max(bin, mercado × pct(mercado))` con el seed
 * de §N.2 (30 % hasta $25 → 40 % en $100 → 50 % en $500, plano de ahí). Y **sin dato de mercado la
 * línea queda `precio_pendiente`: el BIN NO gana** (§4.36.0).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

const CLABE_A = '012345678901234567';
const CLABE_B = '111122223333444455';

describe('E2E — Buylist (cotizador + pipeline + pago SPEI)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let customer2Token: string;
  let operatorToken: string;
  let adminToken: string;
  const cardId: Record<string, string> = {};

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    customer2Token = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    for (const [key, c] of Object.entries(E2E_CARDS)) {
      const card = await h.prisma.card.findUnique({ where: { externalId: c.externalId } });
      cardId[key] = card!.id;
    }
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('cotizador público (por rareza)', () => {
    it('el monto sale de la CURVA sobre el mercado: ni la rareza ni el acabado lo cambian (criterios 83/84)', async () => {
      // Common, mercado $50 ⇒ pct interpolado 33.33 % ⇒ $16.67.
      const comun = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.common, productType: 'raw', rawCondition: 'NM' },
      });
      expect(comun.body.rarity).toBe('Common'); // dato de DISPLAY; no entra al monto
      expect(comun.body.priceBasis).toBe('market');
      expect(comun.body.appliedRule).toBeUndefined(); // RETIRADO en v2.0
      expect(comun.body.quote.quotedPriceCents).toBe(1667);

      // Reverse Holo, mercado $30 ⇒ 30.67 % ⇒ $9.20. El acabado ya NO tiene regla propia.
      const reverse = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.reverse, productType: 'raw', rawCondition: 'NM' },
      });
      expect(reverse.body.quote.quotedPriceCents).toBe(920);

      // Rare Holo, mercado $1,000 ⇒ 50 % (tramo plano final) ⇒ $500.
      const rareHolo = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' },
      });
      expect(rareHolo.body.priceBasis).toBe('market');
      expect(rareHolo.body.quote.quotedPriceCents).toBe(E2E_CARDS.charizard.refNmCents / 2);
      expect(rareHolo.body.paymentNotice).toBe('PAY_AFTER_RECEIPT');
    });

    it('SIN referencia de mercado entra a "precio pendiente": el BIN no gana (§4.36.0)', async () => {
      const res = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.nopref, productType: 'raw', rawCondition: 'NM' },
      });
      expect(res.body.priceBasis).toBe('pending');
      expect(res.body.quote.status).toBe('precio_pendiente');
      expect(res.body.quote.quotedPriceCents).toBeNull();
    });
  });

  describe('creación de solicitud: topes / INE / CLABE', () => {
    it('crea una solicitud válida', async () => {
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: {
          items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
          clabe: CLABE_A,
        },
      });
      expect(res.status).toBe(201);
      expect(res.body.quotedTotalCents).toBe(E2E_CARDS.charizard.refNmCents / 2); // 50 % de $1,000
      expect(res.body.ineRequired).toBe(false);
    });

    it('bloquea si supera el tope por solicitud (BUYLIST_LIMIT_EXCEEDED)', async () => {
      // v2.0: la CURVA paga 50 % de $1,000 = $500/carta; 7 × 50000 = 350000 > 300000 (cap por solicitud).
      const items = Array.from({ length: 7 }, () => ({
        cardId: cardId.charizard,
        productType: 'raw' as const,
        rawCondition: 'NM' as const,
      }));
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: { items, clabe: CLABE_A },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUYLIST_LIMIT_EXCEEDED');
      expect(res.body.error.details.scope).toBe('per_request');
    });

    it('exige INE cuando la cotización alcanza el umbral (INE_REQUIRED)', async () => {
      // v2.0: highvalue, mercado $6,000 ⇒ 50 % = 300000 = EXACTAMENTE el umbral INE (y el cap, que
      // usa `>`, así que el empate lo pasa y sí llega al gate de INE). Sin INE → bloqueo.
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: {
          items: [{ cardId: cardId.highvalue, productType: 'raw', rawCondition: 'NM' }],
          clabe: CLABE_A,
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INE_REQUIRED');
    });

    it('rechaza CLABE que no coincide con la del propio usuario (CLABE_NOT_OWN_NAME)', async () => {
      // customer2: primera solicitud fija su CLABE; una CLABE distinta luego se rechaza.
      const first = await h.api('POST', '/buylist/requests', {
        token: customer2Token,
        json: {
          items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
          clabe: CLABE_A,
        },
      });
      expect(first.status).toBe(201);

      const second = await h.api('POST', '/buylist/requests', {
        token: customer2Token,
        json: {
          items: [{ cardId: cardId.reverse, productType: 'raw', rawCondition: 'NM' }],
          clabe: CLABE_B,
        },
      });
      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe('CLABE_NOT_OWN_NAME');
    });
  });

  describe('pipeline admin: recepción → verificación → cherry-pick → inventario → pago SPEI', () => {
    let sellRequestId: string;
    let itemId: string;

    it('el cliente crea la solicitud a procesar', async () => {
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: {
          items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
          clabe: CLABE_A,
        },
      });
      expect(res.status).toBe(201);
      sellRequestId = res.body.sellRequestId;
    });

    it('el operador recibe y verifica (hasta verificación)', async () => {
      const recv = await h.api('POST', `/admin/buylist/${sellRequestId}/receive`, { token: operatorToken });
      expect(recv.status).toBe(201);
      const ver = await h.api('POST', `/admin/buylist/${sellRequestId}/verify`, { token: operatorToken });
      expect(ver.status).toBe(201);
      const req = await h.prisma.sellRequest.findUnique({ where: { id: sellRequestId } });
      expect(req!.status).toBe('verificacion');
      expect(req!.verifiedAt).not.toBeNull();

      const detail = await h.api('GET', `/admin/buylist/${sellRequestId}`, { token: operatorToken });
      itemId = detail.body.items[0].id;
    });

    it('cherry-pick: aprueba una carta y la convierte a inventario en un clic', async () => {
      const decision = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'approve' },
      });
      expect(decision.status).toBe(200);

      const convert = await h.api('POST', `/admin/buylist/items/${itemId}/convert-to-inventory`, {
        token: operatorToken,
      });
      expect(convert.status).toBe(201);
      expect(typeof convert.body.inventoryItemId).toBe('string');
      const created = await h.prisma.inventoryItem.findUnique({ where: { id: convert.body.inventoryItemId } });
      expect(created!.acquisitionType).toBe('buylist');
    });

    it('pago SPEI: bloqueado al operador (MONEY_OUT_FORBIDDEN), permitido al super_admin', async () => {
      const blocked = await h.api('POST', `/admin/buylist/${sellRequestId}/pay-spei`, {
        token: operatorToken,
        json: { speiReference: 'SPEI-TEST-1' },
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('MONEY_OUT_FORBIDDEN');

      const paid = await h.api('POST', `/admin/buylist/${sellRequestId}/pay-spei`, {
        token: adminToken,
        json: { speiReference: 'SPEI-TEST-1' },
      });
      expect(paid.status).toBe(201);
      const req = await h.prisma.sellRequest.findUnique({ where: { id: sellRequestId } });
      expect(req!.status).toBe('pagada');
      expect(req!.speiReference).toBe('SPEI-TEST-1');
    });
  });
});
