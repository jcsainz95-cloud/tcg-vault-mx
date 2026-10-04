/**
 * sdx-c-address.e2e-spec.ts — ⭐💰 fase C de Skydropx (M-64 = `M-SDX-C`) contra Postgres REAL y la app Nest completa
 * por HTTP. Propiedad: backend.
 *
 * Cubre: API_CONTRACT §M4-SHIP.19.5 (catálogo de CP, libreta al nivel del invitado, `complete`,
 * `ADDRESS_INCOMPLETE`, `references`), §M4-SHIP.19.20.1 (`PUT /admin/shipments/:id/address`) con PS-102, PS-103,
 * PS-104 (con su carrera N = 10) y PS-107; y la carrera «corrección contra captura de guía» (fase C: la guía manual —
 * la compra Skydropx es D2c y su carrera, PS-105, NO está aquí: BACKEND_NOTES §58).
 * ⭐ v1.80.12.5 (§M4-SHIP.19.25, `HECHOS.md:57`, «colonia como Mercado Libre»): `resolveAddressGeo` nunca rechaza por
 * geografía — PS-103 sustituida, PS-114 (libreta e invitado; un invitado PAGA con `PostalCode` vacía) y PS-115
 * (`address.neighborhoodCheck` calculado al leer).
 *
 * Carreras: entrelazado FORZADO por barrera de fila (la prueba toma `FOR UPDATE` sobre el envío, comprueba en
 * `pg_stat_activity` que las peticiones esperan, y suelta). Se reporta la proporción con su N (`[PS-RACE …] k/N`).
 * Mutaciones: sobre COPIA del árbol entero, ⛔ nunca aquí.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);
const N = 10;

/** Un cuerpo de corrección válido: CP 01000 · «San Ángel» (catálogo del arnés, `E2E_POSTAL_CODES`). */
const CORRECTION = {
  recipientName: 'Ana Gómez Ruiz',
  line1: 'Av. Revolución 1500',
  line2: 'Int. 4',
  postalCode: '01000',
  neighborhood: 'San Ángel',
  // ⭐ v1.80.12.5 (§19.25.1): obligatorios en el cuerpo; con el CP en el catálogo ganan los del catálogo.
  city: 'Álvaro Obregón',
  state: 'Ciudad de México',
  references: 'Portón negro junto a la farmacia',
};

describe('⭐ fase C (M-64): catálogo de CP, dirección de lista y corrección de la dirección del envío', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;

  const put = (id: string, json: unknown, token = db.opToken): Promise<R> =>
    h.api('PUT', `/admin/shipments/${id}/address`, { token, json });
  const code = (r: R) => (r.status === 200 ? `200:${r.body.outcome}` : `${r.status}:${r.body?.error?.code}${r.body?.error?.details?.reason ? `/${r.body.error.details.reason}` : ''}`);
  const report = (id: string, outcomes: string[], ok: (o: string) => boolean) => {
    const k = outcomes.filter(ok).length;
    // eslint-disable-next-line no-console
    console.log(`[PS-RACE ${id}] ${k}/${outcomes.length} · N=${outcomes.length} · ${outcomes.join(' | ')}`);
    return k;
  };
  const auditOf = (shipmentId: string) =>
    h.prisma.auditLog.findMany({ where: { entityId: shipmentId, action: 'shipment.address_corrected' }, orderBy: { createdAt: 'asc' } });
  const revisionsOf = (shipmentId: string) =>
    h.prisma.shipmentAddressRevision.findMany({ where: { shipmentRequestId: shipmentId }, orderBy: { fromVersion: 'asc' } });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    await h.prisma.configSetting.deleteMany({ where: { key: { in: ['shipping_provider', 'shipping_label_purchase'] } } });
    await db.cleanup();
    await h?.close();
  });

  // ================================================================ M-64: la migración

  describe('M-64 — esquema aditivo con sus CHECKs', () => {
    it('las columnas existen, `addressVersion` nace en 0 y los CHECKs muerden', async () => {
      const d = await db.mkDirect();
      const s = await row(d.shipment.id);
      expect({ v: s.addressVersion, at: s.addressCorrectedAt, by: s.addressCorrectedByUserId }).toEqual({ v: 0, at: null, by: null });
      // versión 1 sin sello ⇒ CHECK `shipment_address_version_iff_corrected`
      await expect(h.prisma.$executeRawUnsafe(`UPDATE "ShipmentRequest" SET "addressVersion" = 1 WHERE id = $1`, d.shipment.id)).rejects.toThrow(/shipment_address_version_iff_corrected/);
      // sello sin actor ⇒ CHECK `shipment_address_corrected_paired`
      await expect(
        h.prisma.$executeRawUnsafe(`UPDATE "ShipmentRequest" SET "addressVersion" = 1, "addressCorrectedAt" = now() WHERE id = $1`, d.shipment.id),
      ).rejects.toThrow(/shipment_address_corrected_paired/);
      // versión negativa ⇒ CHECK `shipment_address_version_nonneg`
      await expect(h.prisma.$executeRawUnsafe(`UPDATE "ShipmentRequest" SET "addressVersion" = -1, "addressCorrectedAt" = now(), "addressCorrectedByUserId" = 'x' WHERE id = $1`, d.shipment.id)).rejects.toThrow(/shipment_address_version_nonneg/);
      // CP del catálogo de 4 dígitos ⇒ CHECK `postal_code_five_digits`
      await expect(
        h.prisma.$executeRawUnsafe(`INSERT INTO "PostalCode" (id, "postalCode", state, municipality, neighborhood) VALUES ('x-${RUN}', '1000', 'E', 'M', 'C')`),
      ).rejects.toThrow(/postal_code_five_digits/);
      // ⭐ M-65 (v1.80.12.2): CHECKs de `ShipmentAddressRevision` — `changedKeys` no vacío y dentro de las claves corregibles.
      const ins = (keys: string) =>
        h.prisma.$executeRawUnsafe(
          `INSERT INTO "ShipmentAddressRevision" (id, "shipmentRequestId", "fromVersion", "changedKeys", before, after, "correctedByUserId") VALUES (gen_random_uuid()::text, $1, 0, ${keys}, '{}', '{}', 'x')`,
          d.shipment.id,
        );
      await expect(ins(`ARRAY[]::text[]`)).rejects.toThrow(/shipment_address_revision_changed_keys_nonempty/);
      await expect(ins(`ARRAY['phone']::text[]`)).rejects.toThrow(/shipment_address_revision_changed_keys_known/);
      // `Address.references` existe (nullable)
      const u = await db.mkUser();
      const a = await db.mkAddress(u.id);
      expect(a.references).toBeNull();
    });
  });

  // ================================================================ GET /geo/postal-codes/:cp

  describe('GET /geo/postal-codes/:cp — público, el mismo cuerpo que valida (C-SDX-3)', () => {
    it('200 con colonias, municipio y estado; cacheable; sin sesión', async () => {
      const r = await h.api('GET', '/geo/postal-codes/06600');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ postalCode: '06600', state: 'Ciudad de México', municipality: 'Cuauhtémoc', neighborhoods: ['Juárez', 'Roma Norte'], source: 'local' });
      expect(r.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('`:cp` mal formado ⇒ 400; desconocido ⇒ 404 POSTAL_CODE_UNKNOWN', async () => {
      const bad = await h.api('GET', '/geo/postal-codes/0660');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      const unk = await h.api('GET', '/geo/postal-codes/99999');
      expect(unk.status).toBe(404);
      expect(unk.body.error).toMatchObject({ code: 'POSTAL_CODE_UNKNOWN', details: { postalCode: '99999' } });
    });
  });

  // ================================================================ libreta (criterio 235)

  describe('libreta al nivel del invitado (§1 Direcciones, criterio 235)', () => {
    let token: string;
    let userId: string;
    const base = { recipientName: 'Ana', line1: 'Calle 1', neighborhood: 'Juárez', city: 'CDMX', state: 'CDMX', postalCode: '06600', country: 'MX', phone: '5512345678' };

    beforeAll(async () => {
      const u = await db.mkUser('Cliente Libreta');
      userId = u.id;
      token = await db.loginCustomer(u.email as string);
    });

    it('PS-114 💰 libreta (a) — colonia de la lista ⇒ 201 con el CANÓNICO (aunque se teclee en minúsculas sin acentos), city/state del CATÁLOGO aunque el cuerpo traiga otros, `complete:true`', async () => {
      const r = await h.api('POST', '/users/me/addresses', { token, json: { ...base, neighborhood: '  juarez ', references: 'Timbre 2' } });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ neighborhood: 'Juárez', city: 'Cuauhtémoc', state: 'Ciudad de México', references: 'Timbre 2', complete: true });
    });

    it('PS-114 💰 libreta (b) — CP del catálogo + colonia que NO está ⇒ 201: la colonia escrita (trim) + city/state DEL CP; `complete:true`', async () => {
      const r = await h.api('POST', '/users/me/addresses', { token, json: { ...base, neighborhood: '  Polanco  ', city: 'Miguel Hidalgo', state: 'Edomex' } });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ postalCode: '06600', neighborhood: 'Polanco', city: 'Cuauhtémoc', state: 'Ciudad de México', complete: true });
      expect(r.body).not.toHaveProperty('neighborhoodCheck'); // §19.25.3: solo en AdminShipmentDTO
      const db1 = await h.prisma.address.findUniqueOrThrow({ where: { id: r.body.id } });
      expect({ n: db1.neighborhood, c: db1.city, s: db1.state }).toEqual({ n: 'Polanco', c: 'Cuauhtémoc', s: 'Ciudad de México' });
    });

    it('PS-114 💰 libreta (c) — CP fuera del catálogo ⇒ 201 con colonia, city y state del cuerpo (trim)', async () => {
      const r = await h.api('POST', '/users/me/addresses', { token, json: { ...base, postalCode: '20000', neighborhood: ' Zona Centro ', city: ' Aguascalientes ', state: ' Aguascalientes ' } });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes', complete: true });
    });

    it('PS-114 libreta (d) — city o state vacíos/ausentes ⇒ 400 VALIDATION_ERROR; cero filas', async () => {
      const before = await h.prisma.address.count({ where: { userId } });
      for (const json of [{ ...base, city: '   ' }, { ...base, state: '' }, { ...base, city: undefined }, { ...base, state: undefined }]) {
        const r = await h.api('POST', '/users/me/addresses', { token, json });
        expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      }
      expect(await h.prisma.address.count({ where: { userId } })).toBe(before);
    });

    it('sin colonia, CP de 4, teléfono de 7 o referencias de 71 ⇒ 400 (forma)', async () => {
      for (const json of [
        { ...base, neighborhood: undefined },
        { ...base, postalCode: '0660' },
        { ...base, phone: '5512345' },
        { ...base, references: 'x'.repeat(71) },
      ]) {
        const r = await h.api('POST', '/users/me/addresses', { token, json });
        expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      }
    });

    it('PS-114 💰 PATCH con `postalCode` exige neighborhood, city y state (el primero que falte, en ese orden) ⇒ 400 required_with_postal_code, cero escrituras; con los tres ⇒ resolución', async () => {
      const a = await h.api('POST', '/users/me/addresses', { token, json: base });
      const row0 = JSON.stringify(await h.prisma.address.findUniqueOrThrow({ where: { id: a.body.id } }));
      for (const [json, field] of [
        [{ postalCode: '01000' }, 'neighborhood'],
        [{ postalCode: '01000', neighborhood: 'san angel' }, 'city'],
        [{ postalCode: '01000', neighborhood: 'san angel', state: 'CDMX' }, 'city'],
        [{ postalCode: '01000', neighborhood: 'san angel', city: 'X' }, 'state'],
      ] as const) {
        const bad = await h.api('PATCH', `/users/me/addresses/${a.body.id}`, { token, json });
        expect({ status: bad.status, details: bad.body.error?.details }).toEqual({ status: 400, details: { field, reason: 'required_with_postal_code' } });
      }
      expect(JSON.stringify(await h.prisma.address.findUniqueOrThrow({ where: { id: a.body.id } }))).toBe(row0);
      // (a) colonia de la lista tecleada a mano ⇒ canónico + municipio/estado del catálogo (no los del cuerpo)
      const ok = await h.api('PATCH', `/users/me/addresses/${a.body.id}`, { token, json: { postalCode: '01000', neighborhood: 'san angel', city: 'X', state: 'Y' } });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ postalCode: '01000', neighborhood: 'San Ángel', city: 'Álvaro Obregón', state: 'Ciudad de México' });
      // (c) a un CP fuera del catálogo ⇒ lo escrito
      const out = await h.api('PATCH', `/users/me/addresses/${a.body.id}`, { token, json: { postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' } });
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes', complete: true });
    });

    it('una dirección vieja sin colonia sale `complete:false` y el retiro con ella ⇒ 422 ADDRESS_INCOMPLETE {addressId, missing}, cero envíos', async () => {
      const old = await h.prisma.address.create({
        data: { userId, recipientName: 'Ana', line1: 'Calle Vieja', city: 'CDMX', state: 'CDMX', postalCode: '1000', country: 'MX', phone: '55123' },
      });
      const list = await h.api('GET', '/users/me/addresses', { token });
      expect(list.body.data.find((x: any) => x.id === old.id)).toMatchObject({ complete: false, references: null });
      const piece = await db.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: userId, ownershipStatus: 'settled' });
      const before = await h.prisma.shipmentRequest.count({ where: { userId } });
      const r = await h.api('POST', '/shipments', { token, json: { inventoryItemIds: [piece.id], addressId: old.id } });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code: 'ADDRESS_INCOMPLETE', details: { addressId: old.id, missing: ['neighborhood', 'postalCode', 'phone'] } });
      expect(await h.prisma.shipmentRequest.count({ where: { userId } })).toBe(before);
    });
  });

  // ================================================================ PS-114 — checkout de invitado

  describe('PS-114 💰 — checkout de invitado: la colonia es texto; el catálogo ayuda y NO bloquea (§19.25.1)', () => {
    const address = { line1: 'Av. Juárez 10', neighborhood: 'Guadalajara Centro', city: 'GDL', state: 'JAL', postalCode: '44100', country: 'MX', phone: '3312345678', recipientName: 'Luis' };
    let seq = 0;
    /** Pieza vendible propia de esta corrida (plantilla del arnés: la de `listedCharizard`, con precio). */
    const newItem = async () => {
      const tpl = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard } });
      const it = await h.prisma.inventoryItem.create({
        data: {
          folio: `SDXC-G-${RUN}-${(seq += 1)}`, cardId: tpl.cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal',
          ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 70000, locationId: tpl.locationId,
        },
      });
      db.items.push(it.id);
      return it;
    };
    const email = (k: string) => `g.${k}.${RUN}@example.com`;
    const session = async (shippingAddress: unknown, k: string, itemId?: string) => {
      const r = await h.api('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [itemId ?? (await newItem()).id], email: email(k), shippingAddress, acceptedTerms: true },
      });
      if (r.status === 201) db.orders.push(r.body.orderId);
      return r;
    };
    const snapOf = async (orderId: string) => (await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).shippingAddressSnapshot as Record<string, unknown>;

    it('(a) colonia de la lista en minúsculas ⇒ 201, snapshot con el canónico y city/state del CATÁLOGO (no los del cuerpo)', async () => {
      const r = await session({ ...address, neighborhood: ' guadalajara   centro ' }, 'a');
      expect(r.status).toBe(201);
      expect(await snapOf(r.body.orderId)).toMatchObject({ postalCode: '44100', neighborhood: 'Guadalajara Centro', city: 'Guadalajara', state: 'Jalisco' });
    });

    it('(b) CP del catálogo + colonia que NO está ⇒ 201, la colonia escrita + city/state del CP', async () => {
      const r = await session({ ...address, neighborhood: '  Colonia Nueva  ' }, 'b');
      expect(r.status).toBe(201);
      expect(await snapOf(r.body.orderId)).toMatchObject({ postalCode: '44100', neighborhood: 'Colonia Nueva', city: 'Guadalajara', state: 'Jalisco' });
    });

    it('(c) CP fuera del catálogo ⇒ 201 con colonia, city y state del cuerpo', async () => {
      const r = await session({ ...address, postalCode: '20000', neighborhood: 'Zona Centro', city: ' Aguascalientes ', state: 'Aguascalientes' }, 'c');
      expect(r.status).toBe(201);
      expect(await snapOf(r.body.orderId)).toMatchObject({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
    });

    it('(d) sin colonia, o city/state vacíos ⇒ 400 VALIDATION_ERROR; cero órdenes', async () => {
      const k = 'd';
      const before = await h.prisma.order.count({ where: { guestEmail: email(k) } });
      const { neighborhood: _n, ...sinColonia } = address;
      for (const a of [sinColonia, { ...address, city: '' }, { ...address, state: '   ' }]) {
        const r = await session(a, k, '00000000-0000-0000-0000-000000000000');
        expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
      }
      expect(await h.prisma.order.count({ where: { guestEmail: email(k) } })).toBe(before);
    });

    it('💰 con `PostalCode` VACÍA, un invitado con CP 20000 y colonia escrita CREA la orden y su PaymentIntent (la tienda vende con el catálogo vacío)', async () => {
      const saved = await h.prisma.postalCode.findMany();
      await h.prisma.postalCode.deleteMany({});
      try {
        expect(await h.prisma.postalCode.count()).toBe(0);
        // el GET dice «escribe a mano» (404), y escribir a mano PAGA
        expect((await h.api('GET', '/geo/postal-codes/20000')).status).toBe(404);
        const r = await session({ ...address, postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' }, 'empty');
        expect(r.status).toBe(201);
        expect(r.body.stripe.paymentIntentId).toEqual(expect.any(String));
        const o = await h.prisma.order.findUniqueOrThrow({ where: { id: r.body.orderId } });
        expect(o.stripePaymentIntentId).toBe(r.body.stripe.paymentIntentId);
        expect(o.shippingAddressSnapshot).toMatchObject({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
        // también un CP que el catálogo SÍ tendría: con la tabla vacía, lo escrito
        const r2 = await session({ ...address, neighborhood: 'Guadalajara Centro', city: 'GDL', state: 'JAL' }, 'empty2');
        expect(r2.status).toBe(201);
        expect(await snapOf(r2.body.orderId)).toMatchObject({ neighborhood: 'Guadalajara Centro', city: 'GDL', state: 'JAL' });
      } finally {
        await h.prisma.postalCode.createMany({ data: saved, skipDuplicates: true });
      }
      expect(await h.prisma.postalCode.count()).toBe(saved.length);
    });

    it('POST /checkout/guest/quote con colonia inventada ⇒ 200 (el quote no consulta el catálogo)', async () => {
      const it = await newItem();
      const r = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [it.id], shippingAddress: { ...address, neighborhood: 'Colonia Que No Existe' } },
      });
      expect(r.status).toBe(200);
      const unk = await h.api('POST', '/checkout/guest/quote', {
        json: { inventoryItemIds: [it.id], shippingAddress: { ...address, postalCode: '99999', neighborhood: 'Otra' } },
      });
      expect(unk.status).toBe(200);
    });
  });

  // ================================================================ PS-102 — corrección completa

  describe('PUT /admin/shipments/:id/address — PS-102 (corrección completa)', () => {
    it('PS-102 💰 — 200 corrected: snapshot con lo tecleado y city/state CANÓNICOS; orden intacta; versión +1; sello; UNA bitácora con antes/después de lo cambiado', async () => {
      const d = await db.mkDirect();
      const orderBefore = await h.prisma.order.findUniqueOrThrow({ where: { id: d.order.id } });
      const t0 = Date.now();
      // el cuerpo trae `city`/`state` distintos (CP en el catálogo ⇒ ganan los del catálogo, §19.25.1) y `phone`/`country`
      // de más (se IGNORAN: phone no cambia, P-ADR-1).
      const r = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, city: 'Inventada', state: 'Inventado', phone: '0000000000', country: 'US' });
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe('corrected');
      const s = await row(d.shipment.id);
      expect(s.addressSnapshot).toEqual({
        recipientName: 'Ana Gómez Ruiz',
        line1: 'Av. Revolución 1500',
        line2: 'Int. 4',
        postalCode: '01000',
        neighborhood: 'San Ángel',
        city: 'Álvaro Obregón',
        state: 'Ciudad de México',
        country: 'MX',
        phone: '55', // el del pedido, intacto (P-ADR-1)
        references: 'Portón negro junto a la farmacia',
      });
      expect(s.addressVersion).toBe(1);
      expect(s.addressCorrectedByUserId).toBe(db.operatorId);
      expect(s.addressCorrectedAt!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);
      // ⛔ la orden: byte a byte
      const orderAfter = await h.prisma.order.findUniqueOrThrow({ where: { id: d.order.id } });
      expect(JSON.stringify(orderAfter.shippingAddressSnapshot)).toBe(JSON.stringify(orderBefore.shippingAddressSnapshot));
      expect(orderAfter.shippingFeeCents).toBe(orderBefore.shippingFeeCents);
      // la bitácora: una fila, el actor, SOLO las claves cambiadas
      const logs = await auditOf(d.shipment.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actorUserId: db.operatorId, actorRole: 'vault_operator', entityType: 'ShipmentRequest' });
      // ⭐ v1.80.12.2 (§M4-SHIP.19.22.1, SKX-SEC-1): la bitácora NO lleva valores — versión, claves y la revisión.
      const KEYS = ['recipientName', 'line1', 'line2', 'neighborhood', 'city', 'state', 'references'];
      const revs = await revisionsOf(d.shipment.id);
      expect(revs).toHaveLength(1);
      expect(logs[0].before).toEqual({ addressVersion: 0 });
      expect(logs[0].after).toEqual({ addressVersion: 1, changedKeys: KEYS, revisionId: revs[0].id });
      // los VALORES viven en la revisión. CP y país NO cambiaron (01000/MX ya estaban): no aparecen; lo ausente ⇒ null.
      expect(revs[0]).toMatchObject({ fromVersion: 0, changedKeys: KEYS, correctedByUserId: db.operatorId });
      expect(revs[0].before).toEqual({
        recipientName: 'Destinatario Directo', line1: 'Calle 1', line2: null, neighborhood: null, city: 'CDMX', state: 'CDMX', references: null,
      });
      expect(revs[0].after).toEqual({
        recipientName: 'Ana Gómez Ruiz', line1: 'Av. Revolución 1500', line2: 'Int. 4', neighborhood: 'San Ángel',
        city: 'Álvaro Obregón', state: 'Ciudad de México', references: 'Portón negro junto a la farmacia',
      });
      // el DTO de admin: `address` con versión, quién y QUÉ FALTA (v1.80.12.2: `missing` siempre presente)
      expect(r.body.shipment.address).toEqual({
        complete: false, // teléfono de 2 dígitos en el pedido: la guía va a mano (P-ADR-1)
        version: 1,
        corrected: { at: s.addressCorrectedAt!.toISOString(), by: { userId: db.operatorId, name: expect.any(String) } },
        missing: ['phone'],
        neighborhoodCheck: 'in_catalog', // ⭐ v1.80.12.5 (§19.25.3)
      });
      // mismo cuerpo otra vez ⇒ `unchanged`, cero bitácora, versión intacta
      const again = await put(d.shipment.id, { expectedAddressVersion: 1, ...CORRECTION });
      expect(again.status).toBe(200);
      expect(again.body.outcome).toBe('unchanged');
      expect(await auditOf(d.shipment.id)).toHaveLength(1);
      expect(await revisionsOf(d.shipment.id)).toHaveLength(1);
      expect((await row(d.shipment.id)).addressVersion).toBe(1);
    });

    it('PS-102 — retiro: la libreta del cliente (`Address`) queda IDÉNTICA; la cola de preparación ve `addressCorrected`', async () => {
      const u = await db.mkUser('Cliente Retiro');
      const addr = await db.mkAddress(u.id);
      const v = await db.mkVaultOrder(u.id, { placement: 'none' });
      const w = await db.mkWithdrawal(u.id, [v.pieces[0].id], 'picking');
      const r = await put(w.shipment.id, { expectedAddressVersion: 0, ...CORRECTION });
      expect(r.status).toBe(200);
      const addrAfter = await h.prisma.address.findUniqueOrThrow({ where: { id: addr.id } });
      expect(JSON.stringify(addrAfter)).toBe(JSON.stringify(addr));
      const q = await db.queue();
      const o = q.body.data.find((x: any) => x.shipmentId === w.shipment.id);
      expect(o.shipTo).toMatchObject({ neighborhood: 'San Ángel', references: 'Portón negro junto a la farmacia', addressCorrected: true });
    });
  });

  // ================================================================ address.missing (v1.80.12.2)

  describe('`AdminShipmentDTO.address.missing` — siempre presente; `complete` ⇔ `missing` vacío (§M4-SHIP.19.22.2)', () => {
    it('snapshot legado SIN destinatario pero con colonia/CP/teléfono ⇒ `missing:[recipientName]`, `complete:false`; completo ⇒ `[]`, `true`', async () => {
      const d = await db.mkDirect();
      await h.prisma.shipmentRequest.update({
        where: { id: d.shipment.id },
        data: { addressSnapshot: { line1: 'Calle 1', neighborhood: 'Centro', city: 'Álvaro Obregón', state: 'Ciudad de México', postalCode: '01000', country: 'MX', phone: '5512345678' } },
      });
      const g = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
      expect(g.body.address).toMatchObject({ complete: false, missing: ['recipientName'] });
      const list = await h.api('GET', `/admin/shipments?q=${d.shipment.id}`, { token: db.opToken });
      expect(list.body.data[0].address).toMatchObject({ complete: false, missing: ['recipientName'] });
      await h.prisma.shipmentRequest.update({
        where: { id: d.shipment.id },
        data: { addressSnapshot: { recipientName: 'Ana', line1: 'Calle 1', neighborhood: 'Centro', city: 'Álvaro Obregón', state: 'Ciudad de México', postalCode: '01000', country: 'MX', phone: '5512345678' } },
      });
      const g2 = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
      expect(g2.body.address).toMatchObject({ complete: true, missing: [] });
    });
  });

  // ================================================================ PS-103 — v1.80.12.5 (sustituida, §19.25.6)

  describe('PS-103 💰 (v1.80.12.5) — `resolveAddressGeo` en `PUT …/address`: nunca 422 geográfico; la forma, cero escrituras', () => {
    it('(a) CP del catálogo + colonia de la lista en minúsculas sin acentos ⇒ el canónico y city/state del catálogo AUNQUE el cuerpo traiga otros', async () => {
      const d = await db.mkDirect();
      const r = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, neighborhood: '  SAN   angel ', city: 'Inventada', state: 'Inventado' });
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe('corrected');
      expect((await row(d.shipment.id)).addressSnapshot).toMatchObject({ postalCode: '01000', neighborhood: 'San Ángel', city: 'Álvaro Obregón', state: 'Ciudad de México' });
    });

    it('(b) CP del catálogo + colonia que no está ⇒ 200 corrected, colonia tal cual (trim), city/state DEL CP', async () => {
      const d = await db.mkDirect();
      const r = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, postalCode: '06600', neighborhood: '  Colonia Escrita  ', city: 'Inventada', state: 'Inventado' });
      expect({ status: r.status, outcome: r.body.outcome }).toEqual({ status: 200, outcome: 'corrected' });
      expect((await row(d.shipment.id)).addressSnapshot).toMatchObject({ postalCode: '06600', neighborhood: 'Colonia Escrita', city: 'Cuauhtémoc', state: 'Ciudad de México' });
      expect(r.body.shipment.address.neighborhoodCheck).toBe('not_in_postal_code_list');
    });

    it('(c) CP fuera del catálogo ⇒ 200 corrected con colonia, city y state del cuerpo', async () => {
      const d = await db.mkDirect();
      const r = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, postalCode: '99999', neighborhood: 'Zona Centro', city: ' Aguascalientes ', state: 'Aguascalientes' });
      expect({ status: r.status, outcome: r.body.outcome }).toEqual({ status: 200, outcome: 'corrected' });
      expect((await row(d.shipment.id)).addressSnapshot).toMatchObject({ postalCode: '99999', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
      expect(r.body.shipment.address.neighborhoodCheck).toBe('postal_code_not_in_catalog');
    });

    it('(d) CP de 4, references de 71, recipientName, line1, city o state vacíos (o ausentes) ⇒ 400 {field}; cero escrituras y versión intacta', async () => {
      const d = await db.mkDirect();
      const snap0 = JSON.stringify((await row(d.shipment.id)).addressSnapshot);
      const cases: [unknown, string][] = [
        [{ ...CORRECTION, postalCode: '0100' }, 'postalCode'],
        [{ ...CORRECTION, references: 'x'.repeat(71) }, 'references'],
        [{ ...CORRECTION, recipientName: '   ' }, 'recipientName'],
        [{ ...CORRECTION, line1: '' }, 'line1'],
        [{ ...CORRECTION, city: '  ' }, 'city'],
        [{ ...CORRECTION, state: '' }, 'state'],
        [{ ...CORRECTION, city: undefined }, 'city'],
        [{ ...CORRECTION, state: undefined }, 'state'],
      ];
      for (const [body, field] of cases) {
        const r = await put(d.shipment.id, { expectedAddressVersion: 0, ...(body as object) });
        expect({ status: r.status, code: r.body.error?.code, field: r.body.error?.details?.field }).toEqual({ status: 400, code: 'VALIDATION_ERROR', field });
      }
      const noVersion = await put(d.shipment.id, { ...CORRECTION });
      expect(noVersion.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'expectedAddressVersion' } });
      const s = await row(d.shipment.id);
      expect(JSON.stringify(s.addressSnapshot)).toBe(snap0);
      expect(s.addressVersion).toBe(0);
      expect(await auditOf(d.shipment.id)).toHaveLength(0);
      expect(await revisionsOf(d.shipment.id)).toHaveLength(0);
    });
  });

  // ================================================================ PS-115 — neighborhoodCheck (§19.25.3)

  describe('PS-115 — `address.neighborhoodCheck` se calcula AL LEER (nunca se guarda)', () => {
    const CP = '20000';
    afterEach(async () => {
      await h.prisma.postalCode.deleteMany({ where: { postalCode: CP } });
    });

    it('el MISMO envío, escrito por el verbo con el CP fuera del catálogo, pasa a in_catalog al cargar su CP sin tocar el envío; los tres valores; tras PUT con colonia de la lista ⇒ in_catalog', async () => {
      await h.prisma.postalCode.deleteMany({ where: { postalCode: CP } });
      const d = await db.mkDirect();
      const check = async () => {
        const g = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
        const l = await h.api('GET', `/admin/shipments?q=${d.shipment.id}`, { token: db.opToken });
        expect(l.body.data[0].address.neighborhoodCheck).toBe(g.body.address.neighborhoodCheck); // fila y detalle
        return g.body.address.neighborhoodCheck as string;
      };
      // escrito por el VERBO con el CP fuera del catálogo (así es como una marca guardada al escribir quedaría vieja)
      const w0 = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, postalCode: CP, neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
      expect(w0.status).toBe(200);
      expect(w0.body.shipment.address.neighborhoodCheck).toBe('postal_code_not_in_catalog');
      expect(await check()).toBe('postal_code_not_in_catalog');
      const before = await row(d.shipment.id);
      // ⛔ no se guarda: ni en el snapshot ni en ninguna columna
      expect(JSON.stringify(before)).not.toContain('neighborhoodCheck');
      expect(JSON.stringify(before)).not.toMatch(/in_catalog|not_in_postal_code_list/);

      // se carga el CP con OTRA colonia ⇒ la del envío no está en la lista
      await h.prisma.postalCode.create({ data: { postalCode: CP, neighborhood: 'Barrio de San Marcos', municipality: 'Aguascalientes', state: 'Aguascalientes' } });
      expect(await check()).toBe('not_in_postal_code_list');

      // se carga la suya (con otra grafía) ⇒ in_catalog, y el envío NO se tocó
      await h.prisma.postalCode.create({ data: { postalCode: CP, neighborhood: 'ZONA CENTRO', municipality: 'Aguascalientes', state: 'Aguascalientes' } });
      expect(await check()).toBe('in_catalog');
      expect(JSON.stringify(await row(d.shipment.id))).toBe(JSON.stringify(before)); // la fila entera, byte a byte

      // corregido a una colonia escrita ⇒ not_in_postal_code_list; luego a una de la lista ⇒ in_catalog
      const w = await put(d.shipment.id, { expectedAddressVersion: 1, ...CORRECTION, postalCode: CP, neighborhood: 'Inventada', city: 'X', state: 'Y' });
      expect(w.body.shipment.address.neighborhoodCheck).toBe('not_in_postal_code_list');
      const ok = await put(d.shipment.id, { expectedAddressVersion: 2, ...CORRECTION, postalCode: CP, neighborhood: 'barrio de san marcos', city: 'X', state: 'Y' });
      expect(ok.body.shipment.address.neighborhoodCheck).toBe('in_catalog');
      expect(await check()).toBe('in_catalog');
      // y si el catálogo pierde el CP, vuelve a decirlo (lectura, no marca)
      await h.prisma.postalCode.deleteMany({ where: { postalCode: CP } });
      expect(await check()).toBe('postal_code_not_in_catalog');
    });

    it('snapshot sin colonia ⇒ postal_code_not_in_catalog; ausente en AddressDTO y en ShipPreparationOrderDTO', async () => {
      const d = await db.mkDirect(); // snapshot del arnés: CP 01000 (en catálogo) SIN colonia
      const g = await h.api('GET', `/admin/shipments/${d.shipment.id}`, { token: db.opToken });
      expect(g.body.address.neighborhoodCheck).toBe('postal_code_not_in_catalog');
      const q = await db.queue();
      const o = q.body.data.find((x: any) => x.shipmentId === d.shipment.id);
      expect(o).toBeDefined();
      expect(JSON.stringify(o)).not.toContain('neighborhoodCheck');
      const u = await db.mkUser('Cliente PS-115');
      await db.mkAddress(u.id);
      const token = await db.loginCustomer(u.email as string);
      const list = await h.api('GET', '/users/me/addresses', { token });
      expect(list.body.data.length).toBeGreaterThan(0);
      expect(JSON.stringify(list.body)).not.toContain('neighborhoodCheck');
    });
  });

  // ================================================================ PS-104 — guardas y carrera

  describe('PS-104 💰 — guardas en el orden del paso 3, y dos correcciones a la vez', () => {
    it('guia/enviado (toda guía manual) ⇒ 409 SHIPMENT_NOT_IN_PREPARATION; versión vieja ⇒ 409 CONFLICT {address_changed}; inexistente ⇒ 404', async () => {
      for (const st of ['guia', 'enviado', 'entregado', 'cancelado', 'solicitado'] as const) {
        const d = await db.mkDirect();
        await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { status: st, ...(st === 'guia' || st === 'enviado' ? { carrier: 'DHL', trackingNumber: `T-${RUN}-${st}` } : {}) } });
        const r = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION });
        expect({ st, status: r.status, code: r.body.error?.code, details: r.body.error?.details }).toEqual({ st, status: 409, code: 'SHIPMENT_NOT_IN_PREPARATION', details: { status: st } });
      }
      // `picking` con una guía legada (fila anterior a `labelSource`): `labelSourceOf` ⇒ 'manual' ⇒ 409 ALREADY_LABELED
      const legacy = await db.mkDirect();
      await h.prisma.shipmentRequest.update({ where: { id: legacy.shipment.id }, data: { carrier: 'DHL', trackingNumber: `L-${RUN}` } });
      const lr = await put(legacy.shipment.id, { expectedAddressVersion: 0, ...CORRECTION });
      expect({ status: lr.status, code: lr.body.error?.code, details: lr.body.error?.details }).toEqual({ status: 409, code: 'SHIPMENT_ALREADY_LABELED', details: { labelSource: 'manual' } });

      const d = await db.mkDirect();
      expect((await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION })).status).toBe(200);
      const stale = await put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, line1: 'Otra calle 2' });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'address_changed', addressVersion: 1 } });
      expect((await put('00000000-0000-0000-0000-000000000000', { expectedAddressVersion: 0, ...CORRECTION })).status).toBe(404);
    });

    it(`PS-104 💰 carrera — dos correcciones DISTINTAS con la misma versión, entrelazadas por barrera ⇒ exactamente una 200 y una 409 (N = ${N})`, async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < N; i++) {
        const d = await db.mkDirect();
        const lock = await db.holdRow('ShipmentRequest', d.shipment.id);
        const a = put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, line1: `Calle A ${i}` });
        const b = put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION, line1: `Calle B ${i}` });
        expect(await db.waitRowBlocked(2)).toBe(true); // las DOS esperan el candado: el entrelazado es real
        await lock.release();
        const rs = await Promise.all([a, b]);
        const s = await row(d.shipment.id);
        const logs = await auditOf(d.shipment.id);
        const revs = await revisionsOf(d.shipment.id);
        const winner = rs.find((r) => r.status === 200);
        const sorted = rs.map(code).sort().join(',');
        const ok =
          sorted === '200:corrected,409:CONFLICT/address_changed' &&
          s.addressVersion === 1 &&
          logs.length === 1 &&
          revs.length === 1 &&
          (s.addressSnapshot as any).line1 === (winner ? (revs[0].after as any).line1 : null);
        outcomes.push(ok ? `ok(${sorted})` : `MAL(${sorted};v=${s.addressVersion};logs=${logs.length})`);
      }
      expect(report('PS-104 dos correcciones', outcomes, (o) => o.startsWith('ok'))).toBe(N);
    });

    it(`criterio 315 (e), fase C — corrección contra captura de guía MANUAL a la vez (N = ${N}): nunca una corrección aceptada sobre un envío que ya tiene guía`, async () => {
      const outcomes: string[] = [];
      for (let i = 0; i < N; i++) {
        const d = await db.mkDirect();
        await h.prisma.shipmentRequest.update({ where: { id: d.shipment.id }, data: { preparedAt: new Date(), preparedByUserId: db.operatorId } });
        const lock = await db.holdRow('ShipmentRequest', d.shipment.id);
        // alterna quién llega primero a la cola del candado
        const first = i % 2 === 0 ? () => put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION }) : () => db.tracking(d.shipment.id);
        const second = i % 2 === 0 ? () => db.tracking(d.shipment.id) : () => put(d.shipment.id, { expectedAddressVersion: 0, ...CORRECTION });
        const p1 = first();
        expect(await db.waitRowBlocked(1)).toBe(true);
        const p2 = second();
        expect(await db.waitRowBlocked(2)).toBe(true);
        await lock.release();
        const [r1, r2] = await Promise.all([p1, p2]);
        const [corr, trk] = i % 2 === 0 ? [r1, r2] : [r2, r1];
        const s = await row(d.shipment.id);
        const logs = await auditOf(d.shipment.id);
        // Orden de la cola: corrección primero ⇒ las dos 200 (la guía se captura ya con la dirección corregida);
        // guía primero ⇒ la corrección 409 SHIPMENT_NOT_IN_PREPARATION y el snapshot intacto.
        const expected = i % 2 === 0 ? ['200:corrected', '200:ok'] : ['409:SHIPMENT_NOT_IN_PREPARATION', '200:ok'];
        const got = [code(corr), trk.status === 200 || trk.status === 201 ? '200:ok' : code(trk)];
        const coherent =
          s.status === 'guia' &&
          (corr.status === 200 ? s.addressVersion === 1 && logs.length === 1 : s.addressVersion === 0 && logs.length === 0);
        outcomes.push(JSON.stringify(got) === JSON.stringify(expected) && coherent ? `ok(${got.join(',')})` : `MAL(${got.join(',')};v=${s.addressVersion};st=${s.status})`);
      }
      expect(report('criterio 315(e) fase C · corrección vs guía manual', outcomes, (o) => o.startsWith('ok'))).toBe(N);
    });
  });

  // ================================================================ PS-112 — SKX-SEC-1 (prueba de release)

  describe('PS-112 🔒 — el domicilio NUNCA entra a la bitácora y la anonimización borra sus revisiones (v1.80.12.2)', () => {
    it('retiro (userId) + envío directo (userId:null, order.userId): 4 correcciones ⇒ bitácora sin canarios; borrado suave ⇒ 0 revisiones suyas, bitácora intacta, las de otro cliente intactas', async () => {
      const C = `CANARIO-${RUN}`;
      const corr = (k: string) => ({ ...CORRECTION, recipientName: `${C}-nom-${k}`, line1: `${C}-calle-${k}`, line2: `${C}-int-${k}`, references: `${C}-ref-${k}` });
      const canaryLogs = () =>
        h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "AuditLog" WHERE before::text LIKE $1 OR after::text LIKE $1`,
          `%${C}%`,
        );

      const u = await db.mkUser('Cliente Anonimizable');
      const v = await db.mkVaultOrder(u.id, { placement: 'none' });
      const w = await db.mkWithdrawal(u.id, [v.pieces[0].id], 'picking');
      const d = await db.mkDirect({ userId: u.id });
      expect((await row(d.shipment.id)).userId).toBeNull(); // el directo nace sin userId: su dueño es la orden
      const other = await db.mkUser('Otro Cliente');
      const od = await db.mkDirect({ userId: other.id });

      for (const [id, k] of [[w.shipment.id, 'w'], [d.shipment.id, 'd']] as const) {
        expect((await put(id, { expectedAddressVersion: 0, ...corr(`${k}1`) })).status).toBe(200);
        expect((await put(id, { expectedAddressVersion: 1, ...corr(`${k}2`) })).status).toBe(200);
      }
      expect((await put(od.shipment.id, { expectedAddressVersion: 0, ...corr('otro') })).status).toBe(200);

      const mine = [w.shipment.id, d.shipment.id];
      expect(await h.prisma.shipmentAddressRevision.count({ where: { shipmentRequestId: { in: mine } } })).toBe(4);
      expect(await h.prisma.auditLog.count({ where: { entityId: { in: mine }, action: 'shipment.address_corrected' } })).toBe(4);
      // (1) ANTES de anonimizar: la bitácora nunca tuvo los valores (tabla ENTERA, toda acción).
      expect(Number((await canaryLogs())[0].n)).toBe(0);

      const del = await h.api('DELETE', `/admin/users/${u.id}`, { token: db.adminToken });
      expect(del.status).toBe(200);
      expect(del.body.mode).toBe('soft');

      // (1) después, tampoco.
      expect(Number((await canaryLogs())[0].n)).toBe(0);
      // (2) cero revisiones de SUS dos envíos (también el directo, alcanzado por `order.userId`).
      expect(await h.prisma.shipmentAddressRevision.count({ where: { shipmentRequestId: { in: mine } } })).toBe(0);
      // (3) las 4 filas de bitácora siguen, con claves y versiones.
      const logs = await h.prisma.auditLog.findMany({ where: { entityId: { in: mine }, action: 'shipment.address_corrected' } });
      expect(logs).toHaveLength(4);
      for (const l of logs) {
        expect((l.after as { changedKeys: string[] }).changedKeys).toEqual(expect.arrayContaining(['recipientName', 'line1', 'line2', 'references']));
        expect(Object.keys(l.after as object).sort()).toEqual(['addressVersion', 'changedKeys', 'revisionId']);
        expect([1, 2]).toContain((l.after as { addressVersion: number }).addressVersion);
      }
      // (4) las del OTRO cliente, intactas (con sus valores).
      const otherRevs = await revisionsOf(od.shipment.id);
      expect(otherRevs).toHaveLength(1);
      expect((otherRevs[0].after as { line1: string }).line1).toBe(`${C}-calle-otro`);
    });
  });

  // ================================================================ PS-107 — roles y diales

  describe('PS-107 — roles y diales', () => {
    it('vault_operator y super_admin ⇒ 200; customer ⇒ 403; con `shipping_provider=off` y `shipping_label_purchase=disabled` ⇒ 200 igual', async () => {
      await h.prisma.configSetting.upsert({ where: { key: 'shipping_provider' }, create: { key: 'shipping_provider', valueJson: 'off' }, update: { valueJson: 'off' } });
      await h.prisma.configSetting.upsert({ where: { key: 'shipping_label_purchase' }, create: { key: 'shipping_label_purchase', valueJson: 'disabled' }, update: { valueJson: 'disabled' } });
      const d1 = await db.mkDirect();
      expect((await put(d1.shipment.id, { expectedAddressVersion: 0, ...CORRECTION }, db.opToken)).status).toBe(200);
      const d2 = await db.mkDirect();
      expect((await put(d2.shipment.id, { expectedAddressVersion: 0, ...CORRECTION }, db.adminToken)).status).toBe(200);
      const d3 = await db.mkDirect();
      const customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      const c = await put(d3.shipment.id, { expectedAddressVersion: 0, ...CORRECTION }, customerToken);
      expect(c.status).toBe(403);
      expect((await row(d3.shipment.id)).addressVersion).toBe(0);
    });
  });
});
