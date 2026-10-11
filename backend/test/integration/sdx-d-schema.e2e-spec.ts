/**
 * sdx-d-schema.e2e-spec.ts — ⭐💰 pieza D2a de Skydropx (M-66 = `M-SDX-D`) contra Postgres REAL y la app Nest por HTTP.
 * Propiedad: backend.
 *
 * Cubre: los CHECK de §19.2 + delta §19.19.14 + §19.20.2 (cada uno muerde con su nombre), las unicidades nuevas
 * (`ShipmentQuote` por envío — PS-95 parte esquema; `ShipmentCarrierEvent` con `providerShipmentId`, SEC-SDX-9), los
 * seeds tras migrar (PS-97 parte esquema: dos empaques activos con código; los doce diales) y los diales por
 * `GET/PUT /admin/settings` (súper-admin, auditados; PS-96/PS-97 parte dial: `422` con escalones no crecientes y con
 * Carta Porte de 7 dígitos). ⛔ Ninguna llamada al proveedor: D2a no tiene verbo que la haga (PS-99).
 *
 * Las filas «compra en vuelo» y «guía Skydropx en proceso» de PS-104 están en `sdx-c-address.e2e-spec.ts` (junto a la
 * fila legada, mismo `PUT`).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { SETTING_DEFAULTS, SettingKey } from '../../src/modules/settings/settings.constants';

const RUN = Date.now().toString(36);

describe('⭐💰 D2a (M-66 = `M-SDX-D`): esquema, CHECKs, seeds y diales de Skydropx', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  const SHIPPING_KEYS = Object.values(SettingKey).filter((k) => /^(shipping_|skydropx_)/.test(k) && k !== 'shipping_fee_cents' && k !== 'shipping_label_reissue_max_per_shipment');

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    // Los diales tocados vuelven a su seed (la migración y el seed escriben el mismo valor).
    for (const k of SHIPPING_KEYS) {
      await h.prisma.configSetting.upsert({
        where: { key: k },
        create: { key: k, valueJson: SETTING_DEFAULTS[k] as object, updatedBy: 'test-restore' },
        update: { valueJson: SETTING_DEFAULTS[k] as object, updatedBy: 'test-restore' },
      });
    }
    await h.prisma.shipmentCostAdjustment.deleteMany({ where: { providerChargeId: { startsWith: `ch-${RUN}` } } });
    await db.cleanup();
    await h?.close();
  });

  const sx = (id: string, set: string) => h.prisma.$executeRawUnsafe(`UPDATE "ShipmentRequest" SET ${set} WHERE id = $1`, id);
  /** Los datos que el CHECK «con id ⇒ datos de compra» exige. */
  const PURCHASE = `"providerRateId"='r', "chosenRateJson"='{}', "rateChosenByUserId"='u', "rateChosenAt"=now(), "labelPurchasedAt"=now(), "packageCode"='4G', "declaredValueCents"=250000, "insuredValueCents"=100000`;

  describe('ShipmentRequest — columnas nuevas y CHECKs (§19.2 + §19.19.14 + §19.20.2)', () => {
    it('una fila existente/nueva nace con todo NULL y `insuranceCostCents = 0` (sin backfill)', async () => {
      const d = await db.mkDirect();
      const s = await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id: d.shipment.id } });
      expect({
        labelSource: s.labelSource, providerShipmentId: s.providerShipmentId, labelProcessingSince: s.labelProcessingSince,
        carrierStatus: s.carrierStatus, insuranceCostCents: s.insuranceCostCents, insuredValueCents: s.insuredValueCents,
        providerCancelConfirmedAt: s.providerCancelConfirmedAt,
      }).toEqual({
        labelSource: null, providerShipmentId: null, labelProcessingSince: null, carrierStatus: null, insuranceCostCents: 0,
        insuredValueCents: null, providerCancelConfirmedAt: null,
      });
    });

    it.each([
      ['shipment_label_source_iff_provider_id', `"labelSource"='skydropx'`],
      ['shipment_label_source_iff_provider_id', `"providerShipmentId"='x-${RUN}-1', ${PURCHASE}`],
      ['shipment_label_source_iff_provider_id', `"labelSource"='manual', "providerShipmentId"='x-${RUN}-2', ${PURCHASE}`],
      ['shipment_provider_id_requires_purchase', `"labelSource"='skydropx', "providerShipmentId"='x-${RUN}-3'`],
      ['shipment_provider_id_requires_purchase', `"labelSource"='skydropx', "providerShipmentId"='x-${RUN}-4', ${PURCHASE.replace(`, "insuredValueCents"=100000`, '')}`],
      ['shipment_rate_chosen_paired', `"rateChosenByUserId"='u'`],
      ['shipment_label_processing_without_tracking', `"labelProcessingSince"=now(), carrier='DHL', "trackingNumber"='T-${RUN}'`],
      ['shipment_carrier_status_requires_provider', `"carrierStatus"='created', "carrierStatusAt"=now()`],
      ['shipment_carrier_status_paired', `"labelSource"='skydropx', "providerShipmentId"='x-${RUN}-5', ${PURCHASE}, "carrierStatus"='created'`],
      ['shipment_insurance_cost_nonneg', `"insuranceCostCents"=-1`],
      ['shipment_declared_value_nonneg', `"declaredValueCents"=-1`],
      ['shipment_insured_value_within_declared', `"insuredValueCents"=10`],
      ['shipment_insured_value_within_declared', `"declaredValueCents"=10, "insuredValueCents"=11`],
      ['shipment_delivered_notice_skydropx_only', `"deliveredNoticeSentAt"=now()`],
      ['shipment_delivered_notice_skydropx_only', `"labelSource"='manual', "deliveredNoticeSentAt"=now()`],
      ['shipment_provider_cancel_paired', `"providerCanceledAt"=now()`],
      ['shipment_provider_cancel_confirmed_requires_canceled', `"providerCancelConfirmedAt"=now()`],
    ])('%s muerde: SET %s', async (check, set) => {
      const d = await db.mkDirect();
      await expect(sx(d.shipment.id, set)).rejects.toThrow(new RegExp(check));
    });

    it('las formas legales pasan: compra en vuelo (reclamo sin id), guía Skydropx en proceso, con número + estado, cancelada y confirmada, manual con número', async () => {
      const ok = [
        // reclamo de §19.7 paso 7 (sin id): «compra en vuelo» — §19.20.2 `in_flight`, PS-104 fila D2a
        `"labelProcessingSince"=now(), "rateChosenByUserId"='u', "rateChosenAt"=now(), "providerRateId"='r', "declaredValueCents"=250000, "insuredValueCents"=250000`,
        // guía en proceso (comprada, sin número); sin recomendada (§19.7 paso 7: `?? null`)
        `"labelSource"='skydropx', "providerShipmentId"='ok-${RUN}-1', ${PURCHASE}, "labelProcessingSince"=now()`,
        `"labelSource"='skydropx', "providerShipmentId"='ok-${RUN}-2', ${PURCHASE}, carrier='ninetynineminutes', "trackingNumber"='N-${RUN}', "carrierStatus"='delivered', "carrierStatusAt"=now(), "deliveredNoticeSentAt"=now(), "insuranceCostCents"=2500, "shippingIvaSource"='provider'`,
        `"labelSource"='skydropx', "providerShipmentId"='ok-${RUN}-3', ${PURCHASE}, "providerCanceledAt"=now(), "providerCancelReason"='reissue', "providerCancelConfirmedAt"=now()`,
        `"labelSource"='manual', carrier='DHL', "trackingNumber"='M-${RUN}'`,
      ];
      for (const set of ok) {
        const d = await db.mkDirect();
        await expect(sx(d.shipment.id, set)).resolves.toBe(1);
      }
    });

    it('`providerShipmentId` único entre envíos', async () => {
      const a = await db.mkDirect();
      const b = await db.mkDirect();
      await sx(a.shipment.id, `"labelSource"='skydropx', "providerShipmentId"='dup-${RUN}', ${PURCHASE}`);
      await expect(sx(b.shipment.id, `"labelSource"='skydropx', "providerShipmentId"='dup-${RUN}', ${PURCHASE}`)).rejects.toThrow(/23505.*providerShipmentId/s);
    });
  });

  describe('ShipmentQuote / ShipmentCarrierEvent / ShipmentCostAdjustment / ShippingPackage', () => {
    const quote = (shipmentRequestId: string, providerQuotationId: string, over: Record<string, unknown> = {}) =>
      h.prisma.shipmentQuote.create({
        data: {
          shipmentRequestId, providerQuotationId, requestedByUserId: db.operatorId, expiresAt: new Date(Date.now() + 86_400_000),
          packageCode: '5H4', packageDimsJson: { lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1 }, declaredValueCents: 250000,
          insuredValueCents: 150000, insuranceEchoOk: true, addressVersion: 0, ratesJson: [], ...over,
        },
      });

    it('PS-95 (esquema): el MISMO `providerQuotationId` en DOS envíos ⇒ dos filas, cero P2002; dos veces en el MISMO envío ⇒ P2002', async () => {
      const a = await db.mkDirect();
      const b = await db.mkDirect();
      await quote(a.shipment.id, `pq-${RUN}`);
      await expect(quote(b.shipment.id, `pq-${RUN}`)).resolves.toBeTruthy();
      await expect(quote(a.shipment.id, `pq-${RUN}`)).rejects.toMatchObject({ code: 'P2002' });
      expect(await h.prisma.shipmentQuote.count({ where: { providerQuotationId: `pq-${RUN}` } })).toBe(2);
    });

    it('CHECKs de la cotización: vence después de pedirse; cobertura ≥ 0 y ≥ valor asegurado', async () => {
      const a = await db.mkDirect();
      await expect(quote(a.shipment.id, `c1-${RUN}`, { requestedAt: new Date(), expiresAt: new Date(Date.now() - 1000) })).rejects.toThrow(/shipment_quote_expires_after_requested/);
      await expect(quote(a.shipment.id, `c2-${RUN}`, { declaredValueCents: -1, insuredValueCents: -2 })).rejects.toThrow(/shipment_quote_declared_value_nonneg/);
      await expect(quote(a.shipment.id, `c3-${RUN}`, { declaredValueCents: 250000, insuredValueCents: 250001 })).rejects.toThrow(/shipment_quote_declared_covers_insured/);
      await expect(quote(a.shipment.id, `c4-${RUN}`, { declaredValueCents: 250000, insuredValueCents: 250000 })).resolves.toBeTruthy(); // ≥: exactamente $2,500 va en el escalón de $2,500
    });

    it('SEC-SDX-9: el mismo evento de DOS guías (re-emisión) convive; el mismo evento de la MISMA guía ⇒ P2002', async () => {
      const a = await db.mkDirect();
      const ev = (providerShipmentId: string) =>
        h.prisma.shipmentCarrierEvent.create({ data: { shipmentRequestId: a.shipment.id, providerShipmentId, status: 'created', occurredAt: new Date(0), providerEventKey: 'created' } });
      await ev(`g1-${RUN}`);
      await expect(ev(`g2-${RUN}`)).resolves.toBeTruthy();
      await expect(ev(`g1-${RUN}`)).rejects.toMatchObject({ code: 'P2002' });
    });

    it('ajustes de costo: monto > 0; 0 ≤ IVA ≤ monto; `providerChargeId` único; RESTRICT al borrar el envío', async () => {
      const a = await db.mkDirect();
      const adj = (providerChargeId: string, amountCents: number, ivaCents: number) =>
        h.prisma.shipmentCostAdjustment.create({ data: { shipmentRequestId: a.shipment.id, kind: 'overweight', providerChargeId, providerChargeType: 'ExtraCharge::Overweight', amountCents, ivaCents, ivaSource: 'computed', chargedAt: new Date() } });
      await expect(adj(`ch-${RUN}-0`, 0, 0)).rejects.toThrow(/shipment_cost_adjustment_amount_positive/);
      await expect(adj(`ch-${RUN}-1`, 100, 101)).rejects.toThrow(/shipment_cost_adjustment_iva_within_amount/);
      await expect(adj(`ch-${RUN}-2`, 100, -1)).rejects.toThrow(/shipment_cost_adjustment_iva_within_amount/);
      await adj(`ch-${RUN}-3`, 11600, 1600);
      await expect(adj(`ch-${RUN}-3`, 100, 0)).rejects.toMatchObject({ code: 'P2002' });
      await expect(h.prisma.shipmentRequest.delete({ where: { id: a.shipment.id } })).rejects.toThrow(/Foreign key|violates|P2003/i);
    });

    it('PS-97 (esquema): tras migrar están los dos empaques ACTIVOS con código (`5H4`, `4G`), `weightKg` entero; CHECK ≥ 1 kg y medidas > 0', async () => {
      const pk = await h.prisma.shippingPackage.findMany({ where: { code: { in: ['envelope', 'box'] } }, orderBy: { sortOrder: 'asc' } });
      expect(pk.map((p) => ({ code: p.code, l: p.lengthCm, w: p.widthCm, hh: p.heightCm, kg: p.weightKg, type: p.providerPackageType, active: p.active }))).toEqual([
        { code: 'envelope', l: 25, w: 18, hh: 3, kg: 1, type: '5H4', active: true },
        { code: 'box', l: 49, w: 23, hh: 21, kg: 5, type: '4G', active: true },
      ]);
      const mk = (code: string, over: Record<string, number>) =>
        h.prisma.shippingPackage.create({ data: { code, label: 'X', lengthCm: 1, widthCm: 1, heightCm: 1, weightKg: 1, providerPackageType: 'X', ...over } });
      await expect(mk(`p0-${RUN}`, { weightKg: 0 })).rejects.toThrow(/shipping_package_weight_min_1kg/);
      await expect(mk(`p1-${RUN}`, { heightCm: 0 })).rejects.toThrow(/shipping_package_dims_positive/);
    });
  });

  describe('Diales por `GET/PUT /admin/settings` (súper-admin, auditados)', () => {
    it('GET: los doce, con sus seeds (proveedor `off`, compra `disabled`, Carta Porte 49101600, dos escalones)', async () => {
      // Lo que sembró la migración (o el seed) — y nada de `shippingDeclaredValueCapCents`.
      for (const k of SHIPPING_KEYS) {
        await h.prisma.configSetting.upsert({ where: { key: k }, create: { key: k, valueJson: SETTING_DEFAULTS[k] as object }, update: { valueJson: SETTING_DEFAULTS[k] as object } });
      }
      const r = await h.api('GET', '/admin/settings', { token: db.adminToken });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        shippingProvider: 'off',
        shippingLabelPurchase: 'disabled',
        shippingConsignmentNote: '49101600',
        shippingInsuranceTiers: [
          { coverageCents: 250000, costCents: 2500, measuredAt: '2026-10-04' },
          { coverageCents: 1000000, costCents: 17000, measuredAt: '2026-10-04' },
        ],
        shippingPreferredCarriers: ['ninetynineminutes'],
        shippingLabelFormat: 'standard',
        skydropxLowBalanceCents: 100000, // HECHOS.md:62
        operatorLabelCap24hCents: 250000, // §19.29.8 (default de código hasta M-68)
        skydropxOriginAddressTemplateId: null,
        skydropxOriginSnapshot: null,
      });
      expect(r.body).not.toHaveProperty('shippingDeclaredValueCapCents');
      // ⛔ Credenciales y URL base no son diales: ni como máscara.
      expect(JSON.stringify(r.body)).not.toMatch(/SKYDROPX_|clientSecret|baseUrl/i);
    });

    it('PS-97 / PS-96 (dial): Carta Porte `4910160` ⇒ 422; escalones no crecientes ⇒ 422; todo-o-nada (nada se escribe)', async () => {
      const before = await h.prisma.configSetting.findMany({ where: { key: { in: SHIPPING_KEYS } }, orderBy: { key: 'asc' } });
      const bad1 = await h.api('PUT', '/admin/settings', { token: db.adminToken, json: { shippingConsignmentNote: '4910160', shippingLabelFormat: 'thermal' } });
      expect(bad1.status).toBe(422);
      expect(bad1.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { errors: { shippingConsignmentNote: expect.any(String) } } });
      const bad2 = await h.api('PUT', '/admin/settings', {
        token: db.adminToken,
        json: { shippingInsuranceTiers: [{ coverageCents: 1000000, costCents: 17000, measuredAt: '2026-10-04' }, { coverageCents: 250000, costCents: 2500, measuredAt: '2026-10-04' }] },
      });
      expect(bad2.status).toBe(422);
      expect(bad2.body.error.details.errors).toHaveProperty('shippingInsuranceTiers');
      const bad3 = await h.api('PUT', '/admin/settings', { token: db.adminToken, json: { shippingDeclaredValueCapCents: 100 } });
      expect(bad3.status).toBe(422); // retirado: clave desconocida
      const bad4 = await h.api('PUT', '/admin/settings', { token: db.adminToken, json: { operatorLabelCap24hCents: 0 } });
      expect(bad4.status).toBe(422); // §19.29.8: ⛔ tope en 0 (para cerrar compras está el interruptor)
      expect(bad4.body.error.details.errors).toHaveProperty('operatorLabelCap24hCents');
      expect(await h.prisma.configSetting.findMany({ where: { key: { in: SHIPPING_KEYS } }, orderBy: { key: 'asc' } })).toEqual(before);
    });

    it('PUT válido ⇒ 200, persiste (incl. `null` y objetos) y deja UNA bitácora `settings.update`; el operador ⇒ 403', async () => {
      const json = {
        shippingLabelFormat: 'thermal',
        shippingConsignmentNote: '60141103',
        skydropxOriginAddressTemplateId: 'tpl_verapaz',
        skydropxOriginSnapshot: { name: 'TCG Hunt', company: 'TCG Hunt', street1: 'Verapaz 100', postalCode: '03000', reference: 'Local 2' },
        shippingInsuranceTiers: [
          { coverageCents: 250000, costCents: 2500, measuredAt: '2026-10-04' },
          { coverageCents: 500000, costCents: 8000, measuredAt: '2026-10-05' },
          { coverageCents: 1000000, costCents: 17000, measuredAt: '2026-10-04' },
        ],
      };
      const t0 = new Date();
      const r = await h.api('PUT', '/admin/settings', { token: db.adminToken, json });
      expect(r.status).toBe(200);
      const g = await h.api('GET', '/admin/settings', { token: db.adminToken });
      expect(g.body).toMatchObject(json);
      const back = await h.api('PUT', '/admin/settings', { token: db.adminToken, json: { skydropxOriginAddressTemplateId: null, skydropxOriginSnapshot: null } });
      expect(back.status).toBe(200);
      expect((await h.api('GET', '/admin/settings', { token: db.adminToken })).body).toMatchObject({ skydropxOriginAddressTemplateId: null, skydropxOriginSnapshot: null });
      const logs = await h.prisma.auditLog.findMany({ where: { action: 'settings.update', actorUserId: db.adminId, createdAt: { gte: t0 } } });
      expect(logs).toHaveLength(2);
      expect(logs.some((l) => (l.after as Record<string, unknown>).shippingConsignmentNote === '60141103')).toBe(true);
      const op = await h.api('PUT', '/admin/settings', { token: db.opToken, json: { shippingLabelPurchase: 'operators' } });
      expect(op.status).toBe(403);
      expect((await h.prisma.configSetting.findUnique({ where: { key: 'shipping_label_purchase' } }))?.valueJson).toBe('disabled');
    });
  });
});
