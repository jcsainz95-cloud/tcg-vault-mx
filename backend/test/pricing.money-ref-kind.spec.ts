/**
 * pricing.money-ref-kind.spec.ts — **M-43 (v1.50.3-f): la NATURALEZA de la fila de precio.**
 * ARCHITECTURE §4.38(l.4), API_CONTRACT rev v1.50.3-f, §11 `v1.50.3-f-graded-estimate-kind`.
 *
 * ## Qué defiende este archivo
 * El hallazgo **GE-1** (pentester, ALTA, reproducido en vivo) es **INV-D en la dirección inversa**: la
 * fila del «valor estimado si se gradea» y la referencia de mercado real de un slab PSA publicado son
 * **LA MISMA FILA** (`cardId` + `graded` + `graded:PSA:N` + `finish='normal'` + `cardProductId=null`).
 * Las guardas `422`/`409` cubren *capturar un estimado sobre una carta que YA tiene slab*; **no** la
 * ventana temporal inversa: capturar el estimado PRIMERO (permitido: no hay slab) y publicar el slab
 * DESPUÉS. Medido: un slab PSA 10 que con referencia correcta lista a **MX$9,200** quedó publicado a
 * **MX$460** —el 5%— heredando un estimado con error USD-como-MXN; y con el estimado **rancio a −400
 * días** siguió a MX$460, porque la frescura es un predicado de EXHIBICIÓN y jamás retira una fila del
 * resolver de dinero.
 *
 * El cierre NO es ordenar (`sourceRank`) sino **EXCLUIR**: el estimado suele ser la ÚNICA candidata de
 * su clave —no existe ningún escritor automático de referencia de mercado `graded` (§4.38l.4.6, candado
 * 4)— y con una sola candidata `pickBestRef` la elige con **cualquier** rango. *Ordenar no es excluir.*
 *
 * ## Cómo está construido (y por qué así)
 * El doble de Prisma **HONRA el `where`** (`matchRefWhere`). No es un detalle de comodidad: un doble que
 * devuelve siempre las mismas filas no puede distinguir «el predicado está» de «el predicado funciona»,
 * que es exactamente la diferencia que este pase tiene que demostrar. Los montos son los de la medición
 * del pentester, en centavos, para que la prueba hable el mismo idioma que el hallazgo.
 */
import { PricingService, MONEY_REF_WHERE } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

// ---------------------------------------------------------------------------
// Montos de la medición de GE-1 (PENTEST_NOTES «PASE FEATURE»), en centavos MXN.
// ---------------------------------------------------------------------------
/** El estimado con el error USD-como-MXN: USD 400 tecleados como MX$400. */
const ESTIMADO_MALO_CENTS = 40_000;
/** La referencia de mercado CORRECTA del slab PSA 10 (fixture `slabbed`): MX$8,000. */
const MERCADO_SLAB_CENTS = 800_000;

/**
 * `HOY` replica el `today()` privado de `pricing.service` (medianoche UTC), no una fecha literal: la fila «del día» tiene que casar con la que el escritor busca, o los casos de
 * `update` se irían por la rama `create` y darían un verde falso sobre la línea que este archivo
 * defiende.
 */
const HOY = (() => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
})();
const HACE_400_DIAS = new Date('2025-07-25T00:00:00Z');

type Row = Record<string, unknown>;

/**
 * Evalúa un `where` de Prisma contra una fila en memoria. Soporta lo que usan los seams tocados:
 * igualdad, `null`, `in`, `OR`, `AND` y la relación `cardProduct` (solo su presencia).
 */
function matchRefWhere(row: Row, where: unknown): boolean {
  for (const [k, v] of Object.entries((where ?? {}) as Record<string, unknown>)) {
    if (k === 'OR') {
      if (!(v as unknown[]).some((sub) => matchRefWhere(row, sub))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as unknown[]).every((sub) => matchRefWhere(row, sub))) return false;
      continue;
    }
    if (k === 'cardProduct') {
      if (row.cardProductId == null) return false;
      continue;
    }
    const rv = row[k];
    if (v === null) {
      if (rv != null) return false;
      continue;
    }
    if (v instanceof Date) {
      // Los escritores comparan la fila del día con `today()`, que produce una instancia NUEVA: sin
      // esta rama el doble no casaría nunca y los casos de `update` pasarían por la rama `create`
      // dando un verde falso.
      if (!(rv instanceof Date) || rv.getTime() !== v.getTime()) return false;
      continue;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('in' in o) {
        if (!(o.in as unknown[]).includes(rv)) return false;
        continue;
      }
      return false;
    }
    if (rv !== v) return false;
  }
  return true;
}

/** Fila de `PriceReference` con la forma que consumen los seams (incluida `refKind`). */
function refRow(over: Partial<Row> = {}): Row {
  return {
    id: 'r1',
    cardId: 'card-fourth-raw',
    productType: 'graded',
    gradeKey: 'graded:PSA:10',
    finish: 'normal',
    priceMxnCents: ESTIMADO_MALO_CENTS,
    priceUsdCents: null,
    // El estimado de la fase 1 se escribe SIEMPRE por la vía manual ⇒ `isManualOverride: true`. Es
    // justamente por eso que el `MANUAL_REF_PREDICATE` (candidata PERENNE, sin cota de fecha) lo traía
    // aunque estuviera rancio a −400 días: la variante GRAVE #2 del PoC.
    isManualOverride: true,
    source: 'manual',
    capturedDate: HOY,
    cardProductId: null,
    refKind: 'graded_estimate',
    ...over,
  };
}

function build(rows: Row[]) {
  const created: Row[] = [];
  const updated: { where: unknown; data: Row }[] = [];
  const findManyArgs: { where: unknown }[] = [];
  const prisma = {
    priceReference: {
      findMany: jest.fn(async (args: { where?: unknown }) => {
        findManyArgs.push({ where: args.where });
        return rows.filter((r) => matchRefWhere(r, args.where));
      }),
      findFirst: jest.fn(async (args: { where?: unknown }) => {
        return rows.find((r) => matchRefWhere(r, args.where)) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Row }) => {
        created.push(data);
        return { id: 'new', ...data };
      }),
      update: jest.fn(async ({ where, data }: { where: unknown; data: Row }) => {
        updated.push({ where, data });
        return { id: 'upd', ...data };
      }),
    },
    pendingPriceEntry: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const fx = { getCurrent: jest.fn(async () => null) }; // fx null ⇒ liveMxnCents = priceMxnCents.
  const svc = new PricingService(
    prisma as unknown as PrismaService,
    {} as SettingsService,
    fx as unknown as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { svc, prisma, created, updated, findManyArgs };
}

// ===========================================================================
describe('M-43 — `MONEY_REF_WHERE`: el estimado NO ES CANDIDATA de la ruta de dinero (§4.38l.4.4A)', () => {
  it('el predicado es EXCLUSIÓN, no rango: `{ refKind: "market" }`', () => {
    // Si esto cambia a un `orderBy`/`sourceRank`, el PoC de GE-1 vuelve tal cual: con UNA sola
    // candidata, cualquier rango gana. La derogación está escrita en §4.38(l.4.1).
    expect(MONEY_REF_WHERE).toEqual({ refKind: 'market' });
  });

  it('GE-1 — la clave con SOLO un estimado resuelve `pending`, no un precio (fail-closed)', async () => {
    const { svc } = build([refRow()]);
    const info = await svc.getReference('card-fourth-raw', 'graded', 'graded:PSA:10', 'normal');
    // ANTES de M-43: `{ status:'priced', referenceMxnCents: 40000 }` ⇒ el slab listaba a MX$460.
    // AHORA: sin candidata ⇒ `pending` ⇒ `decideSalePrice` da `no_market` ⇒ la pieza NO es vendible.
    // Es la dirección correcta del fallo: una pieza sin precio no le cuesta dinero a nadie.
    expect(info).toEqual({ status: 'pending' });
  });

  it('GE-1 variante RANCIA (−400 días) — tampoco se cuela por la lectura de candidatas PERENNES', async () => {
    // El PoC retrasó `capturedDate` 400 días y el slab **siguió** a MX$460, porque la fila manual entra
    // SIN cota de fecha por `MANUAL_REF_PREDICATE` (§4.27f-2). Si `MONEY_REF_WHERE` faltara en ESA
    // segunda query —el olvido natural— el hallazgo seguiría vivo justo en su variante más difícil de
    // ver. Por eso este caso existe además del anterior.
    const { svc, findManyArgs } = build([refRow({ capturedDate: HACE_400_DIAS })]);
    const info = await svc.getReference('card-fourth-raw', 'graded', 'graded:PSA:10', 'normal');
    expect(info).toEqual({ status: 'pending' });
    // Y se comprueba estructuralmente: LAS DOS queries llevan el predicado.
    expect(findManyArgs).toHaveLength(2);
    for (const { where } of findManyArgs) {
      expect(JSON.stringify(where)).toContain('"refKind":"market"');
    }
  });

  it('la fila de MERCADO del mismo grado SÍ pricea: M-43 no rompe el flujo legítimo del slab', async () => {
    // El candado 4 (§4.38l.4.6) es el argumento de coste del dictamen: NO existe escritor automático de
    // mercado `graded`, así que el precio de un slab es SIEMPRE una captura humana con `intent:"market"`.
    // Ese flujo no cambia en absoluto — y esta prueba es la que lo fija.
    const { svc } = build([
      refRow({ id: 'r-est', priceMxnCents: ESTIMADO_MALO_CENTS, refKind: 'graded_estimate' }),
      refRow({ id: 'r-mkt', priceMxnCents: MERCADO_SLAB_CENTS, refKind: 'market' }),
    ]);
    const info = await svc.getReference('card-fourth-raw', 'graded', 'graded:PSA:10', 'normal');
    expect(info).toMatchObject({ status: 'priced', referenceMxnCents: MERCADO_SLAB_CENTS });
  });

  it('`getReferencesBatch` — el estimado no entra al lote (bulk-publish, bóveda, binder, buylist)', async () => {
    const { svc } = build([
      refRow({ id: 'r-est' }),
      refRow({
        id: 'r-raw',
        productType: 'raw',
        gradeKey: 'raw:NM',
        priceMxnCents: 35_000,
        refKind: 'market',
      }),
    ]);
    const map = await svc.getReferencesBatch([
      { cardId: 'card-fourth-raw', productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'normal' },
      { cardId: 'card-fourth-raw', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
    ]);
    expect(map.get('card-fourth-raw|graded|graded:PSA:10|normal')).toBeUndefined();
    expect(map.get('card-fourth-raw|raw|raw:NM|normal')).toMatchObject({ referenceMxnCents: 35_000 });
  });

  it('`getReferenceByCardProduct` — el predicado va en SUS DOS queries también', async () => {
    const { svc, findManyArgs } = build([]);
    await svc.getReferenceByCardProduct('cp-1', 'raw', 'raw:NM', 'normal');
    expect(findManyArgs).toHaveLength(2);
    for (const { where } of findManyArgs) {
      expect(JSON.stringify(where)).toContain('"refKind":"market"');
    }
  });

  it('la ruta del GANCHO es INCLUSIVA: `getGradedEstimatesBatch` ve las DOS naturalezas (§4.38l.4.4B)', async () => {
    // La asimetría es deliberada. En la dirección del DINERO se falla CERRANDO; en la de la EXHIBICIÓN
    // se falla INFORMANDO — las filas `market` de cartas SIN slab son la mejor estimación disponible de
    // lo que valdría esa carta gradeada, y excluirlas vaciaría la vitrina en silencio.
    const cfg = { freshnessDays: 3650, manualFreshnessDays: 3650 } as never;
    const { svc } = build([
      refRow({ id: 'r-est', gradeKey: 'graded:PSA:10', refKind: 'graded_estimate', priceMxnCents: 900_000 }),
      refRow({ id: 'r-mkt', gradeKey: 'graded:PSA:9', refKind: 'market', priceMxnCents: 500_000 }),
    ]);
    const map = await svc.getGradedEstimatesBatch(['card-fourth-raw'], cfg, '2026-08-29');
    const got = (map.get('card-fourth-raw') ?? []).map((e) => [e.gradeValue, e.refKind]).sort();
    expect(got).toEqual([
      ['10', 'graded_estimate'],
      ['9', 'market'],
    ]);
  });
});

// ===========================================================================
describe('M-43 — reglas de ESCRITURA: la naturaleza la fija el escritor (§4.38l.4.3)', () => {
  it('⚠️ EL TRAMPOLÍN — `manualOverride` fija `refKind` en el `update`, no solo en el `create`', async () => {
    // Éste es el caso que el dictamen marca como «el trampolín obvio de esta migración». La `@@unique`
    // NO incluye `refKind`, así que un `intent:"market"` sobre la fila-estimado del MISMO día **reusa
    // esa fila**: si el `update` omitiera la naturaleza, la dejaría clasificada como estimado y el slab
    // se quedaría sin precio. Es además el gesto exacto del paso 3 del cut-over (§4.38l.4.7).
    const { svc, updated } = build([refRow({ id: 'r-est' })]);
    await svc.manualOverride(
      'card-fourth-raw',
      'graded',
      'graded:PSA:10',
      MERCADO_SLAB_CENTS,
      'normal',
      undefined,
      undefined,
      'market',
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].where).toEqual({ id: 'r-est' });
    expect(updated[0].data).toMatchObject({
      source: 'manual',
      priceMxnCents: MERCADO_SLAB_CENTS,
      isManualOverride: true,
      refKind: 'market',
    });
  });

  it('`manualOverride` fija `refKind` en el `create` (fila nueva del día)', async () => {
    const { svc, created } = build([]);
    await svc.manualOverride(
      'card-fourth-raw',
      'graded',
      'graded:PSA:10',
      ESTIMADO_MALO_CENTS,
      'normal',
      undefined,
      undefined,
      'graded_estimate',
    );
    expect(created[0]).toMatchObject({ refKind: 'graded_estimate', isManualOverride: true });
  });

  it('sin naturaleza explícita el default es `market` (los call-sites de sellado no la declaran)', async () => {
    const { svc, created } = build([]);
    await svc.manualOverride('card-x', 'sealed', 'sealed', 115_000, 'normal');
    expect(created[0]).toMatchObject({ refKind: 'market' });
  });

  it('EL INGEST NUNCA DEGRADA una fila `market` (regla 2): skip, y la fila NO se toca', async () => {
    // Con la fila del día ya en `market` —el precio real de un slab publicado— escribir el estimado
    // encima la reclasificaría y dejaría al slab SIN precio. Skip + traza, igual que ante un override
    // manual. *La naturaleza solo la SUBE un humano con `intent:"market"`; la automática nunca la baja.*
    const mercado = refRow({ id: 'r-mkt', refKind: 'market', isManualOverride: false, source: 'tcgcsv' });
    const { svc, created, updated } = build([mercado]);
    const wrote = await svc.persistGradedEstimateReference(
      'card-fourth-raw',
      '10',
      { amountCents: ESTIMADO_MALO_CENTS, currency: 'MXN', source: 'pokemonpricetracker' },
      { rate: 17.5, bufferPct: 3 },
    );
    expect(wrote).toBe(false);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('el ingest SÍ actualiza una fila de estimado, y le refija la naturaleza en el `update`', async () => {
    const { svc, updated } = build([refRow({ id: 'r-est', isManualOverride: false, source: 'pokemonpricetracker' })]);
    const wrote = await svc.persistGradedEstimateReference(
      'card-fourth-raw',
      '10',
      { amountCents: 250_000, currency: 'MXN', source: 'pokemonpricetracker' },
      { rate: 17.5, bufferPct: 3 },
    );
    expect(wrote).toBe(true);
    expect(updated[0].data).toMatchObject({ refKind: 'graded_estimate', priceMxnCents: 250_000 });
  });

  it('`persistMarketReference` fija `market` en el `update` (no se apoya en el default de la columna)', async () => {
    const { svc, updated } = build([
      refRow({ id: 'r-raw', productType: 'raw', gradeKey: 'raw:NM', refKind: 'market', isManualOverride: false }),
    ]);
    await svc.persistMarketReference(
      'card-fourth-raw',
      'normal',
      { marketCents: 35_000, currency: 'MXN', source: 'tcgcsv_singles' },
      { rate: 17.5, bufferPct: 3 },
    );
    expect(updated[0].data).toMatchObject({ refKind: 'market' });
  });
});
