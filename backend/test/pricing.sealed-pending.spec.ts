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
 * v1.42 (BLOQ-2b, M-40, §4.34a) — la cola de precio pendiente M2 gana identidad de SELLADO:
 *  - `escalatePending` mete `sealedProductId` en la CLAVE lógica de dedupe (junto a finish/cardProductId):
 *    dos pendientes de sellado con distinto sealedProductId (ETB vs blíster) NO colapsan.
 *  - `pendingQueue` resuelve el display (`sealedProductName` cascada §4.34a → «ETB …», no «sealed»),
 *    presente SOLO para productType='sealed'. Money-safe: identidad/display, no dinero.
 */
function build(pendingRows: any[] = []) {
  const findFirstCalls: any[] = [];
  const createCalls: any[] = [];
  const findManyCalls: any[] = [];
  const prisma: any = {
    pendingPriceEntry: {
      // v2.1 (§4.36.5c): `pendingQueue` agrega los counts por motivo en el MISMO snapshot.
      groupBy: jest.fn(async () => []),
      findFirst: jest.fn(async (args: any) => {
        findFirstCalls.push(args);
        return null; // no hay pendiente abierto que colisione
      }),
      create: jest.fn(async (args: any) => {
        createCalls.push(args);
        return { id: 'pending-new' };
      }),
      findMany: jest.fn(async (args: any) => {
        findManyCalls.push(args);
        return pendingRows;
      }),
    },
  };
  const svc = new PricingService(
    prisma as PrismaService,
    {} as SettingsService,
    {} as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  return { svc, findFirstCalls, createCalls, findManyCalls };
}

describe('escalatePending — sealedProductId entra a la clave de dedupe (ETB y blíster no colapsan)', () => {
  it('encola con sealedProductId en el where del findFirst y en la fila creada', async () => {
    const { svc, findFirstCalls, createCalls } = build();
    await svc.escalatePending('c1', 'sealed', 'sealed', 'inventory', undefined, 'normal', null, 'sp_etb');
    expect(findFirstCalls[0].where).toMatchObject({ sealedProductId: 'sp_etb', status: 'open' });
    expect(createCalls[0].data).toMatchObject({ sealedProductId: 'sp_etb' });
  });

  it('default null (raw/graded o sellado legacy): retrocompatible', async () => {
    const { svc, findFirstCalls, createCalls } = build();
    await svc.escalatePending('c1', 'raw', 'raw:NM', 'buylist', undefined, 'normal');
    expect(findFirstCalls[0].where.sealedProductId).toBeNull();
    expect(createCalls[0].data.sealedProductId).toBeNull();
  });

  it('dos presentaciones (ETB vs blíster) del mismo (cardId, gradeKey, finish) NO colapsan: cada una busca su clave', async () => {
    const { svc, findFirstCalls } = build();
    // Nota: el gradeKey de mercado difiere por productId (sealed:tcg:<id>), pero incluso bajo el MISMO
    // gradeKey legacy 'sealed' el sealedProductId separa las dos entradas.
    await svc.escalatePending('c1', 'sealed', 'sealed', 'inventory', undefined, 'normal', null, 'sp_etb');
    await svc.escalatePending('c1', 'sealed', 'sealed', 'inventory', undefined, 'normal', null, 'sp_blister');
    expect(findFirstCalls[0].where.sealedProductId).toBe('sp_etb');
    expect(findFirstCalls[1].where.sealedProductId).toBe('sp_blister');
    expect(findFirstCalls[0].where.sealedProductId).not.toBe(findFirstCalls[1].where.sealedProductId);
  });
});

describe('pendingQueue — display de identidad de sellado (cascada §4.34a)', () => {
  const sealedRow = {
    id: 'p-sealed',
    cardId: 'c1',
    productType: 'sealed',
    gradeKey: 'sealed:tcg:42',
    finish: 'normal',
    cardProductId: null,
    sealedProductId: 'sp_etb',
    context: 'inventory',
    refId: null,
    status: 'open',
    resolvedPriceRefId: null,
    createdAt: new Date('2026-08-23T00:00:00Z'),
    resolvedAt: null,
    card: { id: 'c1', name: 'Tropius', number: '1', set: { id: 's1', name: 'Obsidian Flames' } },
    sealedProduct: { id: 'sp_etb', name: 'Obsidian Flames Elite Trainer Box', subtype: 'etb' },
  };

  it('el findMany incluye sealedProduct', async () => {
    const { svc, findManyCalls } = build([sealedRow]);
    await svc.pendingQueue();
    expect(findManyCalls[0].include).toEqual({ card: { include: { set: true } }, sealedProduct: true });
  });

  it('un pendiente de sellado muestra el nombre del PRODUCTO (ETB), no «sealed» ni la carta ancla', async () => {
    const { svc } = build([sealedRow]);
    const { data } = await svc.pendingQueue();
    const row = data[0] as any;
    expect(row.sealedProductId).toBe('sp_etb');
    expect(row.sealedProductName).toBe('Obsidian Flames Elite Trainer Box');
    expect(row.sealedProductName).not.toBe('Tropius');
    expect(row.sealedSubtype).toBe('etb');
  });

  it('sellado legacy sin sealedProduct → nombre cae a Card.name (nunca null); sigue pendiente', async () => {
    const legacy = { ...sealedRow, sealedProductId: null, sealedProduct: null };
    const { svc } = build([legacy]);
    const row = (await svc.pendingQueue()).data[0] as any;
    expect(row.sealedProductId).toBeNull();
    expect(row.sealedProductName).toBe('Tropius'); // fallback Card.name
    expect(row.sealedSubtype).toBeNull();
  });

  it('un pendiente RAW NO trae campos de sellado (ausentes)', async () => {
    const rawRow = {
      ...sealedRow,
      productType: 'raw',
      gradeKey: 'raw:NM',
      sealedProductId: null,
      sealedProduct: null,
    };
    const { svc } = build([rawRow]);
    const row = (await svc.pendingQueue()).data[0] as any;
    // `sealedProductId` es COLUMNA del modelo (como `cardProductId`): se espeja siempre, null para raw
    // (el contrato admite «null/ausentes» en raw/graded). Los campos RESUELTOS (nombre/subtipo) NO se
    // añaden para raw (solo se computan para sellado por la cascada §4.34a).
    expect(row.sealedProductId).toBeNull();
    expect('sealedProductName' in row).toBe(false);
    expect('sealedSubtype' in row).toBe(false);
  });
});
