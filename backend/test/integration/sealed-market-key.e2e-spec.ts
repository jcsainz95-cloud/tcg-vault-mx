/**
 * sealed-market-key.e2e-spec.ts — P-83 (API_CONTRACT §M2-SK, v1.70) contra Postgres REAL y por HTTP.
 *
 * **`'sealed'` es una clave de COLA, nunca una clave de PRECIO.** Dos normas con código:
 *
 *  - **SK-3** — `POST /admin/pricing/override` con `productType:"sealed"` + `gradeKey:"sealed"` ⇒
 *    **`422 SEALED_MARKET_KEY_REQUIRED`**, `details { gradeKey:"sealed", remedy:"map_or_price_the_piece" }`,
 *    y **ninguna fila de dinero escrita**. Se mide por HTTP porque el `422` lo decide el borde y el sobre
 *    de error (`error.code`/`error.details`) lo pone el filtro global: el unitario no ve ninguno de los dos.
 *  - **SK-2** — `GET /admin/finance/inventory-value` ya **no cae a `'sealed'`**: una pieza sellada sin
 *    clave de mercado cuenta en `pendingPriceCount` aunque exista una fila legada bajo `'sealed'`, y una
 *    pieza MAPEADA sin referencia bajo su `sealed:tcg:<id>` tampoco hereda la legada.
 *
 * Se mide por DELTA (antes/después de sembrar las piezas del caso) para no depender del resto del seed.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

type Bucket = { atReferenceCents: number; atCostCents: number; pieceCount: number; pendingPriceCount: number };
type InventoryValue = Bucket & { breakdown: { raw: Bucket; sealed: Bucket; graded: Bucket } };

const FOLIO_UNMAPPED = 'P83-SEALED-UNMAPPED';
const FOLIO_MAPPED_NOREF = 'P83-SEALED-MAPPED-NOREF';
const FOLIO_MAPPED_REF = 'P83-SEALED-MAPPED-REF';
const FOLIOS = [FOLIO_UNMAPPED, FOLIO_MAPPED_NOREF, FOLIO_MAPPED_REF];
// productIds reservados para este spec (no los usa el seed).
const PID_NOREF = 983_001;
const PID_REF = 983_002;
const LEGACY_CENTS = 80_000; // la fila legada bajo 'sealed' — ⛔ no debe sumar NUNCA
const MARKET_CENTS = 7_000; // la referencia bajo sealed:tcg:PID_REF — sí suma

describe('E2E — P-83 §M2-SK: `sealed` es clave de COLA, no de PRECIO', () => {
  let h: E2EHarness;
  let admin: string;
  let cardId: string;

  const cleanup = async () => {
    await h.prisma.inventoryItem.deleteMany({ where: { folio: { in: FOLIOS } } });
    await h.prisma.priceReference.deleteMany({
      where: {
        cardId,
        productType: 'sealed',
        gradeKey: { in: ['sealed', `sealed:tcg:${PID_NOREF}`, `sealed:tcg:${PID_REF}`] },
      },
    });
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findFirstOrThrow({ where: { externalId: E2E_CARDS.nopref.externalId } });
    cardId = card.id;
    await cleanup();
  }, 180000);

  afterAll(async () => {
    if (h) {
      if (cardId) await cleanup();
      await h.close();
    }
  });

  describe('SK-3 — el override de mercado exige clave de mercado', () => {
    it("`productType:'sealed'` + `gradeKey:'sealed'` ⇒ 422 SEALED_MARKET_KEY_REQUIRED y CERO filas escritas", async () => {
      const before = await h.prisma.priceReference.count({ where: { cardId, productType: 'sealed' } });
      const res = await h.api('POST', '/admin/pricing/override', {
        token: admin,
        json: { cardId, productType: 'sealed', gradeKey: 'sealed', priceMxnCents: 150_000, finish: 'normal' },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEALED_MARKET_KEY_REQUIRED');
      expect(res.body.error.details).toEqual({ gradeKey: 'sealed', remedy: 'map_or_price_the_piece' });
      // Lo que importa: la tabla de dinero NO se tocó.
      expect(await h.prisma.priceReference.count({ where: { cardId, productType: 'sealed' } })).toBe(before);
    });

    it("CONTROL: con clave de mercado (`sealed:tcg:<id>`) el override sigue respondiendo 200 y escribe", async () => {
      const res = await h.api('POST', '/admin/pricing/override', {
        token: admin,
        json: { cardId, productType: 'sealed', gradeKey: `sealed:tcg:${PID_REF}`, priceMxnCents: 123_400, finish: 'normal' },
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ priceMxnCents: 123_400, gradeKey: `sealed:tcg:${PID_REF}` });
      await h.prisma.priceReference.deleteMany({
        where: { cardId, productType: 'sealed', gradeKey: `sealed:tcg:${PID_REF}` },
      });
    });
  });

  describe('SK-2 — la valuación del inventario no cae a `sealed`', () => {
    async function inventoryValue(): Promise<InventoryValue> {
      const res = await h.api('GET', '/admin/finance/inventory-value', { token: admin });
      expect(res.status).toBe(200);
      return res.body as InventoryValue;
    }

    it('sellado sin clave de mercado (o sin referencia bajo ella) ⇒ PENDIENTE; la fila legada no suma', async () => {
      const before = await inventoryValue();

      const today = new Date(new Date().toISOString().slice(0, 10));
      // La fila legada bajo 'sealed' — escrita a mano, como la dejaban las versiones previas a v1.70.
      await h.prisma.priceReference.create({
        data: {
          cardId, productType: 'sealed', gradeKey: 'sealed', finish: 'normal', source: 'manual',
          priceMxnCents: LEGACY_CENTS, capturedDate: today, isManualOverride: true,
        },
      });
      await h.prisma.priceReference.create({
        data: {
          cardId, productType: 'sealed', gradeKey: `sealed:tcg:${PID_REF}`, finish: 'normal', source: 'manual',
          priceMxnCents: MARKET_CENTS, capturedDate: today, isManualOverride: true,
        },
      });
      const base = {
        cardId, productType: 'sealed' as const, sealedSubtype: 'box' as const, sealedCondition: 'mint' as const,
        sealedProductName: 'P83 Caja', ownerType: 'platform' as const, status: 'in_stock' as const,
        acquisitionType: 'compra' as const, acquisitionCostCents: 0,
      };
      await h.prisma.inventoryItem.create({ data: { ...base, folio: FOLIO_UNMAPPED } });
      await h.prisma.inventoryItem.create({ data: { ...base, folio: FOLIO_MAPPED_NOREF, tcgplayerProductId: PID_NOREF } });
      await h.prisma.inventoryItem.create({ data: { ...base, folio: FOLIO_MAPPED_REF, tcgplayerProductId: PID_REF } });

      const after = await inventoryValue();
      const d = (k: keyof Bucket) => after.breakdown.sealed[k] - before.breakdown.sealed[k];
      expect(d('pieceCount')).toBe(3);
      // Solo la mapeada CON referencia bajo su propia clave suma; la legada (80 000 × 2) jamás.
      expect(d('atReferenceCents')).toBe(MARKET_CENTS);
      expect(d('pendingPriceCount')).toBe(2);
      // Top-level = Σ breakdown (invariante del contrato), también en el delta.
      expect(after.atReferenceCents - before.atReferenceCents).toBe(MARKET_CENTS);
      expect(after.pendingPriceCount - before.pendingPriceCount).toBe(2);
    });
  });
});
