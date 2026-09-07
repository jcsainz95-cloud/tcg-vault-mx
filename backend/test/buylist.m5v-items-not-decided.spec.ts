/**
 * `buylist.m5v-items-not-decided.spec.ts` — **§M5-V / `BL-45`: los DOS términos, por unidad.**
 * Propiedad: backend. `API_CONTRACT` §M5-V (V-a, V-b, V.5, V.6), `ARCHITECTURE` §9 `BL-45`.
 *
 * ### Qué cubre esto y qué NO
 * El **comportamiento** de §M5-V vive en `test/integration/buylist-pay-verdicts.e2e-spec.ts`, contra
 * Postgres real y por HTTP — porque el defecto nace de **componer verbos**, y eso un mock no lo
 * fabrica. Aquí se fija lo que sí es unitario y **lo que un E2E no puede barrer sin pagar minutos**:
 * la **tabla de verdad del predicado** (con los estados de ítem uno por uno) y la **columna que suma
 * la tarjeta del tablero**, que es la mutación #11 de QA — la que sobrevivió a 3.873 pruebas.
 */
import { SellItemStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  SELL_ITEM_VERDICT_STATES,
  isPayableSellRequest,
  isPayableSellRequestWithItems,
  pendingBuyDecisionItemIds,
} from '../src/common/sell-request-states';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const CICLO = { offerSentAt: new Date('2026-08-01T00:00:00Z') };
const LEGACY = { offerSentAt: null };
const line = (id: string, offerDecision: 'buy' | 'skip' | null, itemStatus: SellItemStatus) => ({
  id,
  offerDecision,
  itemStatus,
});

// =================================================================================================
describe('§M5-V.0 — «línea COMPRADA sin veredicto»: la tabla de verdad, estado por estado', () => {
  const TODOS = Object.values(SellItemStatus);

  it('los VEREDICTOS son exactamente tres, y son los dos desenlaces de §P.5 más el sucesor', () => {
    // ⚠️ CLASE R: lo declara `PROJECT.md`, no el schema. `pagada` y `ajustada` son del enum y **no**
    // son veredictos; si alguien los mete aquí «por simetría», esto cae.
    expect([...SELL_ITEM_VERDICT_STATES]).toEqual(['aprobada', 'rechazada', 'convertida_inventario']);
  });

  it.each(TODOS)('línea `buy` en `%s`: pendiente ⇔ NO es veredicto', (itemStatus) => {
    const esVeredicto = (SELL_ITEM_VERDICT_STATES as readonly SellItemStatus[]).includes(itemStatus);
    expect(pendingBuyDecisionItemIds(CICLO, [line('i1', 'buy', itemStatus)])).toEqual(
      esVeredicto ? [] : ['i1'],
    );
  });

  it.each(TODOS)('⚠️ línea `skip` en `%s`: NUNCA pendiente — sin esto el cherry-pick es impagable', (itemStatus) => {
    // *La línea que no compramos no tiene veredicto de compra porque no hay nada que juzgar.* Al
    // ofertar, las `skip` conservan su `itemStatus` y **jamás pueden alcanzar `aprobada`**
    // (`422 ITEM_NOT_OFFERED`): un predicado «ninguna línea sin veredicto» a secas bloquearía **toda**
    // oferta con cherry-pick, que es el caso NORMAL del ciclo.
    expect(pendingBuyDecisionItemIds(CICLO, [line('i1', 'skip', itemStatus)])).toEqual([]);
  });

  it.each(TODOS)('línea pre-ciclo (`offerDecision = null`) en `%s`: tampoco cuenta', (itemStatus) => {
    expect(pendingBuyDecisionItemIds(CICLO, [line('i1', null, itemStatus)])).toEqual([]);
  });

  it('⛔ fuera del ciclo (`offerSentAt IS NULL`) SIEMPRE vacío, aunque la línea sea `buy` y esté cruda', () => {
    expect(pendingBuyDecisionItemIds(LEGACY, [line('i1', 'buy', 'cotizada')])).toEqual([]);
  });

  it('devuelve los ids EN ORDEN y sólo los pendientes (el `details` tiene que ser accionable)', () => {
    const items = [
      line('a', 'buy', 'aprobada'),
      line('b', 'buy', 'verificacion'),
      line('c', 'skip', 'verificacion'),
      line('d', 'buy', 'rechazada'),
      line('e', 'buy', 'recibida'),
    ];
    expect(pendingBuyDecisionItemIds(CICLO, items)).toEqual(['b', 'e']);
  });
});

// =================================================================================================
describe('§M5-V.5 — `isPayable` compone LOS DOS términos (la señal no puede mentirle al que paga)', () => {
  const base = {
    status: 'verificacion' as const,
    receivedAt: new Date(),
    verifiedAt: new Date(),
    approvedTotalCents: 50_000,
    ...CICLO,
  };

  it('con bruto aprobado y todas las `buy` juzgadas ⇒ true', () => {
    expect(isPayableSellRequestWithItems(base, [line('a', 'buy', 'aprobada'), line('b', 'skip', 'verificacion')])).toBe(true);
  });

  it('⚠️ una `buy` sin veredicto lo apaga AUNQUE V-a pase — es lo que distingue V-b de V-a', () => {
    // Si alguien implementa V-b como «approvedTotalCents IS NOT NULL» (o sea, lo mismo que V-a),
    // ESTA aserción se pone roja: aquí el bruto aprobado existe y aun así falta juzgar una carta.
    expect(isPayableSellRequest(base)).toBe(true);
    expect(isPayableSellRequestWithItems(base, [line('a', 'buy', 'aprobada'), line('b', 'buy', 'verificacion')])).toBe(false);
  });

  it('⚠️ sin bruto aprobado lo apaga AUNQUE todas las `buy` estén juzgadas — es el agujero de dinero', () => {
    // Rechazo total con cherry-pick: la única `buy` está `rechazada` (V-b pasa) y la `skip` impide la
    // auto-transición a `rechazada`. Lo único que cierra esto es **V-a**.
    const fila = { ...base, approvedTotalCents: null };
    expect(pendingBuyDecisionItemIds(fila, [line('a', 'buy', 'rechazada'), line('b', 'skip', 'verificacion')])).toEqual([]);
    expect(isPayableSellRequestWithItems(fila, [line('a', 'buy', 'rechazada'), line('b', 'skip', 'verificacion')])).toBe(false);
  });

  it('⛔ un bruto aprobado de CERO SIGUE siendo pagable (depósito de cero, D40 / criterio 140)', () => {
    // *`null` = «nadie decidió nada»; `0` = «se decidió y salió cero».* Escribir `> 0` en V-a rompe
    // esta línea, y con ella una norma de producto explícita.
    expect(isPayableSellRequestWithItems({ ...base, approvedTotalCents: 0 }, [line('a', 'buy', 'rechazada')])).toBe(true);
  });
});

// =================================================================================================
describe('⚠️⚠️ §11 / §M5-V.8(7) — la tarjeta del tablero SUMA `approvedTotalCents`. MUTACIÓN #11 DE QA', () => {
  /**
   * La mutación que sobrevivió a **3.873 pruebas** es *«cambiar la columna que suma la tarjeta»*.
   * El E2E la mata con números reales; este guard la mata **en la llamada al motor**, que es donde el
   * dedo se resbala: si alguien cambia el `_sum` a `quotedTotalCents` o a `payoutNetCents`, el
   * `aggregate` pide otra columna y esto cae **sin necesidad de datos**.
   */
  function build() {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { approvedTotalCents: 50_000 } });
    const prisma: any = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }),
      },
      shipmentRequest: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      sellRequest: { count: jest.fn().mockResolvedValue(1), aggregate },
      dispute: { count: jest.fn().mockResolvedValue(0) },
      pendingPriceEntry: { count: jest.fn().mockResolvedValue(0) },
      priceReference: { findFirst: jest.fn().mockResolvedValue(null) },
      fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new AdminService(
      prisma as unknown as PrismaService,
      {} as PricingService,
      new PiiCryptoService(new ConfigService({})),
      {} as any,
    );
    return { svc, prisma, aggregate };
  }

  it('el `_sum` pide `approvedTotalCents` y NINGUNA otra columna de dinero', async () => {
    const { svc, aggregate } = build();
    await svc.dashboard('super_admin' as never, '2026-01-01', '2026-02-01');
    const args = aggregate.mock.calls[0][0];
    expect(args._sum).toEqual({ approvedTotalCents: true });
    // ⚠️ El sub-reporte histórico de §M5-V.9 sale de aquí: la tarjeta **no** aplica la cascada
    // `brutoConsumado`, y no hace falta que la aplique **porque V-a impide crear filas nuevas con
    // `approvedTotalCents = null`**. Si alguien mete `offerGrossCents`/`quotedTotalCents` en este
    // `_sum` «para arreglar el histórico», está transcribiendo la cascada por cuarta vez.
    expect(args._sum).not.toHaveProperty('quotedTotalCents');
    expect(args._sum).not.toHaveProperty('payoutNetCents');
    expect(args._sum).not.toHaveProperty('offerGrossCents');
    // Y se acota por `paidAt` (cuándo SALIÓ el dinero), no por `createdAt`.
    expect(args.where.paidAt).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-02-01') });
  });

  it('`amountCents` LEE `_sum.approvedTotalCents` (no otra clave del agregado)', async () => {
    const { svc, aggregate } = build();
    aggregate.mockResolvedValue({
      _sum: { approvedTotalCents: 50_000, quotedTotalCents: 60_000, payoutNetCents: 32_000 },
    });
    const res: any = await svc.dashboard('super_admin' as never, '2026-01-01', '2026-02-01');
    // Los tres números son distintos a propósito: leer la clave equivocada da 60000 o 32000.
    expect(res.buylistPeriod).toEqual({ count: 1, amountCents: 50_000 });
  });
});
