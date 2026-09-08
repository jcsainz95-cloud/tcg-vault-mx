import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { InventoryPublishPort } from '../src/modules/inventory/inventory-publish.port';
import { MX_HOLIDAYS } from '../src/common/business-days';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v1.51.18 — **BL-25 (el disparador (a), al convertir)** y **BL-26 (un `total` que mentía)**.
 *
 * BL-25 aquí es el lado del LLAMADOR: lo que se prueba es que `buylist` **pide**, no **ordena**, y
 * que la conversión **no puede fallar porque la publicación falle** — con su red nombrada
 * (`pending-publish`).
 *
 * BL-26 es un `total` que contaba el superconjunto mientras `data` iba filtrada: **páginas vacías al
 * final** y un número que **miente sobre el tamaño del trabajo pendiente**, que es lo único que una
 * cola existe para decir.
 */

const pii = new PiiCryptoService(new ConfigService({}));

// =============================================================================================
describe('⚠️ BL-25 — el disparador (a): `convert-to-inventory` PIDE, no ordena', () => {
  function build(opts: { port?: Partial<InventoryPublishPort>; alreadyConverted?: boolean } = {}) {
    const item: Record<string, unknown> = {
      id: 'sri-1',
      cardId: 'c1',
      card: { id: 'c1', name: 'Charizard', number: '4' },
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      cardProductId: null,
      itemStatus: opts.alreadyConverted ? 'convertida_inventario' : 'aprobada',
      inventoryItemId: opts.alreadyConverted ? 'inv-1' : null,
      offeredPriceCents: 42000,
      approvedPriceCents: null,
      quotedPriceCents: 40000,
    };
    const created: Record<string, unknown>[] = [];
    const prisma: any = {
      nextFolio: jest.fn(async () => 'INV-000001'),
      sellRequestItem: {
        findUnique: jest.fn(async () => item),
        update: jest.fn(async () => item),
      },
      inventoryItem: {
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { id: 'inv-1', folio: data.folio };
        }),
        findFirst: jest.fn(async () => ({ id: 'inv-1' })),
      },
      inventoryMovement: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const calls: string[][] = [];
    const port: InventoryPublishPort = {
      reevaluateForPublication: jest.fn(async (ids: string[]) => {
        calls.push(ids);
        return [{ inventoryItemId: ids[0], outcome: 'price_pending' as const, missing: ['price' as const], pendingPriceEntryId: 'ppe-9' }];
      }),
      ...(opts.port ?? {}),
    } as InventoryPublishPort;
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as unknown as PricingService,
      { getNumber: jest.fn(async () => 7) } as unknown as SettingsService,
      {} as UsersService,
      pii,
      undefined,
      undefined,
      port,
    );
    return { svc, prisma, port, calls, created };
  }

  it('convertir dispara la reevaluación y devuelve `pendingPublish` (deep-link desde M5)', async () => {
    const { svc, calls } = build();
    const res: any = await svc.convertToInventory('sri-1', 'op-1');
    expect(calls).toEqual([['inv-1']]);
    expect(res.pendingPublish).toEqual({ missing: ['price'], pendingPriceEntryId: 'ppe-9' });
  });

  it('⚠️ solo pasa el ID: no manda `status`, ni precio, ni estado destino', async () => {
    const { svc, port } = build();
    await svc.convertToInventory('sri-1', 'op-1');
    // La autoridad NO cruza la frontera: la llamada es *«reevalúa esto»*, y nada más.
    expect(port.reevaluateForPublication).toHaveBeenCalledWith(['inv-1']);
    expect((port.reevaluateForPublication as jest.Mock).mock.calls[0]).toHaveLength(1);
  });

  it('`locationId` es OPCIONAL y se propaga a la pieza cuando viene', async () => {
    const { svc, created } = build();
    await svc.convertToInventory('sri-1', 'op-1', 'loc-7');
    expect(created[0].locationId).toBe('loc-7');
  });

  it('⚠️ sin `locationId` la conversión NO se bloquea: atoraría el pago al vendedor', async () => {
    const { svc, created } = build();
    await expect(svc.convertToInventory('sri-1', 'op-1')).resolves.toBeDefined();
    expect(created[0].locationId).toBeUndefined();
  });

  it('⛔ y NUNCA acepta un precio de venta: no hay parámetro ni campo que pasar (D10, criterio 126)', () => {
    // *En todo el ciclo de buylist NO EXISTE ningún campo para capturar el precio de VENTA.* La
    // defensa es **la forma**, no una validación: verificar una ausencia solo se puede así.
    const svc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'buylist', 'buylist.service.ts'),
      'utf8',
    );
    const sig = svc.slice(svc.indexOf('async convertToInventory('));
    expect(sig.slice(sig.indexOf('(') + 1, sig.indexOf(')'))).toBe(
      'itemId: string, actorUserId: string, locationId?: string',
    );
    const dto = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'buylist', 'dto', 'buylist.dto.ts'),
      'utf8',
    );
    const body = dto.slice(dto.indexOf('class ConvertToInventoryDto'));
    expect(body.slice(0, body.indexOf('}'))).not.toMatch(/listPrice|priceCents/i);
  });

  it('⚠️⚠️ si el disparo LANZA, la conversión NO se revierte — ya está escrita', async () => {
    const { svc, created } = build({
      port: {
        reevaluateForPublication: jest.fn(async () => {
          throw new Error('inventory caído');
        }),
      },
    });
    const res: any = await svc.convertToInventory('sri-1', 'op-1');
    expect(created).toHaveLength(1);
    expect(res.inventoryItemId).toBe('inv-1');
  });

  it('⚠️ y el degradado dice «no sé», JAMÁS «ya está a la venta»', async () => {
    // Un `missing: []` inventado significaría *«se publicó sola»* y **sacaría la pieza de la única
    // pantalla donde se encontraría**. Se falla hacia visible.
    const { svc } = build({
      port: {
        reevaluateForPublication: jest.fn(async () => {
          throw new Error('inventory caído');
        }),
      },
    });
    const res: any = await svc.convertToInventory('sri-1', 'op-1');
    expect(res.pendingPublish.missing).toEqual(['location', 'price']);
    expect(res.pendingPublish.missing).not.toEqual([]);
  });

  it('sin puerto cableado tampoco truena, y también dice «no sé»', async () => {
    const svc = new BuylistService(
      {
        nextFolio: jest.fn(async () => 'INV-1'),
        sellRequestItem: {
          findUnique: jest.fn(async () => ({ id: 'sri-1', itemStatus: 'aprobada', inventoryItemId: null, cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'normal', cardProductId: null, offeredPriceCents: 1, approvedPriceCents: null, quotedPriceCents: 1, card: {} })),
          update: jest.fn(async () => ({})),
        },
        inventoryItem: { create: jest.fn(async () => ({ id: 'inv-1', folio: 'INV-1' })) },
        inventoryMovement: { create: jest.fn(async () => ({})) },
        $transaction: jest.fn(async (cb: any) => cb({
          inventoryItem: { create: jest.fn(async () => ({ id: 'inv-1', folio: 'INV-1' })) },
          inventoryMovement: { create: jest.fn(async () => ({})) },
          sellRequestItem: { update: jest.fn(async () => ({})) },
        })),
      } as unknown as PrismaService,
      {} as unknown as PricingService,
      {} as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    const res: any = await svc.convertToInventory('sri-1', 'op-1');
    expect(res.pendingPublish.missing).toEqual(['location', 'price']);
  });

  it('⚠️ el REPLAY también dispara y también trae el deep-link', async () => {
    // Si solo lo trajera la primera conversión, M5 perdería el enlace justo en el reintento — que es
    // cuando el operador está buscando qué pasó. Y el puerto es idempotente: re-disparar es gratis y
    // recupera un disparo perdido en la llamada original.
    const { svc, calls } = build({ alreadyConverted: true });
    const res: any = await svc.convertToInventory('sri-1', 'op-1');
    expect(res.alreadyConverted).toBe(true);
    expect(calls).toEqual([['inv-1']]);
    expect(res.pendingPublish.pendingPriceEntryId).toBe('ppe-9');
  });
});

// =============================================================================================
describe('⚠️⚠️ BL-26 — el `total` cuenta EXACTAMENTE lo que `data` pagina', () => {
  /** `n` filas, de las que las `alerted` primeras llevan esperando mucho (⇒ alerta). */
  function build(total: number, alerted: number, now = new Date('2026-09-01T12:00:00Z')) {
    jest.useFakeTimers().setSystemTime(now);
    const rows = Array.from({ length: total }, (_, i) => ({
      id: `sr-${i}`,
      user: { id: 'u', name: 'Ash', email: 'a@e.mx', phone: null },
      // Las primeras `alerted` declararon hace mucho; el resto, hoy.
      sellerShippedDeclaredAt: i < alerted ? new Date('2026-08-01T12:00:00Z') : now,
      shipDeadlineAt: null,
      shipmentCarrier: null,
      shipmentTrackingNumber: null,
    }));
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async ({ skip, take }: any) =>
          skip == null ? rows : rows.slice(skip, skip + take),
        ),
        count: jest.fn(async () => rows.length),
      },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as unknown as PricingService,
      { getNumber: jest.fn(async () => 5) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    return { svc, prisma };
  }
  afterEach(() => jest.useRealTimers());

  it('⚠️ con `onlyAlerts` el `total` es el de las filas EN ALERTA, no el de la cola completa', async () => {
    const { svc } = build(10, 3);
    const res: any = await svc.adminPendingShipmentConfirmation(1, 20, true);
    // Antes devolvía `total: 10` con 3 filas: el cliente paginaba un conjunto que no existe.
    expect(res.data).toHaveLength(3);
    expect(res.total).toBe(3);
  });

  it('⚠️ y NO hay páginas vacías al final', async () => {
    const { svc } = build(10, 3);
    const p2: any = await svc.adminPendingShipmentConfirmation(2, 2, true);
    expect(p2.total).toBe(3);
    expect(p2.data).toHaveLength(1);
    // La página 3 no existiría: `ceil(3/2) = 2`. Antes `ceil(10/2) = 5` ⇒ tres páginas vacías.
    expect(Math.ceil(p2.total / 2)).toBe(2);
  });

  it('la paginación del subconjunto no solapa ni pierde filas', async () => {
    const { svc } = build(12, 5);
    const p1: any = await svc.adminPendingShipmentConfirmation(1, 2, true);
    const p2: any = await svc.adminPendingShipmentConfirmation(2, 2, true);
    const p3: any = await svc.adminPendingShipmentConfirmation(3, 2, true);
    const ids = [...p1.data, ...p2.data, ...p3.data].map((r: any) => r.sellRequestId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('SIN `onlyAlerts` sigue paginando en SQL y contando en SQL (no se barre de más)', async () => {
    const { svc, prisma } = build(10, 3);
    const res: any = await svc.adminPendingShipmentConfirmation(1, 4);
    expect(res.total).toBe(10);
    expect(res.data).toHaveLength(4);
    // El `count` de SQL es el barato y aquí es el correcto: `data` y `total` ya coinciden.
    expect(prisma.sellRequest.count).toHaveBeenCalled();
    expect(prisma.sellRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 }),
    );
  });

  it('con `onlyAlerts` NO se usa el `count` de SQL: contaría el superconjunto', async () => {
    const { svc, prisma } = build(10, 3);
    await svc.adminPendingShipmentConfirmation(1, 20, true);
    expect(prisma.sellRequest.count).not.toHaveBeenCalled();
  });

  it('cero alertas ⇒ `total: 0` y `data: []` (y no «10 pendientes» que no existen)', async () => {
    const { svc } = build(10, 0);
    const res: any = await svc.adminPendingShipmentConfirmation(1, 20, true);
    expect(res.total).toBe(0);
    expect(res.data).toEqual([]);
  });

  it('⚠️ BL-22 sigue vivo: la fila sin calendario CUENTA como alerta (falla hacia visible)', async () => {
    // La fila más rara no puede ser la más escondida: si `businessDaysSince` lanza, `alert: true` —
    // y por tanto **entra** en `?onlyAlerts=true` y **suma al `total`**.
    const outOfRange = new Date('2019-01-10T12:00:00Z');
    // El calendario NO cubre 2019 ⇒ `businessDaysSince` LANZA, que es la doctrina (§4.39k.1).
    expect(Math.min(...Object.keys(MX_HOLIDAYS).map(Number))).toBeGreaterThan(2019);
    const { svc } = build(3, 0);
    const prisma: any = (svc as unknown as { prisma: any }).prisma;
    (prisma.sellRequest.findMany as jest.Mock).mockImplementation(async () => [
      {
        id: 'sr-raro',
        user: { id: 'u', name: 'Ash', email: 'a@e.mx', phone: null },
        sellerShippedDeclaredAt: outOfRange,
        shipDeadlineAt: null,
        shipmentCarrier: null,
        shipmentTrackingNumber: null,
      },
    ]);
    const res: any = await svc.adminPendingShipmentConfirmation(1, 20, true);
    expect(res.total).toBe(1);
    expect(res.data[0].businessDaysUnavailable).toBe(true);
    expect(res.data[0].alert).toBe(true);
  });
});
