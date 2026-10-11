import { Prisma } from '@prisma/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { BusinessException } from '../src/common/business.exception';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { assertOperable } from '../src/modules/inventory/item-location.rules';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * Guardas de `move` y `mark` (M1). *El defecto, medido por techlead y QA sobre `16a3170`:* ninguno de
 * los dos verbos miraba el estado de la pieza ni la zona del destino. El API aceptaba mover la carta
 * DE UN CLIENTE, en un retiro cobrado, al estante de tienda, y marcar perdida una pieza en `picking`
 * de un pedido cobrado. Estas pruebas fallan contra el `moveItem`/`markItem` anterior.
 */

type Row = {
  id: string;
  folio: string;
  status: string;
  ownerType: 'platform' | 'customer';
  ownerUserId: string | null;
  ownershipStatus: 'pending' | 'settled' | null;
  locationId: string | null;
};

type Loc = { id: string; label: string; zone: 'platform_stock' | 'customer_custody'; isActive: boolean };

const LOCS: Loc[] = [
  { id: 'shelf-1', label: 'EST-1', zone: 'platform_stock', isActive: true },
  { id: 'shelf-2', label: 'EST-2', zone: 'platform_stock', isActive: true },
  { id: 'shelf-off', label: 'EST-X', zone: 'platform_stock', isActive: false },
  { id: 'drawer-ana-1', label: 'CAJ-A1', zone: 'customer_custody', isActive: true },
  { id: 'drawer-ana-2', label: 'CAJ-A2', zone: 'customer_custody', isActive: true },
  { id: 'drawer-beto', label: 'CAJ-B', zone: 'customer_custody', isActive: true },
  { id: 'drawer-empty', label: 'CAJ-E', zone: 'customer_custody', isActive: true },
];

function platform(id: string, status: string, locationId: string | null = 'shelf-1'): Row {
  return { id, folio: `INV-${id}`, status, ownerType: 'platform', ownerUserId: null, ownershipStatus: null, locationId };
}
function customer(id: string, user: string, locationId: string | null, over: Partial<Row> = {}): Row {
  return {
    id,
    folio: `INV-${id}`,
    status: 'in_custody',
    ownerType: 'customer',
    ownerUserId: user,
    ownershipStatus: 'settled',
    locationId,
    ...over,
  };
}

/** Piezas de fondo: Ana tiene cartas en dos cajones (anomalía que el `move` consolida); Beto en uno. */
const BACKGROUND: Row[] = [
  customer('ana-x', 'ana', 'drawer-ana-1'),
  customer('ana-y', 'ana', 'drawer-ana-2'),
  customer('beto-x', 'beto', 'drawer-beto'),
];

function build(target: Row, opts: { activeWithdrawal?: boolean } = {}) {
  const rows: Row[] = [target, ...BACKGROUND.map((r) => ({ ...r }))];
  const log: string[] = [];
  // El cliente de la transacción es un objeto DISTINTO del raíz: una escritura hecha con
  // `this.prisma` dentro del callback se registra sin `@tx` (y la prueba de atomicidad la ve).
  const matches = (r: Row, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (k === 'id') return r.id === v;
      if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes((r as any)[k]);
      if (v && typeof v === 'object') return true; // relación (p.ej. `location`): la filtra el groupBy
      return (r as any)[k] === v;
    });
  const client = (inTx: boolean): any => ({
    $executeRaw: jest.fn(async () => {
      log.push(`gate${inTx ? '@tx' : ''}`);
      return 1;
    }),
    inventoryItem: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) return null;
        return include?.location ? { ...r, location: LOCS.find((l) => l.id === r.locationId) ?? null } : { ...r };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r || !matches(r, where)) {
          throw new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
            code: 'P2025',
            clientVersion: 'test',
          });
        }
        log.push(`update${inTx ? '@tx' : ''}`);
        Object.assign(r, data);
        return { ...r };
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
      groupBy: jest.fn(async ({ where }: any) => {
        const out = new Map<string, { ownerUserId: string; locationId: string; _count: { _all: number } }>();
        for (const r of rows) {
          if (!matches(r, { ...where, ownerUserId: undefined, location: undefined })) continue;
          if (!where.ownerUserId.in.includes(r.ownerUserId)) continue;
          const loc = LOCS.find((l) => l.id === r.locationId);
          if (!loc || loc.zone !== 'customer_custody') continue;
          const k = `${r.ownerUserId}|${r.locationId}`;
          const g = out.get(k) ?? { ownerUserId: r.ownerUserId!, locationId: r.locationId!, _count: { _all: 0 } };
          g._count._all++;
          out.set(k, g);
        }
        return [...out.values()];
      }),
    },
    vaultLocation: {
      findUnique: jest.fn(async ({ where }: any) => LOCS.find((l) => l.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any) => LOCS.filter((l) => where.id.in.includes(l.id))),
    },
    shipmentItem: {
      findMany: jest.fn(async ({ where }: any) =>
        opts.activeWithdrawal && where.inventoryItemId.in.includes(target.id)
          ? [{ inventoryItemId: target.id, shipmentRequest: { id: 'sh-1', status: 'picking' } }]
          : [],
      ),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        log.push(`movement${inTx ? '@tx' : ''}`);
        return data;
      }),
    },
  });
  const tx = client(true);
  const prisma: any = client(false);
  prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
  const svc = new InventoryService(
    prisma as PrismaService,
    {} as PricingService,
    { ...ivaDialsStub(), getNumber: jest.fn() } as unknown as SettingsService,
  );
  // El disparador de publicación tiene sus propias pruebas (inventory.pending-publish.spec.ts).
  jest.spyOn(svc as any, 'tryAutoPublish').mockResolvedValue(undefined);
  return { svc, prisma, tx, rows, log };
}

async function err(p: Promise<unknown>): Promise<BusinessException> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(BusinessException);
  return e as BusinessException;
}

const TERMINAL = ['shipped', 'delivered', 'lost', 'damaged', 'withdrawn'];

// =============================================================================================
describe('move — pieza de PLATAFORMA', () => {
  it.each(['in_stock', 'listed', 'reserved', 'picking'])('%s → estante de tienda: se mueve', async (status) => {
    const { svc, rows } = build(platform('p', status));
    await svc.moveItem('p', { toLocationId: 'shelf-2' }, 'op-1');
    expect(rows[0].locationId).toBe('shelf-2');
    expect(rows[0].status).toBe(status);
  });

  it.each(['in_stock', 'listed', 'picking'])(
    '⛔ %s → cajón de cliente ⇒ 422 LOCATION_NOT_AVAILABLE not_platform_stock, sin escribir',
    async (status) => {
      const { svc, rows, log } = build(platform('p', status));
      const e = await err(svc.moveItem('p', { toLocationId: 'drawer-empty' }, 'op-1'));
      expect(e.code).toBe('LOCATION_NOT_AVAILABLE');
      expect(e.getStatus()).toBe(422);
      expect(e.details).toMatchObject({ reason: 'not_platform_stock' });
      expect(rows[0].locationId).toBe('shelf-1');
      expect(log).toEqual([]);
    },
  );

  it.each(TERMINAL)('⛔ %s (terminal) ⇒ 422 ITEM_NOT_ADJUSTABLE, sin escribir', async (status) => {
    const { svc, rows, log } = build(platform('p', status));
    const e = await err(svc.moveItem('p', { toLocationId: 'shelf-2' }, 'op-1'));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.getStatus()).toBe(422);
    expect(e.details).toMatchObject({ status });
    expect(rows[0].locationId).toBe('shelf-1');
    expect(log).toEqual([]);
  });

  it('⛔ destino inexistente ⇒ 422 not_found; inactivo ⇒ 422 inactive', async () => {
    const a = build(platform('p', 'in_stock'));
    expect((await err(a.svc.moveItem('p', { toLocationId: 'nope' }, 'op-1'))).details).toMatchObject({
      reason: 'not_found',
    });
    const b = build(platform('p', 'in_stock'));
    expect((await err(b.svc.moveItem('p', { toLocationId: 'shelf-off' }, 'op-1'))).details).toMatchObject({
      reason: 'inactive',
    });
    expect(a.log).toEqual([]);
    expect(b.log).toEqual([]);
  });

  it('pieza inexistente ⇒ 404', async () => {
    const { svc } = build(platform('p', 'in_stock'));
    expect((await err(svc.moveItem('fantasma', { toLocationId: 'shelf-2' }, 'op-1'))).getStatus()).toBe(404);
  });
});

// =============================================================================================
describe('move — pieza DEL CLIENTE', () => {
  it('⛔ (QA) en un retiro cobrado → estante de tienda: rechazado y la carta NO se mueve', async () => {
    const { svc, rows, log } = build(customer('c', 'ana', 'drawer-ana-1'), { activeWithdrawal: true });
    const e = await err(svc.moveItem('c', { toLocationId: 'shelf-1' }, 'op-1'));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('ITEM_IN_ANOTHER_SHIPMENT');
    expect(rows[0].locationId).toBe('drawer-ana-1');
    expect(log.filter((l) => l !== 'gate@tx')).toEqual([]);
  });

  it('⛔ en un retiro cobrado, ni siquiera a su propio cajón (se opera desde el envío)', async () => {
    const { svc, rows } = build(customer('c', 'ana', 'drawer-ana-1'), { activeWithdrawal: true });
    const e = await err(svc.moveItem('c', { toLocationId: 'drawer-ana-2' }, 'op-1'));
    expect(e.code).toBe('ITEM_IN_ANOTHER_SHIPMENT');
    expect(rows[0].locationId).toBe('drawer-ana-1');
  });

  it('⛔ sin retiro → estante de tienda ⇒ 422 not_customer_custody', async () => {
    const { svc, rows, log } = build(customer('c', 'ana', 'drawer-ana-1'));
    const e = await err(svc.moveItem('c', { toLocationId: 'shelf-1' }, 'op-1'));
    expect(e.code).toBe('LOCATION_NOT_AVAILABLE');
    expect(e.details).toMatchObject({ reason: 'not_customer_custody' });
    expect(rows[0].locationId).toBe('drawer-ana-1');
    expect(log.filter((l) => l !== 'gate@tx')).toEqual([]);
  });

  it('⛔ → cajón de OTRO cliente ⇒ 422 not_customer_drawer con los cajones del dueño', async () => {
    const { svc, rows } = build(customer('c', 'ana', 'drawer-ana-1'));
    const e = await err(svc.moveItem('c', { toLocationId: 'drawer-beto' }, 'op-1'));
    expect(e.details).toMatchObject({ reason: 'not_customer_drawer' });
    const ids = ((e.details.customerDrawers as Array<{ id: string }>) ?? []).map((d) => d.id);
    expect(ids).toEqual(['drawer-ana-1', 'drawer-ana-2']);
    expect(rows[0].locationId).toBe('drawer-ana-1');
  });

  it('⛔ → cajón vacío (no es de nadie): la primera colocación es del `confirm`, no del `move`', async () => {
    const { svc } = build(customer('c', 'ana', 'drawer-ana-1'));
    const e = await err(svc.moveItem('c', { toLocationId: 'drawer-empty' }, 'op-1'));
    expect(e.details).toMatchObject({ reason: 'not_customer_drawer' });
  });

  it('✅ consolidar: a OTRO cajón del MISMO cliente se mueve, bajo la puerta del cliente', async () => {
    const { svc, rows, log } = build(customer('c', 'ana', 'drawer-ana-1'));
    await svc.moveItem('c', { toLocationId: 'drawer-ana-2' }, 'op-1');
    expect(rows[0].locationId).toBe('drawer-ana-2');
    expect(rows[0].status).toBe('in_custody');
    expect(log[0]).toBe('gate@tx');
  });

  it.each([
    ['pending (no liquidada)', { ownershipStatus: 'pending' as const }],
    ['delivered', { status: 'delivered' }],
    ['withdrawn', { status: 'withdrawn' }],
    ['lost', { status: 'lost' }],
    ['picking', { status: 'picking' }],
  ])('⛔ pieza de cliente %s ⇒ 422 ITEM_NOT_ADJUSTABLE', async (_n, over) => {
    const { svc, rows } = build(customer('c', 'ana', 'drawer-ana-1', over));
    const e = await err(svc.moveItem('c', { toLocationId: 'drawer-ana-2' }, 'op-1'));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(rows[0].locationId).toBe('drawer-ana-1');
  });
});

// =============================================================================================
describe('move — una sola transacción, guarda atómica y respuesta con ubicación', () => {
  it('el movimiento y el update van en la MISMA transacción', async () => {
    const { svc, log } = build(platform('p', 'in_stock'));
    await svc.moveItem('p', { toLocationId: 'shelf-2' }, 'op-1');
    expect(log.filter((l) => l.startsWith('update') || l.startsWith('movement'))).toEqual([
      'update@tx',
      'movement@tx',
    ]);
  });

  it('el movimiento registra origen y destino', async () => {
    const { svc, tx } = build(platform('p', 'in_stock'));
    await svc.moveItem('p', { toLocationId: 'shelf-2', note: 'n' }, 'op-1');
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: 'p',
        fromLocationId: 'shelf-1',
        toLocationId: 'shelf-2',
        fromStatus: 'in_stock',
        toStatus: 'in_stock',
        reason: 'move',
        actorUserId: 'op-1',
        note: 'n',
      }),
    });
  });

  it('⚠️ la escritura se condiciona al estado LEÍDO (TOCTOU): si cambió ⇒ 409 CONFLICT, sin movimiento', async () => {
    const { svc, tx, log } = build(platform('p', 'listed'));
    // Entre la lectura y la escritura un checkout reserva la pieza… y la liquida (`picking`).
    const realUpdate = tx.inventoryItem.update;
    tx.inventoryItem.findUnique.mockImplementationOnce(async () => ({ ...platform('p', 'in_stock') }));
    const e = await err(svc.moveItem('p', { toLocationId: 'shelf-2' }, 'op-1'));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(realUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p', status: 'in_stock', ownerType: 'platform', ownerUserId: null }),
      }),
    );
    expect(log.some((l) => l.startsWith('movement'))).toBe(false);
  });

  it('⭐ devuelve la pieza con su `location` (id, label, zone)', async () => {
    const { svc } = build(platform('p', 'in_stock'));
    const res: any = await svc.moveItem('p', { toLocationId: 'shelf-2' }, 'op-1');
    expect(res.locationId).toBe('shelf-2');
    expect(res.location).toEqual({ id: 'shelf-2', label: 'EST-2', zone: 'platform_stock' });
  });
});

// =============================================================================================
describe('mark (perdida / dañada)', () => {
  it.each(['in_stock', 'listed'])('plataforma %s ⇒ se marca', async (status) => {
    const { svc, rows } = build(platform('p', status));
    await svc.markItem('p', { mark: 'lost', note: 'n' }, 'op-1');
    expect(rows[0].status).toBe('lost');
  });

  it.each(['reserved', 'picking', ...TERMINAL])(
    '⛔ plataforma %s ⇒ 422 ITEM_NOT_ADJUSTABLE, sin escribir (QA: `picking` de un pedido cobrado)',
    async (status) => {
      const { svc, rows, log } = build(platform('p', status));
      const e = await err(svc.markItem('p', { mark: 'damaged', note: 'n' }, 'op-1'));
      expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
      expect(e.getStatus()).toBe(422);
      expect(rows[0].status).toBe(status);
      expect(log).toEqual([]);
    },
  );

  // 🔒 v1.80.3 §M4-SHIP.17.1 (1) (SEC-SHIP-A1, D-SHIP-5): `mark` es SOLO plataforma `in_stock|listed`.
  // Marcar `lost` la carta de un cliente fuera de un caso es el vector (3): la pieza deja de ser
  // retirable y ningún lector de deuda (`ReplacementCase`) la ve. La incidencia de custodia se
  // registra SOLO en el palomeo del retiro/colocación, que abre su caso. Sin excepción.
  it('⛔ (D-SHIP-5) cliente en custodia liquidada, fuera de retiro ⇒ 422 ITEM_NOT_ADJUSTABLE, sin escribir', async () => {
    const { svc, rows, log } = build(customer('c', 'ana', 'drawer-ana-1'));
    const e = await err(svc.markItem('c', { mark: 'lost', note: 'n' }, 'op-1'));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.getStatus()).toBe(422);
    expect(e.details).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    expect(rows[0].status).toBe('in_custody');
    expect(log).toEqual([]);
  });

  it('⛔ (D-SHIP-5) cliente en un retiro cobrado ⇒ también 422 ITEM_NOT_ADJUSTABLE (ya no se consulta el retiro)', async () => {
    const { svc, rows, tx } = build(customer('c', 'ana', 'drawer-ana-1'), { activeWithdrawal: true });
    const e = await err(svc.markItem('c', { mark: 'lost', note: 'n' }, 'op-1'));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.getStatus()).toBe(422);
    expect(rows[0].status).toBe('in_custody');
    // La rama `customer` de `mark` no existe: no hay lectura de retiros ni puerta del cliente.
    expect(tx.shipmentItem.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('⛔ (D-SHIP-5) `assertOperable(cliente, "mark")` lanza ITEM_NOT_ADJUSTABLE aunque sea custodia liquidada', () => {
    const item = customer('c', 'ana', 'drawer-ana-1');
    let thrown: unknown = null;
    try {
      assertOperable(item as any, 'mark');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BusinessException);
    expect((thrown as BusinessException).code).toBe('ITEM_NOT_ADJUSTABLE');
    // `move` conserva la rama de cliente (§M4-SHIP.17.1 (3): sin cambio de conducta).
    expect(assertOperable(item as any, 'move')).toBe('customer');
  });

  it('movimiento y update en la MISMA transacción, condicionados al estado leído', async () => {
    const { svc, tx, log } = build(platform('p', 'listed'));
    await svc.markItem('p', { mark: 'damaged', note: 'n' }, 'op-1');
    expect(log).toEqual(['update@tx', 'movement@tx']);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'p', status: 'listed' }) }),
    );
  });
});

// =============================================================================================
/**
 * 🔒 v1.80.7.2 — CANDADO ESTÁTICO de la regla de fusión SEC-SHIP-A1 (API_CONTRACT §M1 `#M1-merge-rule`).
 * Tres streams (hotfix v1.79.7 · dinero v1.80.2.3 · envío v1.80.7) construyeron la misma guarda; al
 * fusionar quedaron DOS allowlists vivos (`item-location.rules.ts` y uno local en `inventory.service.ts`).
 * La regla: `item-location.rules.ts` es el ÚNICO cuerpo de guardas y `MARKABLE_PLATFORM_STATUSES` se
 * DECLARA una sola vez en `backend/src`, ahí. Y `markItem`/`updateItem` no llevan guarda en línea
 * (`ownerType !== 'platform'`): la delegan en `assertOperable`.
 * ⛔ No se busca el literal `['in_stock','listed']`: aparece además en `dto/inventory.dto.ts` (`@IsIn`),
 * `PUBLISHABLE_ORIGIN_STATUSES` y `ADJUSTABLE_ORIGIN_STATUSES`, que son OTROS predicados (fuera de la regla).
 */
describe('candado estático — un solo cuerpo de guardas (#M1-merge-rule)', () => {
  const SRC = join(__dirname, '..', 'src');
  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return e.endsWith('.ts') && !e.endsWith('.spec.ts') ? [full] : [];
    });
  }
  /** Cuerpo `{…}` de un método `async <name>(…)` por conteo de llaves (la firma puede llevar `{…}`). */
  function methodBody(src: string, name: string): string {
    const start = src.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    let i = src.indexOf('(', start);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    const open = src.indexOf('{', i);
    depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
    }
    throw new Error(`cuerpo de ${name} sin cerrar`);
  }

  /** Nº de DECLARACIONES de `MARKABLE_PLATFORM_STATUSES` en un texto. */
  const declCount = (text: string) =>
    [...text.matchAll(/\b(?:const|let|var)\s+MARKABLE_PLATFORM_STATUSES\b/g)].length;
  /**
   * Quita comentarios (`// …` y `/* … *\/`) antes de mirar el código: `updateItem` NOMBRA `assertOperable(` en su
   * comentario de la regla de fusión, y sin esto borrar la llamada dejaba el candado verde (medido en la mutación
   * de la fusión release-s5). Aproximado a propósito: no hay `//` dentro de cadenas en estos dos métodos.
   */
  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  /** Lo que el candado exige de un cuerpo de método: sin guarda en línea, sin allowlist, delega. */
  const bodyShape = (raw: string) => {
    const body = stripComments(raw);
    return {
      inline: /ownerType\s*!==\s*'platform'/.test(body),
      allowlist: body.includes('MARKABLE_PLATFORM_STATUSES'),
      delegates: /assertOperable\(/.test(body),
    };
  };
  const CLEAN = { inline: false, allowlist: false, delegates: true };

  it('`MARKABLE_PLATFORM_STATUSES` se DECLARA una sola vez en backend/src, en item-location.rules.ts', () => {
    const hits = tsFiles(SRC).flatMap((f) =>
      Array.from({ length: declCount(readFileSync(f, 'utf8')) }, () => relative(SRC, f)),
    );
    expect(hits).toEqual([join('modules', 'inventory', 'item-location.rules.ts')]);
  });

  it('`markItem` y `updateItem` no llevan guarda en línea: llaman a `assertOperable`', () => {
    const src = readFileSync(join(SRC, 'modules', 'inventory', 'inventory.service.ts'), 'utf8');
    for (const name of ['markItem', 'updateItem']) {
      expect({ name, ...bodyShape(methodBody(src, name)) }).toEqual({ name, ...CLEAN });
    }
  });

  // Canario: los detectores MUERDEN. Es la forma exacta del allowlist local y de la guarda en línea que
  // `envio-preparar` traía en `inventory.service.ts` antes de la regla (`:389` y `updateItem`/`markItem`).
  it('canario — una segunda declaración y una guarda en línea SE DETECTAN', () => {
    const local =
      "const MARKABLE_PLATFORM_STATUSES: ReadonlyArray<InventoryStatus> = ['in_stock', 'listed'];\n" +
      "export const MARKABLE_PLATFORM_STATUSES = ['in_stock', 'listed'];";
    expect(declCount(local)).toBe(2);
    const svc = `class S {
  async updateItem(id: string, dto: { a?: { b: number } }) {
    if (current.ownerType !== 'platform' || !MARKABLE_PLATFORM_STATUSES.includes(current.status)) {
      throw new Error('x');
    }
  }
  async markItem(id: string) { assertOperable(item, 'mark'); }
}`;
    expect(bodyShape(methodBody(svc, 'updateItem'))).toEqual({ inline: true, allowlist: true, delegates: false });
    expect(bodyShape(methodBody(svc, 'markItem'))).toEqual(CLEAN);
    // La llamada borrada y solo NOMBRADA en un comentario NO cuenta como delegar.
    const commented = `class S {
  async updateItem(id: string) {
    // readGuardedItem → assertOperable(item, 'status') → guardedItemUpdate
    /* assertOperable(item, 'price') */
    return id;
  }
}`;
    expect(bodyShape(methodBody(commented, 'updateItem')).delegates).toBe(false);
  });
});
