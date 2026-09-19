import { CatalogSyncService } from '../src/modules/catalog/catalog-sync.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PokemonTcgIoClient } from '../src/modules/catalog/pokemontcg-io.client';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * DECKS-META §2.2 (Fase 0) — `upsertCards` mapea la LEGALIDAD del payload de pokemontcg.io
 * (`regulationMark` + `legalities.standard`) a las dos columnas nuevas, con **NO-DEGRADACIÓN**
 * (patrón vivo de `logoUrl`/`tcgplayerId`): campo ausente en el payload ⇒ la clave NO viaja en el
 * `update` ⇒ Prisma deja la columna intacta. Presente ⇒ se guarda. Coste de red = CERO: el
 * endpoint `GET /v2/cards` no usa `select=`, así que estos campos YA venían en el JSON y hoy se
 * descartan (M3) — la fixture de abajo reproduce ese payload; NUNCA se toca la red (M9, O-17).
 */
describe('CatalogSyncService.upsertCards — mapeo de legalidad con NO-DEGRADACIÓN (§2.2)', () => {
  function buildPrisma() {
    return {
      cardSet: {
        upsert: jest.fn(async () => ({ id: 'local-sv8', externalId: 'sv8' })),
        findMany: jest.fn(async () => []),
      },
      card: {
        upsert: jest.fn(async ({ where }: any) => ({ id: where.externalId, availableFinishes: ['normal'] })),
        count: jest.fn(async () => 0),
      },
    } as any;
  }
  function settings(): SettingsService {
    return { getString: jest.fn(async () => '2024/01/01') } as unknown as SettingsService;
  }
  function reconcilerMock() {
    return { reconcile: jest.fn(async () => 0) };
  }

  function remoteCard(id: string, over: Record<string, unknown> = {}) {
    return {
      id,
      name: `Card ${id}`,
      number: '1',
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: [],
      images: { small: 's', large: 'l' },
      set: { id: 'sv8', name: 'Surging Sparks', releaseDate: '2024/11/08' },
      ...over,
    };
  }

  async function upsertCallFor(remote: Record<string, unknown>) {
    const prisma = buildPrisma();
    const client = {
      getCardsBySet: jest.fn(async () => ({
        data: [remote],
        page: 1,
        pageSize: 250,
        count: 1,
        totalCount: 1,
      })),
      getSets: jest.fn(),
    } as unknown as PokemonTcgIoClient;
    const svc = new CatalogSyncService(prisma as PrismaService, client, settings(), reconcilerMock() as any);
    await svc.sync('sv8');
    return prisma.card.upsert.mock.calls[0][0];
  }

  it('PRESENTE: regulationMark + legalities.standard se guardan en CREATE y UPDATE', async () => {
    const call = await upsertCallFor(
      remoteCard('sv8-1', { regulationMark: 'H', legalities: { standard: 'Legal' } }),
    );
    expect(call.create).toMatchObject({ regulationMark: 'H', legalStandardRaw: 'Legal' });
    expect(call.update).toMatchObject({ regulationMark: 'H', legalStandardRaw: 'Legal' });
  });

  it('PRESENTE con ban explícito: legalStandardRaw = "Banned" se guarda (banda de seguridad §2.3)', async () => {
    const call = await upsertCallFor(
      remoteCard('sv8-2', { regulationMark: 'G', legalities: { standard: 'Banned' } }),
    );
    expect(call.create).toMatchObject({ regulationMark: 'G', legalStandardRaw: 'Banned' });
    expect(call.update).toMatchObject({ regulationMark: 'G', legalStandardRaw: 'Banned' });
  });

  it('AUSENTE en UPDATE: la clave NO viaja ⇒ Prisma deja la columna intacta (no clobbea con null)', async () => {
    // Payload sin regulationMark ni legalities (promo/set viejo o campo no poblado aún): un re-sync
    // NO debe poder borrar lo que ya sabíamos. La clave se OMITE del update (igual que logoUrl).
    const call = await upsertCallFor(remoteCard('sv8-3'));
    expect(call.update).not.toHaveProperty('regulationMark');
    expect(call.update).not.toHaveProperty('legalStandardRaw');
  });

  it('AUSENTE en CREATE: no se inventa valor (la columna nace null; regulationMark null ⇒ no legal §2.3)', async () => {
    const call = await upsertCallFor(remoteCard('sv8-3'));
    // create tampoco fija un valor falso; ausente ⇒ columna nullable nace en null.
    expect(call.create.regulationMark ?? null).toBeNull();
    expect(call.create.legalStandardRaw ?? null).toBeNull();
  });

  it('cadena vacía / whitespace se trata como AUSENTE (no viaja en update, no ensucia la columna)', async () => {
    const call = await upsertCallFor(
      remoteCard('sv8-4', { regulationMark: '   ', legalities: { standard: '' } }),
    );
    expect(call.update).not.toHaveProperty('regulationMark');
    expect(call.update).not.toHaveProperty('legalStandardRaw');
  });

  it('legalities presente pero SIN standard (solo expanded/unlimited): legalStandardRaw no viaja', async () => {
    const call = await upsertCallFor(
      remoteCard('sv8-5', { regulationMark: 'H', legalities: { expanded: 'Legal' } }),
    );
    expect(call.update).toMatchObject({ regulationMark: 'H' });
    expect(call.update).not.toHaveProperty('legalStandardRaw');
  });
});
