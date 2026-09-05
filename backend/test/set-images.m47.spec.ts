import { Logger } from '@nestjs/common';
import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { CatalogService, toCardDTO } from '../src/modules/catalog/catalog.service';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * P-54 / M-47 (v1.52-set-logos) — IMÁGENES DE SET: `CardSet.logoUrl` / `CardSet.symbolUrl`.
 * ARCHITECTURE §4.39, API_CONTRACT v1.52.
 *
 * Este archivo prueba las TRES mitades del diseño y está escrito para fallar en AMBAS direcciones:
 *
 *  (A) PERSISTENCIA (§4.39.4): `upsertSet()` escribe las dos columnas con el guardarraíl `https:`+host
 *      y con la regla de NO-DEGRADACIÓN (ausente/rechazada ⇒ no-op en el `update`, `null` en el `create`).
 *  (B) EXPOSICIÓN (§4.39.5, NORMATIVO): `logoUrl` viaja en `MasterSetSummaryDTO` (los CUATRO modos de la
 *      retícula) y en `GET /buylist/sets` → `data[]`. Si alguien quita el campo, estos tests se ponen rojos.
 *  (C) NO-EXPOSICIÓN (§4.39.5, igual de normativo): `symbolUrl` NO sale en NINGÚN DTO, y `logoUrl` NO
 *      entra en `/catalog/facets`, `/catalog/sets`, `CardDTO`, `/admin/catalog/remote-sets` ni `SetRefDTO`.
 *      Los stubs de Prisma de esos tests DEVUELVEN las columnas a propósito: si alguien las proyecta
 *      «por si acaso» (o hace un spread de la fila), el test se pone rojo.
 */

const HOST = 'https://images.pokemontcg.io';
const LOGO = `${HOST}/sv8/logo.png`;
const SYMBOL = `${HOST}/sv8/symbol.png`;

// ───────────────────────────── helpers de sync (A) ─────────────────────────────

function remoteCard(id: string, set: Record<string, unknown>) {
  return {
    id,
    name: `Card ${id}`,
    number: '1',
    rarity: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    images: { small: 's', large: 'l' },
    set,
  };
}

function syncPrisma() {
  return {
    cardSet: {
      upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
      findMany: jest.fn(async () => []),
    },
    card: { upsert: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
  } as any;
}

function syncSettings(): SettingsService {
  return { getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService;
}

function reconciler(): any {
  return { reconcile: jest.fn(async () => 0) };
}

function clientForSet(set: Record<string, unknown>): PokemonTcgIoClient {
  return {
    getCardsBySet: jest.fn(async () => ({
      data: [remoteCard('sv8-1', set)],
      page: 1,
      pageSize: 250,
      count: 1,
      totalCount: 1,
    })),
    getSets: jest.fn(),
  } as unknown as PokemonTcgIoClient;
}

/** Corre `sync('sv8')` con el `set` remoto dado y devuelve los args del `cardSet.upsert`. */
async function upsertArgsFor(set: Record<string, unknown>) {
  const prisma = syncPrisma();
  const svc = new CatalogSyncService(
    prisma as PrismaService,
    clientForSet(set),
    syncSettings(),
    reconciler(),
  );
  await svc.sync('sv8');
  return prisma.cardSet.upsert.mock.calls[0][0] as { create: any; update: any };
}

const baseSet = { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' };

describe('M-47 (A) — upsertSet PERSISTE las dos imágenes de set (§4.39.4)', () => {
  it('con images.logo e images.symbol válidas: las escribe en create Y en update', async () => {
    const args = await upsertArgsFor({ ...baseSet, images: { logo: LOGO, symbol: SYMBOL } });
    expect(args.create.logoUrl).toBe(LOGO);
    expect(args.create.symbolUrl).toBe(SYMBOL);
    expect(args.update.logoUrl).toBe(LOGO);
    expect(args.update.symbolUrl).toBe(SYMBOL);
  });

  it('SIN bloque images: create ⇒ null, update ⇒ NO-OP (la clave NI SIQUIERA VIAJA)', async () => {
    const args = await upsertArgsFor({ ...baseSet });
    // Set nuevo: no hay nada que degradar.
    expect(args.create.logoUrl).toBeNull();
    expect(args.create.symbolUrl).toBeNull();
    // NO-DEGRADACIÓN: si esto emitiera `logoUrl: null`, un `sync {setId}` BORRARÍA el logo que un
    // `sync-all` ya escribió (el bug que §4.39.4 existe para impedir).
    expect('logoUrl' in args.update).toBe(false);
    expect('symbolUrl' in args.update).toBe(false);
    expect(args.update.logoUrl ?? undefined).toBeUndefined();
  });

  it('images con SOLO el logo: el symbol ausente no degrada (y viceversa)', async () => {
    const soloLogo = await upsertArgsFor({ ...baseSet, images: { logo: LOGO } });
    expect(soloLogo.update.logoUrl).toBe(LOGO);
    expect('symbolUrl' in soloLogo.update).toBe(false);
    expect(soloLogo.create.symbolUrl).toBeNull();

    const soloSymbol = await upsertArgsFor({ ...baseSet, images: { symbol: SYMBOL } });
    expect(soloSymbol.update.symbolUrl).toBe(SYMBOL);
    expect('logoUrl' in soloSymbol.update).toBe(false);
    expect(soloSymbol.create.logoUrl).toBeNull();
  });

  it('REGRESIÓN de no-degradación end-to-end: sync CON logo → sync SIN logo ⇒ el update no lo pisa', async () => {
    const conLogo = await upsertArgsFor({ ...baseSet, images: { logo: LOGO, symbol: SYMBOL } });
    const sinLogo = await upsertArgsFor({ ...baseSet }); // la vía «set anidado en carta» sin images
    expect(conLogo.update.logoUrl).toBe(LOGO);
    expect(Object.keys(sinLogo.update)).not.toContain('logoUrl');
    expect(Object.keys(sinLogo.update)).not.toContain('symbolUrl');
  });
});

describe('M-47 (A) — guardarraíl de ingesta: solo https:// del host del proveedor (§4.39.4)', () => {
  // Cada caso: URL que el proveedor podría mandar y que NUNCA debe llegar a la BD.
  const rechazadas: Array<[string, unknown]> = [
    ['http (no cifrado)', 'http://images.pokemontcg.io/sv8/logo.png'],
    ['host arbitrario https', 'https://evil.example.com/sv8/logo.png'],
    ['subdominio parecido', 'https://images.pokemontcg.io.evil.com/logo.png'],
    ['URL relativa', '/sv8/logo.png'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:image/png;base64,AAAA'],
    ['cadena vacía', ''],
    ['no-string', 12345],
  ];

  it.each(rechazadas)('rechaza %s ⇒ create null y update NO-OP (nunca borra lo bueno)', async (_label, url) => {
    const args = await upsertArgsFor({ ...baseSet, images: { logo: url, symbol: url } });
    expect(args.create.logoUrl).toBeNull();
    expect(args.create.symbolUrl).toBeNull();
    // Composición de guardarraíl + no-degradación: una URL mala se trata EXACTAMENTE como ausente.
    // Si el update la mapeara a `null`, un glitch del proveedor borraría un logo bueno.
    expect('logoUrl' in args.update).toBe(false);
    expect('symbolUrl' in args.update).toBe(false);
  });

  it('acepta el host admitido con path/query cualquiera (una URL limpia NO se reescribe)', async () => {
    const url = `${HOST}/sv8/logo_hires.png?v=2`;
    const args = await upsertArgsFor({ ...baseSet, images: { logo: url } });
    expect(args.create.logoUrl).toBe(url); // se persiste TAL CUAL, jamás construida por plantilla
  });
});

/**
 * I-4 (gate de QA/seguridad) — el guardarraíl debe SOSTENER lo que promete. Tres agujeros concretos que
 * el primer pase dejaba abiertos, alineados con el precedente de la casa `sanitizeSealedImageUrl`
 * (`src/modules/inventory/sealed-image-host.ts`, §4.32c).
 */
describe('M-47 (A) — I-4: puerto, userinfo y NORMALIZACIÓN de la cadena persistida', () => {
  it('PUERTO no estándar ⇒ RECHAZADO (`host`, no `hostname`: otro puerto es otro endpoint)', async () => {
    const args = await upsertArgsFor({
      ...baseSet,
      images: { logo: 'https://images.pokemontcg.io:8443/sv8/logo.png' },
    });
    expect(args.create.logoUrl).toBeNull();
    expect('logoUrl' in args.update).toBe(false);
  });

  it('el puerto https POR DEFECTO (`:443`) sí se acepta y queda elidido en lo persistido', async () => {
    const args = await upsertArgsFor({
      ...baseSet,
      images: { logo: 'https://images.pokemontcg.io:443/sv8/logo.png' },
    });
    // El WHATWG URL elide el puerto por defecto ⇒ mismo endpoint, misma cadena canónica.
    expect(args.create.logoUrl).toBe(`${HOST}/sv8/logo.png`);
  });

  it('USERINFO ⇒ RECHAZADO (credenciales embebidas confunden sobre quién es el host real)', async () => {
    for (const url of [
      'https://evil@images.pokemontcg.io/sv8/logo.png',
      'https://user:pass@images.pokemontcg.io/sv8/logo.png',
    ]) {
      const args = await upsertArgsFor({ ...baseSet, images: { logo: url, symbol: url } });
      expect(args.create.logoUrl).toBeNull();
      expect(args.create.symbolUrl).toBeNull();
      expect('logoUrl' in args.update).toBe(false);
      expect('symbolUrl' in args.update).toBe(false);
    }
  });

  it('se persiste la forma NORMALIZADA, no la cadena cruda que `new URL` perdonó', async () => {
    // `new URL` TOLERA espacios/C0 al borde y ELIMINA tabs/saltos interiores: guardar el crudo metería
    // en la BD exactamente lo que el parser acaba de limpiar.
    const sucia = `  ${HOST}/sv8/lo\tgo.png\n `;
    const args = await upsertArgsFor({ ...baseSet, images: { logo: sucia } });
    expect(args.create.logoUrl).toBe(`${HOST}/sv8/logo.png`);
    expect(args.create.logoUrl).not.toBe(sucia);
    // Invariante fuerte: lo persistido NUNCA lleva espacios ni caracteres de control.
    expect(args.create.logoUrl).not.toMatch(/[\s\u0000-\u001f]/);
  });

  it('espacio INTERIOR ⇒ se percent-encodea (no entra crudo a la BD)', async () => {
    const args = await upsertArgsFor({ ...baseSet, images: { logo: `${HOST}/sv8/lo go.png` } });
    expect(args.create.logoUrl).toBe(`${HOST}/sv8/lo%20go.png`);
    expect(args.create.logoUrl).not.toContain(' ');
  });
});

/**
 * N-3 (gate de QA) — DISCIPLINA DE LOG del guardarraíl. `M47-D1` (docs/TECH_DEBT.md) declara estos
 * `warn` la ÚNICA señal de que una URL se rechaza indefinidamente, así que su forma es contrato
 * operativo, no cosmética: tienen que ser **greppables** y **no forjables**. Estos tests fijan la
 * decisión de recortar `raw` para que el próximo lector no la lea como descuido y la «arregle».
 */
describe('M-47 (A) — N-3: qué se registra al rechazar, y qué NO', () => {
  /** Captura los `warn` emitidos durante una corrida de `sync`. */
  async function warnsFor(set: Record<string, unknown>): Promise<string[]> {
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const svc = new CatalogSyncService(
        syncPrisma() as PrismaService,
        clientForSet(set),
        syncSettings(),
        reconciler(),
      );
      await svc.sync('sv8');
      return spy.mock.calls.map((c) => String(c[0]));
    } finally {
      spy.mockRestore();
    }
  }

  it('URL no parseable: el log NO vuelca la cadena cruda (anti log-injection) pero SIGUE siendo diagnosticable', async () => {
    // CRLF: si la cadena entrara verbatim al log, un upstream comprometido podría FORJAR una línea
    // que parezca emitida por otro subsistema.
    const forjada = '/x/logo.png\r\nWARN [OtroServicio] LINEA-FORJADA';
    const warns = (await warnsFor({ ...baseSet, images: { logo: forjada } })).filter((w) =>
      w.includes('images.logo'),
    );
    expect(warns).toHaveLength(1);
    const w = warns[0];
    // Lo que NO puede estar: la cadena cruda, ni ningún salto de línea que parta el registro.
    expect(w).not.toContain('LINEA-FORJADA');
    expect(w).not.toContain(forjada);
    expect(w).not.toMatch(/[\r\n]/);
    // Lo que SÍ tiene que estar: prefijo estable greppable + el dato no forjable que queda.
    expect(w).toContain('upsertSet(sv8)');
    expect(w).toContain('images.logo');
    expect(w).toContain(`longitud=${forjada.length}`);
  });

  it('userinfo: el log NOMBRA el host (contra qué se rechazó) y NO filtra las credenciales', async () => {
    const warns = (
      await warnsFor({
        ...baseSet,
        images: { logo: 'https://evil:s3cr3t@images.pokemontcg.io/x.png' },
      })
    ).filter((w) => w.includes('images.logo'));
    expect(warns).toHaveLength(1);
    const w = warns[0];
    // `URL.host` es un componente ya parseado: diagnosticable y no forjable.
    expect(w).toContain('images.pokemontcg.io');
    expect(w).toContain('userinfo');
    // El userinfo es el material sensible del caso: no se registra ni el usuario ni la contraseña.
    expect(w).not.toContain('s3cr3t');
    expect(w).not.toContain('evil');
    expect(w).not.toMatch(/[\r\n]/);
  });
});

// ───────────────────────── helpers de MasterSetSummaryDTO (B) ─────────────────────────

function masterSetPrisma(over: any = {}): PrismaService {
  return {
    cardSet: { findMany: jest.fn(), findUnique: jest.fn() },
    card: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    user: { findUnique: jest.fn(async () => ({ id: 'u1', name: 'Ana', email: 'a@b.mx' })) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as PrismaService;
}

function masterSetPricing(): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    getReferencesBatch: jest.fn(async () => new Map()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    gradeKeyFor: jest.fn().mockReturnValue('raw_NM'),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

/** Filas de `CardSet` como las rinde Prisma: `symbolUrl` VIENE incluida a propósito (ver (C)). */
const setRows = [
  {
    id: 's1',
    externalId: 'sv8',
    name: 'Surging Sparks',
    series: 'SV',
    releaseDate: '2024/11/08',
    printedTotal: 191,
    logoUrl: LOGO,
    symbolUrl: SYMBOL,
  },
  {
    id: 's2',
    externalId: 'basep',
    name: 'Wizards Black Star Promos',
    series: 'Base',
    releaseDate: '1999/07/01',
    printedTotal: 53,
    // Caso NORMAL Y PERMANENTE: el proveedor no ilustra este set (o aún no se re-sincronizó).
    logoUrl: null,
    symbolUrl: null,
  },
];

describe('M-47 (B) — MasterSetSummaryDTO expone logoUrl (§4.39.5, los CUATRO modos)', () => {
  it('scope platform: emite el logo del set que lo tiene y `null` (clave presente) del que no', async () => {
    const prisma = masterSetPrisma();
    (prisma.cardSet.findMany as unknown as jest.Mock).mockResolvedValue(setRows);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });

    const s1 = res.data.find((r) => r.setId === 's1')!;
    const s2 = res.data.find((r) => r.setId === 's2')!;
    expect(s1.logoUrl).toBe(LOGO);
    // `null` con CLAVE PRESENTE (§4.39.6): nunca omitida, nunca `""`, nunca un placeholder.
    expect(s2.logoUrl).toBeNull();
    expect('logoUrl' in s2).toBe(true);
    expect(Object.keys(s2)).toContain('logoUrl');
  });

  it('la query del índice SELECCIONA logoUrl de la MISMA fila (cero queries nuevas, cero N+1)', async () => {
    const prisma = masterSetPrisma();
    (prisma.cardSet.findMany as unknown as jest.Mock).mockResolvedValue(setRows);
    const svc = new MasterSetService(prisma, masterSetPricing());
    await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    const calls = (prisma.cardSet.findMany as unknown as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1); // sigue siendo UNA sola query de sets
    expect(calls[0][0].select.logoUrl).toBe(true);
    // §4.39.5: `symbolUrl` se persiste y NO se expone ⇒ ni siquiera se selecciona.
    expect(calls[0][0].select.symbolUrl).toBeUndefined();
  });

  it('scope user_vault (bóveda del cliente / admin-bóveda) recibe el MISMO campo — simetría del read model', async () => {
    const prisma = masterSetPrisma();
    (prisma.cardSet.findMany as unknown as jest.Mock).mockResolvedValue(setRows);
    (prisma.$queryRaw as unknown as jest.Mock).mockImplementation((query: any) => {
      const s = query && typeof query.sql === 'string' ? query.sql : String(query);
      if (s.includes('FROM "InventoryItem"')) {
        return Promise.resolve([{ setId: 's1', pieces: 2n, distinctCards: 1n, distinctVariants: 1n }]);
      }
      return Promise.resolve([]);
    });
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index(
      { page: 1, pageSize: 20, sort: 'release_desc' },
      { kind: 'user_vault', userId: 'u1' },
      { includeOwnerEmail: true },
    );
    expect(res.data).toHaveLength(1);
    expect(res.data[0].logoUrl).toBe(LOGO);
  });

  it('P-27 (master set combinado): la fila plegada emite el logo del PRINCIPAL, no el del subset', async () => {
    // Celebrations (`cel25`) + su subset (`cel25c`), el grupo curado real del proyecto.
    const prisma = masterSetPrisma();
    (prisma.cardSet.findMany as unknown as jest.Mock).mockResolvedValue([
      {
        id: 'p', externalId: 'cel25', name: 'Celebrations', series: 'SWSH',
        releaseDate: '2021/10/08', printedTotal: 25,
        logoUrl: `${HOST}/cel25/logo.png`, symbolUrl: null,
      },
      {
        id: 'sub', externalId: 'cel25c', name: 'Celebrations: Classic Collection', series: 'SWSH',
        releaseDate: '2021/10/08', printedTotal: 25,
        logoUrl: `${HOST}/cel25c/logo.png`, symbolUrl: null,
      },
    ]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    expect(res.data.map((r) => r.setId)).toEqual(['p']); // el subset desaparece como fila propia
    expect(res.data[0].logoUrl).toBe(`${HOST}/cel25/logo.png`);
  });
});

describe('M-47 (B) — GET /buylist/sets expone logoUrl (fuente de la teja del COTIZADOR, §4.39.5)', () => {
  function catalogPricing(): PricingService {
    return { getPricedRawFinishesBatch: jest.fn(async () => new Map()) } as unknown as PricingService;
  }

  it('cada fila de data[] trae logoUrl (valor o `null` con clave presente)', async () => {
    let captured: any;
    const prisma: any = {
      cardSet: {
        findMany: jest.fn(async (args: any) => {
          captured = args;
          return [
            { id: 'sv8', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', logoUrl: LOGO, symbolUrl: SYMBOL },
            { id: 'basep', name: 'Promos', series: 'Base', releaseDate: '1999/07/01', logoUrl: null, symbolUrl: null },
          ];
        }),
      },
    };
    const svc = new CatalogService(prisma as PrismaService, catalogPricing());
    const res = await svc.listSetsWithImportedCards();

    expect(captured.select.logoUrl).toBe(true);
    expect(res.data[0]).toMatchObject({ id: 'sv8', logoUrl: LOGO });
    expect(res.data[1].logoUrl).toBeNull();
    expect('logoUrl' in res.data[1]).toBe(true);
    // Sin este campo la teja del cotizador sería la ÚNICA sin logo de todo el producto.
    for (const row of res.data) expect(Object.keys(row)).toContain('logoUrl');
  });
});

// ───────────────────────── (C) lo que NO debe llevar el campo ─────────────────────────

describe('M-47 (C) — symbolUrl SE PERSISTE Y NO SE EXPONE en ningún DTO (§4.39.5)', () => {
  it('MasterSetSummaryDTO no lo lleva (aunque la fila de Prisma lo traiga)', async () => {
    const prisma = masterSetPrisma();
    (prisma.cardSet.findMany as unknown as jest.Mock).mockResolvedValue(setRows);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.index({ page: 1, pageSize: 20, sort: 'release_desc' });
    for (const row of res.data) expect(Object.keys(row)).not.toContain('symbolUrl');
  });

  it('GET /buylist/sets no lo lleva (aunque la fila de Prisma lo traiga)', async () => {
    const prisma: any = {
      cardSet: {
        findMany: jest.fn(async () => [
          { id: 'sv8', name: 'Surging Sparks', series: 'SV', releaseDate: '2024/11/08', logoUrl: LOGO, symbolUrl: SYMBOL },
        ]),
      },
    };
    const svc = new CatalogService(
      prisma as PrismaService,
      { getPricedRawFinishesBatch: jest.fn(async () => new Map()) } as unknown as PricingService,
    );
    const res = await svc.listSetsWithImportedCards();
    expect(Object.keys(res.data[0])).not.toContain('symbolUrl');
  });
});

describe('M-47 (C) — logoUrl NO entra en las superficies que §4.39.5 PROHÍBE', () => {
  // Stubs que DEVUELVEN las columnas: si alguien las proyecta, estos tests se ponen rojos.
  const setWithImages = {
    id: 's-new',
    externalId: 'sv8',
    name: 'Surging Sparks',
    series: 'SV',
    releaseDate: '2024/11/08',
    logoUrl: LOGO,
    symbolUrl: SYMBOL,
  };

  function cardWithSet(over: any = {}) {
    return {
      id: 'c1',
      externalId: 'sv8-1',
      name: 'Pikachu',
      number: '1',
      rarity: 'Illustration Rare',
      supertype: 'Pokémon',
      subtypes: [],
      setId: 's-new',
      imageSmallUrl: null,
      imageLargeUrl: null,
      availableFinishes: ['normal'],
      set: setWithImages,
      ...over,
    };
  }

  function sellableItem(over: any = {}) {
    return {
      id: 'i1',
      cardId: 'c1',
      productType: 'raw',
      rawCondition: 'NM',
      sealedSubtype: null,
      gradingCompany: null,
      gradeValue: null,
      certNumber: null,
      status: 'listed',
      finish: 'normal',
      listPriceCents: 11500,
      createdAt: new Date('2026-08-01'),
      card: cardWithSet(),
      ...over,
    };
  }

  function storefrontPricing(): PricingService {
    return {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
      getPricedRawFinishesBatch: jest.fn(async () => new Map()),
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
      getReferencesBatch: jest.fn(async (items: any[]) => {
        const m = new Map<string, any>();
        for (const it of items) {
          m.set(`${it.cardId}|${it.productType}|${it.gradeKey}|${it.finish}`, {
            status: 'priced',
            referenceMxnCents: 10000,
          });
        }
        return m;
      }),
      loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
      sealedMarketGradeKeyForItem: jest.fn(() => null),
      getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
      gateSealedMarketCents: jest.fn(() => null),
      resolveSealedSalePrice: jest.fn(() => null),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
      loadGradedEstimateConfig: jest.fn(async () => ({
        enabled: false, grades: [], highlightGrades: [], freshnessDays: 30,
        minUpsidePct: 30, gradingCostTiers: [],
      })),
      getGradedEstimatesBatch: jest.fn(async () => new Map()),
    } as unknown as PricingService;
  }

  it('GET /catalog/facets → sets[] SIN logoUrl (chips de texto de la home, §5.3.2 hallazgo 7)', async () => {
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => [sellableItem()]) } };
    const svc = new CatalogService(prisma as PrismaService, storefrontPricing());
    const f = await svc.facets();
    expect(f.sets.length).toBeGreaterThan(0);
    for (const s of f.sets) {
      expect(Object.keys(s)).not.toContain('logoUrl');
      expect(Object.keys(s)).not.toContain('symbolUrl');
    }
  });

  it('GET /catalog/sets → data[] SIN logoUrl (hoy no alimenta ninguna retícula de tejas)', async () => {
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => [sellableItem()]) } };
    const svc = new CatalogService(prisma as PrismaService, storefrontPricing());
    const res = await svc.listSets();
    expect(res.data.length).toBeGreaterThan(0);
    for (const s of res.data) {
      expect(Object.keys(s)).not.toContain('logoUrl');
      expect(Object.keys(s)).not.toContain('symbolUrl');
    }
  });

  it('CardDTO SIN logoUrl (el set es metadata de la carta: ×60 bytes por rejilla para el mismo logo)', () => {
    const dto = toCardDTO(cardWithSet() as any);
    expect(dto.setName).toBe('Surging Sparks');
    expect(Object.keys(dto)).not.toContain('logoUrl');
    expect(Object.keys(dto)).not.toContain('symbolUrl');
  });

  it('GET /admin/catalog/remote-sets → data[] SIN logoUrl (espejo del PROVEEDOR, no selección de set)', async () => {
    const prisma: any = {
      cardSet: { findMany: jest.fn(async () => []) },
      card: { groupBy: jest.fn(async () => []) },
    };
    const client = {
      getSets: jest.fn(async () => [
        { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08', printedTotal: 191, images: { logo: LOGO, symbol: SYMBOL } },
      ]),
      getCardsBySet: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, syncSettings(), reconciler());
    const res = await svc.remoteSets();
    expect(res.data).toHaveLength(1);
    expect(Object.keys(res.data[0])).not.toContain('logoUrl');
    expect(Object.keys(res.data[0])).not.toContain('symbolUrl');
    expect(Object.keys(res.data[0])).not.toContain('images');
  });

  it('SetRefDTO (cabecera del binder) SIN logoUrl — es una cabecera, no una teja', async () => {
    const prisma = masterSetPrisma();
    // `findUnique` sin `select` rinde la FILA COMPLETA: las dos columnas nuevas están ahí.
    (prisma.cardSet.findUnique as unknown as jest.Mock).mockResolvedValue({
      id: 's1', externalId: 'sv8', name: 'Surging Sparks', series: 'SV',
      releaseDate: '2024/11/08', printedTotal: 191, logoUrl: LOGO, symbolUrl: SYMBOL,
    });
    (prisma.cardSet.findMany as unknown as jest.Mock).mockResolvedValue([]);
    (prisma.card.findMany as unknown as jest.Mock).mockResolvedValue([
      { id: 'c1', setId: 's1', number: '1', numberSort: 1, numberPrefix: '', name: 'Pikachu',
        rarity: 'Common', rarityCanonical: 'common', imageSmallUrl: null, availableFinishes: ['normal'] },
    ]);
    const svc = new MasterSetService(prisma, masterSetPricing());
    const res = await svc.binder('s1');
    expect(res.set.name).toBe('Surging Sparks');
    expect(Object.keys(res.set)).not.toContain('logoUrl');
    expect(Object.keys(res.set)).not.toContain('symbolUrl');
  });
});
