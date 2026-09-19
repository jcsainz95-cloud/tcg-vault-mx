import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { makeRefsRawQuery } from './helpers/refs-raw-emulate';

/**
 * §4.27f-2 (P47-2, v1.46) — DURABILIDAD CROSS-DAY del override manual en la CAPA DE LECTURA.
 *
 * El fix del comparador `isBetterRef` (commit b16f03d) iza el tier manual por encima de `capturedDate`,
 * pero eso NO basta: si la fila manual NO llega a las candidatas, el comparador nunca la ve. El override
 * manual se persiste con `capturedDate` FIJO y el barrido `tcgcsv_singles` añade ~1 fila automática/día
 * para la misma clave (sin purga).
 *
 * Estos tests fijan el escenario >32 días: `getReference`/`getReferenceByCardProduct` DEBEN devolver el
 * override manual VIEJO por encima de la automática fresca, porque la candidata manual SIEMPRE está en la
 * ventana.
 *
 * P-53 ALTO-4 (§3): `getReference` DELEGA en `getReferencesBatch` (ventana `COALESCE(evidenceDate,
 * capturedDate)` vía `$queryRaw`, que conserva TODA fila manual: `is_manual OR …`) y
 * `getReferenceByCardProduct` DELEGA en `getReferencesByCardProductBatch`, que lee SIN cota. En ninguno
 * queda ya el `take: SAME_DAY_REF_CANDIDATES(=32)` por `capturedDate` crudo. La durabilidad cross-day del
 * override manual ahora la garantiza que los métodos de lote no capan por `capturedDate` — no una lectura
 * dirigida aparte. El mock refleja esas dos vías (poda por ventana + lectura de lote sin cota).
 */

const MANUAL_DAY = new Date('2026-01-01T00:00:00Z');
const MANUAL_PRICE = 9900;

/** Un puñado ≥32 de automáticas diarias, TODAS más frescas que el override manual de enero. */
function automaticSweepRows(over: Partial<any> = {}): any[] {
  const rows: any[] = [];
  for (let d = 0; d < 40; d++) {
    const day = new Date('2026-07-13T00:00:00Z');
    day.setUTCDate(day.getUTCDate() + d);
    rows.push({
      cardId: 'c1',
      productType: 'raw',
      gradeKey: 'raw:NM',
      finish: 'normal',
      priceMxnCents: 1000 + d, // valores automáticos (NUNCA deben ganar al manual)
      priceUsdCents: null,
      isManualOverride: false,
      source: 'tcgcsv_singles',
      capturedDate: day,
      cardProductId: null,
      ...over,
    });
  }
  return rows;
}

function manualRow(over: Partial<any> = {}): any {
  return {
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    priceMxnCents: MANUAL_PRICE,
    priceUsdCents: null,
    isManualOverride: true,
    source: 'manual',
    capturedDate: MANUAL_DAY,
    cardProductId: null,
    ...over,
  };
}

/**
 * Prisma mock que sirve las dos vías de delegación de P-53 ALTO-4 con las MISMAS filas:
 *  - `$queryRaw` (ventana real de `getReferencesBatch`, vía de `getReference`): conserva la manual
 *    perenne y la automática de frescura efectiva máxima por clave.
 *  - `findMany` (vía de `getReferenceByCardProduct` → `getReferencesByCardProductBatch`): lee SIN cota,
 *    así que devuelve TODAS las filas de la clave (incluida la manual). Si un cambio futuro reintroduce
 *    un `take`, el mock lo modela (orden `capturedDate desc` + corte), de modo que la exclusión de la
 *    manual vieja volvería a ser observable — el candado de regresión.
 */
function build(allRows: any[]) {
  const findManyArgs: any[] = [];
  const prisma: any = {
    priceReference: {
      findMany: jest.fn(async (args: any) => {
        findManyArgs.push(args);
        if (args?.take != null) {
          return [...allRows]
            .sort((a, b) => b.capturedDate.getTime() - a.capturedDate.getTime())
            .slice(0, args.take);
        }
        return [...allRows];
      }),
    },
    $queryRaw: makeRefsRawQuery(allRows),
  };
  const fx: any = { getCurrent: jest.fn(async () => null) }; // fx null ⇒ liveMxnCents = priceMxnCents.
  const svc = new PricingService(
    prisma as PrismaService,
    {} as SettingsService,
    fx as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { svc, findManyArgs };
}

describe('PricingService — override manual DURABLE cross-day (§4.27f-2 / P47-2, >32 días)', () => {
  it('getReference: el override manual de enero gana a 40 barridos automáticos más frescos', async () => {
    const rows = [manualRow(), ...automaticSweepRows()];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(MANUAL_PRICE); // NO la automática fresca.
    // §4.36.7 (adopción v2): `isManualOverride` SE RETIRA del DTO `PriceInfo`; el discriminante público
    // del override manual es `source === 'manual'` (arriba). El invariante money-safe (el override humano
    // gana cross-day a los barridos automáticos) queda cubierto por status/referenceMxnCents/source.
    expect(info.source).toBe('manual');
  });

  it('getReference: la ventana de getReferencesBatch conserva la candidata manual perenne (no la capa por capturedDate)', async () => {
    // Bajo delegación (P-53 ALTO-4) la durabilidad la garantiza que la ventana `$queryRaw` incluye TODA
    // fila manual (`is_manual OR COALESCE(evidenceDate,capturedDate)=max_auto_date`), sin importar cuántos
    // barridos automáticos más frescos se acumulen. Probamos la ventana directamente: la manual de enero
    // sigue entre las candidatas que la poda entrega, y por eso `getReference` la elige.
    const rows = [manualRow(), ...automaticSweepRows()];
    const { svc } = build(rows);
    const podadas: any[] = await (svc as any).prisma.$queryRaw({ sql: 'WITH filtered … max_auto_date …' });
    expect(podadas.some((r: any) => r.isManualOverride)).toBe(true);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.referenceMxnCents).toBe(MANUAL_PRICE);
  });

  it('getReferenceByCardProduct: el override manual viejo del producto separado gana a 40 automáticas', async () => {
    const cp = 'cp-sep-1';
    const rows = [
      manualRow({ cardProductId: cp }),
      ...automaticSweepRows({ cardProductId: cp }),
    ];
    const { svc } = build(rows);
    const info = await svc.getReferenceByCardProduct(cp, 'raw', 'raw:NM', 'normal');
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(MANUAL_PRICE);
    expect(info.source).toBe('manual');
  });

  it('sin override manual, la automática MÁS FRESCA gana (sin regresión del tier automático)', async () => {
    const rows = automaticSweepRows();
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.source).toBe('tcgcsv_singles');
    expect(info.referenceMxnCents).toBe(1000 + 39); // la del día más reciente del barrido.
  });

  it('entre DOS overrides manuales gana el más reciente (frescura desempata dentro del tier)', async () => {
    const older = manualRow({ capturedDate: MANUAL_DAY, priceMxnCents: 5000 });
    const newer = manualRow({ capturedDate: new Date('2026-06-01T00:00:00Z'), priceMxnCents: 7000 });
    const rows = [older, newer, ...automaticSweepRows()];
    const { svc } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.source).toBe('manual');
    expect(info.referenceMxnCents).toBe(7000); // el manual más reciente, no el automático ni el viejo.
  });
});
