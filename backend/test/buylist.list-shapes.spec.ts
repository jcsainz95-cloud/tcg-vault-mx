import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * QA-BUG regresión: las vistas de buylist (BuylistView del comprador y M5View del
 * back-office) crasheaban porque las RESPUESTAS DE LISTA no incluían las relaciones
 * que el contrato/frontend esperan:
 *  - `listMine` (GET /buylist/requests) devolvía filas Prisma crudas SIN `items`
 *    (→ `r.items.map` = TypeError) y con `id` en vez de `sellRequestId`.
 *  - `adminList` (GET /admin/buylist) incluía `items` SIN `card` (→ `it.card.name`
 *    = TypeError).
 * Estos tests fijan el SHAPE de ambas listas para que un `include` faltante lo atrape
 * un test unitario y no el runtime.
 */

function buildService(prisma: any): BuylistService {
  return new BuylistService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    {
      // v1.51.14 · BL-22: `adminList` deriva `offerIssueDeadlineAt` y para eso lee el dial de
      // emisión. Un `{}` aquí ya no basta.
      getNumber: jest.fn(async () => 7),
    } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
}

// Fila tal cual la devuelve Prisma con `include: { items: { include: { card: true } }, user }`.
function fakeRow(id: string) {
  return {
    id,
    userId: 'user-1',
    // v1.18-buylist-rejects: join a User para `seller: AdminSellerRef` en adminList/adminGet.
    user: { id: 'user-1', name: 'Ash Ketchum', email: 'ash@example.com' },
    status: 'cotizada',
    quotedTotalCents: 5000,
    approvedTotalCents: null,
    ineRequired: false,
    createdAt: new Date('2026-08-16T00:00:00Z'),
    items: [
      {
        id: `${id}-it-0`,
        cardId: 'card-1',
        card: { id: 'card-1', name: 'Pidgey', number: '16' },
        productType: 'raw',
        rawCondition: 'NM',
        rarity: 'Common',
        priceBasis: 'market',
        quotedPriceCents: 5000,
        approvedPriceCents: null,
        itemStatus: 'cotizada',
        inventoryItemId: null,
      },
    ],
  };
}

describe('BuylistService.listMine — shape SellRequestDTO', () => {
  it('devuelve `items` (con `card`) y `sellRequestId` (no `id` crudo)', async () => {
    const findMany = jest.fn().mockResolvedValue([fakeRow('sr-1')]);
    const service = buildService({ sellRequest: { findMany } });

    const res = await service.listMine('user-1');

    // El `include` de items+card debe estar presente en la consulta (si falta, el
    // frontend crashea en runtime). Este assert lo fija a nivel de test.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { items: { include: { card: true } } },
      }),
    );

    const row: any = res.data[0];
    // Shape del contrato: sellRequestId (no id crudo) + items[] con card.
    expect(row.sellRequestId).toBe('sr-1');
    expect(row.id).toBeUndefined();
    expect(Array.isArray(row.items)).toBe(true);
    expect(row.items[0].card).toEqual({ id: 'card-1', name: 'Pidgey', number: '16' });
    // Campos SellItemDTO derivados: rarity + (v2.0, P-48) `priceBasis` en vez de `appliedRule`.
    expect(row.items[0].rarity).toBe('Common');
    expect(row.items[0].priceBasis).toBe('market');
    expect((row.items[0] as Record<string, unknown>).appliedRule).toBeUndefined();
    expect(row.status).toBe('cotizada');
    expect(row.quotedTotalCents).toBe(5000);
    expect(row.ineRequired).toBe(false);
  });
});

describe('BuylistService.adminList — shape AdminBuylistDTO', () => {
  it('devuelve `items[].card` (CardDTO), conserva id/userId y expone `seller` (v1.18)', async () => {
    const findMany = jest.fn().mockResolvedValue([fakeRow('sr-1')]);
    const count = jest.fn().mockResolvedValue(1);
    const service = buildService({ sellRequest: { findMany, count } });

    const res = await service.adminList(undefined, 1, 20);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          items: { include: { card: true } },
          // v1.18: join a User para AdminSellerRef (solo id/name/email — nunca passwordHash etc.).
          // v1.51 · BL-15 (D12): el `select` gana `phone` — el teléfono viaja EN LA FILA para poder
          // llamar desde la solicitud. Mismo régimen PII que el correo; PROHIBIDO en el buscador `q`.
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      }),
    );

    const row: any = res.data[0];
    expect(row.id).toBe('sr-1');
    expect(row.userId).toBe('user-1');
    // v1.18: identidad del vendedor (seller.id === userId; email SIN enmascarar — no es la CLABE).
    // v1.51 · BL-15 (D12): `AdminSellerRef` gana `phone` — back-office por rol, sin enmascarar.
    expect(row.seller).toEqual({
      id: 'user-1',
      name: 'Ash Ketchum',
      email: 'ash@example.com',
      phone: null,
    });
    // La cola M5 lee it.card.name → card debe venir poblado.
    expect(row.items[0].card).toEqual({ id: 'card-1', name: 'Pidgey', number: '16' });
    expect(row.items[0].card.name).toBe('Pidgey');
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(20);
  });

  it('ordena por createdAt DESC (norma v1.18; antes asc)', async () => {
    const findMany = jest.fn().mockResolvedValue([fakeRow('sr-1')]);
    const count = jest.fn().mockResolvedValue(1);
    const service = buildService({ sellRequest: { findMany, count } });

    await service.adminList(undefined, 1, 20);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });
});
