import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

/**
 * §4.27f-2 (P47-2, v1.46) — DURABILIDAD CROSS-DAY del override manual en la CAPA DE LECTURA.
 *
 * El fix del comparador `isBetterRef` (commit b16f03d) iza el tier manual por encima de `capturedDate`,
 * pero eso NO basta: si la fila manual NO llega a las candidatas de `pickBestRef`, el comparador nunca la
 * ve. El override manual se persiste con `capturedDate` FIJO y el barrido `tcgcsv_singles` añade ~1 fila
 * automática/día para la misma clave (sin purga). Tras ~32 días la fila manual cae FUERA del top-32
 * (`take: SAME_DAY_REF_CANDIDATES`) → el feed diario volvía a pisar el precio humano en silencio.
 *
 * Estos tests fijan el escenario >32 días: `getReference`/`getReferenceByCardProduct` DEBEN devolver el
 * override manual VIEJO por encima de la automática fresca, porque la lectura une SIEMPRE las filas
 * manuales de la clave (lectura dirigida, sin cota de fecha) a las candidatas del bloque reciente.
 *
 * El mock de Prisma modela fielmente las DOS lecturas: la capada (con `take`) devuelve las N automáticas
 * más frescas ordenadas `capturedDate desc` (la manual vieja QUEDA FUERA, como en la BD real); la
 * dirigida (sin `take`) devuelve solo las filas manuales.
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
 * Prisma mock fiel: distingue la lectura CAPADA (con `take`) de la DIRIGIDA de manuales (sin `take`).
 * - capada: ordena todas las filas por `capturedDate desc` y corta `take` (la manual vieja cae fuera).
 * - dirigida: filtra a `isManualOverride || source==='manual'` (modela `MANUAL_REF_PREDICATE`).
 */
function build(allRows: any[]) {
  const findManyArgs: any[] = [];
  const prisma: any = {
    priceReference: {
      findMany: jest.fn(async (args: any) => {
        findManyArgs.push(args);
        if (args.take == null) {
          return allRows.filter((r) => r.isManualOverride || r.source === 'manual');
        }
        return [...allRows]
          .sort((a, b) => b.capturedDate.getTime() - a.capturedDate.getTime())
          .slice(0, args.take);
      }),
    },
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
    const { svc, findManyArgs } = build(rows);
    const info = await svc.getReference('c1', 'raw', 'raw:NM', 'normal');
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(MANUAL_PRICE); // NO la automática fresca.
    expect(info.source).toBe('manual');
    expect(info.isManualOverride).toBe(true);
    // La lectura hace DOS queries: una CAPADA (take 32, tier automático) y una DIRIGIDA (sin take,
    // filas manuales). El manual sobrevive porque la dirigida no tiene cota de fecha.
    const capped = findManyArgs.find((a) => a.take != null);
    const directed = findManyArgs.find((a) => a.take == null);
    expect(capped.take).toBe(32);
    expect(directed).toBeDefined();
  });

  it('getReference: sin la lectura dirigida, la capada excluiría la manual (control negativo del mock)', async () => {
    const rows = [manualRow(), ...automaticSweepRows()];
    const { svc } = build(rows);
    // Confirmamos que el mock modela el hueco: la capada (take 32) NO trae la manual de enero.
    const capped = await (svc as any).prisma.priceReference.findMany({ take: 32 });
    expect(capped.some((r: any) => r.isManualOverride)).toBe(false);
    // …y aún así getReference la recupera por la lectura dirigida.
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
