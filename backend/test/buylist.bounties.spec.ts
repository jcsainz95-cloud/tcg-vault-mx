import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { buildGradeKey } from '../src/modules/pricing/pricing.types';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * v1.28 (P-22, §4.26e / API_CONTRACT §6) — Top Bounties:
 *  1) `GET /buylist/bounties` (publicBounties): vitrina pública READ-ONLY — solo bounties
 *     ACTIVOS (`enabled` + precio > 0, solo raw), orden `bountyPriceCents desc`, cap 50,
 *     `remainingQty = max(0, target − acquired)` (`null` sin objetivo). No escribe NADA.
 *  2) Conteo al PAGAR (paySpei): `bountyAcquiredQty` se incrementa por cada ítem con snapshot
 *     `ruleSource='bounty'` EN LA MISMA transacción del pago; auto-apagado al alcanzar
 *     `bountyTargetQty` (`enabled=false` + `completedAt` + AuditLog `bounty.completed`);
 *     idempotente ante replays (solo cuenta la llamada que HIZO la transición). B-1: los ítems
 *     `itemStatus='rechazada'` (cherry-pick) NO cuentan — §4.26a mide piezas COMPRADAS bajo
 *     bounty, mismo filtro que la invariante BL-1 de `approvedTotalCents`.
 */

const svcOf = (prisma: any) =>
  new BuylistService(
    prisma as PrismaService,
    // Solo se usa gradeKeyFor en el conteo — misma derivación canónica que la cotización.
    { gradeKeyFor: (i: any) => buildGradeKey(i) } as unknown as PricingService,
    {} as SettingsService,
    {} as UsersService,
    pii,
  );

describe('publicBounties — vitrina pública READ-ONLY (contrato §6)', () => {
  const bountyRow = (over: any = {}) => ({
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'holofoil',
    bountyEnabled: true,
    bountyPriceCents: 250000,
    bountyTargetQty: 3,
    bountyAcquiredQty: 1,
    card: {
      name: 'Pikachu ex',
      number: '104',
      rarity: 'Special Illustration Rare',
      imageSmallUrl: 'https://img/x.png',
      set: { name: 'Surging Sparks' },
    },
    ...over,
  });

  it('filtra ACTIVOS (enabled + precio>0 + raw), orden precio desc, cap 50, sin escrituras', async () => {
    const findMany = jest.fn(async () => [bountyRow()]);
    const prisma: any = { variantPriceOverride: { findMany } };
    const svc = svcOf(prisma);
    const res = await svc.publicBounties();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bountyEnabled: true, bountyPriceCents: { gt: 0 }, productType: 'raw' },
        orderBy: [{ bountyPriceCents: 'desc' }, { updatedAt: 'desc' }],
        take: 50,
      }),
    );
    expect(res.data[0]).toEqual({
      cardId: 'c1',
      name: 'Pikachu ex',
      number: '104',
      setName: 'Surging Sparks',
      imageSmallUrl: 'https://img/x.png',
      rarity: 'Special Illustration Rare',
      finish: 'holofoil',
      bountyPriceCents: 250000,
      targetQty: 3,
      remainingQty: 2, // target 3 − acquired 1
    });
    // READ-ONLY estricto: el mock NO tiene métodos de escritura — si el servicio intentara
    // persistir/escala, reventaría (doctrina v1.12 de endpoints anónimos).
  });

  it('remainingQty: null sin objetivo; piso 0 si acquired rebasó el target', async () => {
    const prisma: any = {
      variantPriceOverride: {
        findMany: jest.fn(async () => [
          bountyRow({ bountyTargetQty: null, bountyAcquiredQty: 5 }),
          bountyRow({ cardId: 'c2', bountyTargetQty: 2, bountyAcquiredQty: 7 }),
        ]),
      },
    };
    const res = await svcOf(prisma).publicBounties();
    expect(res.data[0].remainingQty).toBeNull();
    expect(res.data[1].remainingQty).toBe(0);
  });

  it('imageSmallUrl/rarity se OMITEN cuando la carta no los tiene (opcionales del DTO)', async () => {
    const prisma: any = {
      variantPriceOverride: {
        findMany: jest.fn(async () => [
          bountyRow({ card: { name: 'X', number: '1', rarity: null, imageSmallUrl: null, set: { name: 'S' } } }),
        ]),
      },
    };
    const res = await svcOf(prisma).publicBounties();
    expect(res.data[0]).not.toHaveProperty('imageSmallUrl');
    expect(res.data[0]).not.toHaveProperty('rarity');
  });
});

describe('paySpei — conteo de bounty transaccional + auto-apagado (§4.26e)', () => {
  /** Harness: solicitud pagable con ítems, filas M-30 en memoria y tx = el propio prisma. */
  function buildHarness(opts: {
    items: any[];
    overrideRows?: any[];
  }) {
    const auditRows: any[] = [];
    const overrideRows = opts.overrideRows ?? [];
    const keyMatch = (o: any, w: any) =>
      o.cardId === w.cardId &&
      o.productType === w.productType &&
      o.gradeKey === w.gradeKey &&
      o.finish === w.finish;
    const prisma: any = {
      sellRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'sr', status: 'aprobada', verifiedAt: new Date() })
          .mockResolvedValue({ id: 'sr', status: 'pagada', verifiedAt: new Date() }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sellRequestItem: {
        // Honra el where REAL del servicio: ruleSource='bounty' + itemStatus≠'rechazada' (B-1).
        findMany: jest.fn(async ({ where }: any) =>
          opts.items.filter(
            (i) => i.ruleSource === where.ruleSource && i.itemStatus !== where.itemStatus?.not,
          ),
        ),
      },
      variantPriceOverride: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = overrideRows.find((o) => keyMatch(o, where));
          if (!row) return { count: 0 };
          row.bountyAcquiredQty += data.bountyAcquiredQty.increment;
          return { count: 1 };
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          overrideRows.find((o) => keyMatch(o, where.cardId_productType_gradeKey_finish)) ?? null,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = overrideRows.find((o) => o.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          auditRows.push(data);
          return data;
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    return { prisma, svc: svcOf(prisma), overrideRows, auditRows };
  }

  const bountyItem = (over: any = {}) => ({
    cardId: 'c1',
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    ruleSource: 'bounty',
    itemStatus: 'aprobada',
    ...over,
  });
  const m30Row = (over: any = {}) => ({
    id: 'ovr-1',
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'holofoil',
    bountyEnabled: true,
    bountyPriceCents: 250000,
    bountyTargetQty: 3,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    ...over,
  });

  it('incrementa el contador POR CLAVE (2 piezas de la misma variante = +2) sin llegar al target', async () => {
    const h = buildHarness({
      items: [bountyItem(), bountyItem(), bountyItem({ ruleSource: 'rule' })], // la 3ª NO cuenta
      overrideRows: [m30Row({ bountyTargetQty: 5 })],
    });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(h.overrideRows[0].bountyAcquiredQty).toBe(2);
    // Una sola actualización agrupada (+2), no dos.
    expect(h.prisma.variantPriceOverride.updateMany).toHaveBeenCalledTimes(1);
    // Sin auto-off (2 < 5): sigue encendido y sin auditoría de completado.
    expect(h.overrideRows[0].bountyEnabled).toBe(true);
    expect(h.auditRows).toHaveLength(0);
  });

  it('B-1 cherry-pick: los ítems RECHAZADOS bajo bounty NO cuentan y NO disparan el auto-off', async () => {
    // Solicitud pagada con mezcla: 2 aprobadas + 3 rechazadas, TODAS con snapshot bounty.
    // Target 4, acquired 1: sin el filtro BL-1 contaría +5 (1+5=6 ≥ 4 → auto-off + audit EN FALSO);
    // con el filtro cuenta SOLO las 2 compradas (1+2=3 < 4 → bounty sigue vivo, cero auditoría).
    const h = buildHarness({
      items: [
        bountyItem(),
        bountyItem(),
        bountyItem({ itemStatus: 'rechazada' }),
        bountyItem({ itemStatus: 'rechazada' }),
        bountyItem({ itemStatus: 'rechazada' }),
      ],
      overrideRows: [m30Row({ bountyTargetQty: 4, bountyAcquiredQty: 1 })],
    });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    // El where del servicio lleva el filtro BL-1 (misma semántica que approvedTotalCents).
    expect(h.prisma.sellRequestItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ruleSource: 'bounty', itemStatus: { not: 'rechazada' } }),
      }),
    );
    expect(h.overrideRows[0]).toMatchObject({ bountyEnabled: true, bountyAcquiredQty: 3 });
    expect(h.overrideRows[0].bountyCompletedAt).toBeNull();
    expect(h.auditRows).toHaveLength(0); // sin bounty.completed en falso
  });

  it('AUTO-APAGADO al alcanzar target: enabled=false + completedAt + AuditLog bounty.completed', async () => {
    const h = buildHarness({
      items: [bountyItem(), bountyItem()],
      overrideRows: [m30Row({ bountyTargetQty: 3, bountyAcquiredQty: 1 })], // 1 + 2 ≥ 3
    });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(h.overrideRows[0]).toMatchObject({ bountyEnabled: false, bountyAcquiredQty: 3 });
    expect(h.overrideRows[0].bountyCompletedAt).toBeInstanceOf(Date);
    expect(h.auditRows[0]).toMatchObject({
      action: 'bounty.completed',
      entityType: 'VariantPriceOverride',
      entityId: 'ovr-1',
      after: expect.objectContaining({ acquiredQty: 3, targetQty: 3, sellRequestId: 'sr' }),
    });
  });

  it('sin bountyTargetQty: SOLO contador, nunca auto-off', async () => {
    const h = buildHarness({
      items: [bountyItem()],
      overrideRows: [m30Row({ bountyTargetQty: null, bountyAcquiredQty: 99 })],
    });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(h.overrideRows[0]).toMatchObject({ bountyEnabled: true, bountyAcquiredQty: 100 });
    expect(h.auditRows).toHaveLength(0);
  });

  it('bounty YA apagado: el contador sigue subiendo (la pieza SE COMPRÓ bajo bounty) sin re-auditar', async () => {
    const h = buildHarness({
      items: [bountyItem()],
      overrideRows: [m30Row({ bountyEnabled: false, bountyTargetQty: 3, bountyAcquiredQty: 3 })],
    });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(h.overrideRows[0].bountyAcquiredQty).toBe(4);
    expect(h.auditRows).toHaveLength(0); // no re-completa ni re-audita
  });

  it('fila M-30 desaparecida: el conteo se OMITE sin tumbar el pago', async () => {
    const h = buildHarness({ items: [bountyItem()], overrideRows: [] });
    const res = await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(res).toMatchObject({ status: 'pagada' });
    expect(h.prisma.variantPriceOverride.findUnique).not.toHaveBeenCalled();
  });

  it('IDEMPOTENTE ante replay: la solicitud ya pagada NO re-cuenta', async () => {
    const h = buildHarness({ items: [bountyItem()], overrideRows: [m30Row()] });
    // Primer findUnique ya reporta pagada (replay del POST) → retorno temprano.
    h.prisma.sellRequest.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 'sr', status: 'pagada', verifiedAt: new Date() });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(h.prisma.variantPriceOverride.updateMany).not.toHaveBeenCalled();
    expect(h.overrideRows[0].bountyAcquiredQty).toBe(0);
  });

  it('carrera perdida (updateMany count=0): NO cuenta — solo la llamada que HIZO la transición', async () => {
    const h = buildHarness({ items: [bountyItem()], overrideRows: [m30Row()] });
    h.prisma.sellRequest.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const res = await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(res).toMatchObject({ status: 'pagada' }); // la ganadora ya pagó; respuesta idempotente
    expect(h.prisma.variantPriceOverride.updateMany).not.toHaveBeenCalled();
    expect(h.overrideRows[0].bountyAcquiredQty).toBe(0);
  });

  it('el conteo corre DENTRO de la transacción del pago (mismo boundary atómico)', async () => {
    const h = buildHarness({ items: [bountyItem()], overrideRows: [m30Row({ bountyTargetQty: 5 })] });
    let insideTx = false;
    const origTx = h.prisma.$transaction;
    h.prisma.$transaction = jest.fn(async (cb: any) => {
      insideTx = true;
      const out = await origTx(cb);
      insideTx = false;
      return out;
    });
    h.prisma.variantPriceOverride.updateMany.mockImplementation(async () => {
      expect(insideTx).toBe(true); // el incremento ocurre dentro del boundary del pago
      h.overrideRows[0].bountyAcquiredQty += 1;
      return { count: 1 };
    });
    await h.svc.paySpei('sr', 'SPEI-1', 'admin');
    expect(h.overrideRows[0].bountyAcquiredQty).toBe(1);
  });
});
