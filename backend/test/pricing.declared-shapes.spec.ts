import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService, toPriceHistoryEntry } from '../src/modules/pricing/pricing.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v2.1.7 (§M2) — **ningún endpoint devuelve una entidad Prisma directamente; siempre una proyección
 * declarada.**
 *
 * ### La causa raíz que esta norma cierra
 * Cuando la respuesta **ES** la entidad, la forma de la API la define el **schema**, no el contrato —
 * y entonces **cada migración es un cambio de contrato silencioso**. M-41 añadió columnas a tres
 * modelos; con el patrón anterior, cualquier columna futura **se auto-publica sin que nadie lo
 * decida**. Es la misma máquina que produjo el hueco de `details` (v2.1.5), el de `PriceInfo`
 * (v2.1.6) y B-1 (v2.1.7).
 *
 * La verificación va sobre la forma **SERIALIZADA**, en las **dos direcciones** (que no sobre, que no
 * falte) y en el **nivel de agregación que el consumidor lee** — la tercera pata de la convención.
 */

const onWire = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

/** Claves EXACTAS de `PriceHistoryEntryDTO` (contrato §DTOs de administración). */
const PRICE_HISTORY_KEYS = [
  'capturedDate',
  'gradeKey',
  'isManualOverride',
  'priceMxnCents',
  'productType',
  'source',
].sort();

/** Una fila `PriceReference` COMPLETA, tal como sale de Prisma (con todo lo que NO debe viajar). */
const FULL_ROW = {
  id: 'ref-uuid-1',
  cardId: 'c1',
  cardProductId: 'cp-uuid',
  productType: 'raw' as const,
  gradeKey: 'raw:NM',
  finish: 'normal' as const,
  source: 'tcgcsv_singles' as const,
  priceMxnCents: 115000,
  priceUsdCents: 6500,
  fxRate: 17.5,
  fxBufferPct: 3,
  capturedDate: new Date('2026-08-24T00:00:00.000Z'),
  isManualOverride: false,
  createdAt: new Date('2026-08-24T11:22:33.000Z'),
};

describe('§M2 — `PriceHistoryEntryDTO`: la proyección es por LISTA BLANCA', () => {
  it('conjunto EXACTO de claves: ni `id`, ni `fxRate`, ni `createdAt`, ni `cardProductId`…', () => {
    expect(Object.keys(onWire(toPriceHistoryEntry(FULL_ROW))).sort()).toEqual(PRICE_HISTORY_KEYS);
  });

  it('una COLUMNA NUEVA del schema NO se auto-publica (el punto entero de la norma)', () => {
    // Simula la próxima migración: una columna añadida a `PriceReference`.
    const conColumnaNueva = { ...FULL_ROW, algunaColumnaFutura: 'secreto-operativo' };
    const out = onWire(toPriceHistoryEntry(conColumnaNueva));
    expect(out).not.toHaveProperty('algunaColumnaFutura');
    expect(Object.keys(out).sort()).toEqual(PRICE_HISTORY_KEYS);
  });

  it('`capturedDate` es DÍA (`YYYY-MM-DD`), no instante: el ISO insinuaba precisión que el dato no tiene', () => {
    expect(toPriceHistoryEntry(FULL_ROW).capturedDate).toBe('2026-08-24');
  });

  it('`source` viaja como valor del ENUM (la grieta del acuerdo tácito era tiparlo `string`)', () => {
    expect(toPriceHistoryEntry(FULL_ROW).source).toBe('tcgcsv_singles');
  });

  it('`isManualOverride` SÍ viaja: aquí es auditoría `super_admin`, no superficie anónima', () => {
    expect(toPriceHistoryEntry({ ...FULL_ROW, isManualOverride: true }).isManualOverride).toBe(true);
    // Y NO es redundante con `source` per-fila: `sourceRank` las trata como señales SEPARADAS, así que
    // una fila puede venir marcada manual con un `source` distinto de 'manual'.
    const manualConOtraFuente = toPriceHistoryEntry({ ...FULL_ROW, isManualOverride: true, source: 'poketrace' });
    expect(manualConOtraFuente).toMatchObject({ isManualOverride: true, source: 'poketrace' });
  });
});

describe('§M2 — las dos rutas normadas devuelven `{ data }` proyectado', () => {
  function build() {
    const rows = [FULL_ROW];
    const pricing = {
      priceHistory: jest.fn(async () => rows.map(toPriceHistoryEntry)),
      manualOverride: jest.fn(async () => FULL_ROW),
    } as unknown as PricingService;
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    // Orden real del constructor: (pricing, fx, settings, audit, prisma, priceSync, priceIngest, variantControls)
    return new PricingController(
      pricing, {} as never, {} as never, audit, {} as never, {} as never, {} as never, {} as never,
    );
  }

  it('`GET /admin/pricing/card/:cardId` ⇒ `{ data: PriceHistoryEntryDTO[] }`', async () => {
    const res = await build().history('c1');
    expect(Object.keys(res)).toEqual(['data']);
    expect(Object.keys(onWire(res.data[0])).sort()).toEqual(PRICE_HISTORY_KEYS);
  });

  it('`POST /admin/pricing/override` ⇒ `{ data: PriceHistoryEntryDTO }` — NO la entidad (caso testigo)', async () => {
    const res = await build().override(
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', priceMxnCents: 115000 } as never,
      'admin-1',
    );
    expect(Object.keys(res)).toEqual(['data']);
    expect(Object.keys(onWire(res.data)).sort()).toEqual(PRICE_HISTORY_KEYS);
    // Lo que ANTES se publicaba y ahora no:
    for (const fuga of ['id', 'priceUsdCents', 'fxRate', 'fxBufferPct', 'cardProductId', 'createdAt']) {
      expect(res.data).not.toHaveProperty(fuga);
    }
  });

  it('el `id` sigue yendo a la BITÁCORA (donde se necesita para trazar), no a la respuesta', async () => {
    const pricing = {
      manualOverride: jest.fn(async () => FULL_ROW),
      priceHistory: jest.fn(async () => []),
    } as unknown as PricingService;
    const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
    const ctrl = new PricingController(
      pricing, {} as never, {} as never, audit, {} as never, {} as never, {} as never, {} as never,
    );
    const res = await ctrl.override(
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', priceMxnCents: 1 } as never,
      'admin-1',
    );
    expect((audit.log as jest.Mock).mock.calls[0][0]).toMatchObject({ entityId: FULL_ROW.id });
    expect(res.data).not.toHaveProperty('id');
  });
});

describe('auditoría de la norma — `PATCH /admin/users/:id/status` ya no devuelve `passwordHash`', () => {
  /**
   * Hallazgo de la auditoría que el arquitecto dejó a backend: `updateUserStatus` devolvía la fila
   * `User` COMPLETA. Un hash de credencial no tiene ninguna razón para viajar en la respuesta de
   * «cambiar estado» — y es exactamente el fallo que la norma predice.
   *
   * La proyección NO se inventa: es la MISMA que ya usaba `listUsers`, el endpoint hermano.
   */
  it('proyecta con el mismo `select` del listado (sin passwordHash, tokenVersion ni googleId)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const prisma = {
      user: {
        update: jest.fn(async (args: Record<string, unknown>) => {
          captured.push(args);
          return { id: 'u1', email: 'a@b.c', name: 'A', role: 'customer', status: 'blocked', createdAt: new Date() };
        }),
      },
    } as unknown as PrismaService;
    const svc = new AdminService(prisma, {} as never, {} as never, {} as never);
    await svc.updateUserStatus('u1', 'blocked');
    const select = (captured[0].select ?? {}) as Record<string, boolean>;
    expect(Object.keys(select).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role', 'status']);
    for (const secreto of ['passwordHash', 'tokenVersion', 'googleId', 'anonymizedAt']) {
      expect(select).not.toHaveProperty(secreto);
    }
  });
});
