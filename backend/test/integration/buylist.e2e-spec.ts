/**
 * buylist.e2e-spec.ts — Integración/E2E contra Postgres real.
 * Cubre: cotizador público por RAREZA (v1.3.1: fixed/pct/fallback/precio pendiente), topes por
 * solicitud, INE sobre el tope, CLABE a nombre propio, pipeline cherry-pick +
 * conversión a inventario, y pago SPEI (money-out solo super_admin).
 * API_CONTRACT §6, §M5; ARCHITECTURE §4.2; PROJECT criterios 12–16, 26.
 *
 * v1.3.1 / v1.37 (P-34, M-38): el cotizador devuelve `rarity` + `appliedRule` (en vez de `category`).
 * Con el seed TIERED por defecto (`pricing_tier_map` + `tierRules`): Common (T0) = fixed 50c, Reverse
 * Holo (acabado) = fixed 150c, Rare/Rare Holo (T2) = **pct 25%** (decisión LOCKED P-34, antes fallback
 * 40%), y una rareza SIN tier en el mapa (p. ej. Rare Secret) cae al fallback 40% de la referencia.
 * `POST /buylist/requests` ya no recibe `category` (el backend deriva la regla server-side de Card.rarity).
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
    it('Common = fixed 50, Reverse Holo = fixed 150, Rare Holo = 25% (T2, regla — P-34)', async () => {
      const comun = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.common, productType: 'raw', rawCondition: 'NM' },
      });
      expect(comun.body.rarity).toBe('Common');
      expect(comun.body.appliedRule).toMatchObject({ mode: 'fixed', value: 50, source: 'rule' });
      expect(comun.body.quote.quotedPriceCents).toBe(50);

      const reverse = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.reverse, productType: 'raw', rawCondition: 'NM' },
      });
      expect(reverse.body.appliedRule).toMatchObject({ mode: 'fixed', value: 150, source: 'rule' });
      expect(reverse.body.quote.quotedPriceCents).toBe(150);

      const rareHolo = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' },
      });
      // v1.37 (P-34): Rare Holo → T2 → pct 25% (regla derivada del tier, NO fallback). Antes fallback 40%.
      expect(rareHolo.body.appliedRule).toMatchObject({ mode: 'pct', value: 25, source: 'rule' });
      expect(rareHolo.body.quote.quotedPriceCents).toBe(Math.round(E2E_CARDS.charizard.refNmCents * 0.25));
      expect(rareHolo.body.paymentNotice).toBe('PAY_AFTER_RECEIPT');
    });

    it('rareza con regla pct pero SIN referencia entra a "precio pendiente" (no cotiza automático)', async () => {
      const res = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.nopref, productType: 'raw', rawCondition: 'NM' },
      });
      expect(res.body.appliedRule.mode).toBe('pct'); // fallback pct
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
      expect(res.body.quotedTotalCents).toBe(Math.round(E2E_CARDS.charizard.refNmCents * 0.25));
      expect(res.body.ineRequired).toBe(false);
    });

    it('bloquea si supera el tope por solicitud (BUYLIST_LIMIT_EXCEEDED)', async () => {
      // P-34: Rare Holo → T2 25% × 100000 = 25000/carta; 13 × 25000 = 325000 > 300000 (cap por solicitud).
      const items = Array.from({ length: 13 }, () => ({
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
      // highvalue Rare Holo → T2 25% × 1200000 = 300000 = umbral INE (P-34); sin INE → bloqueo.
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
