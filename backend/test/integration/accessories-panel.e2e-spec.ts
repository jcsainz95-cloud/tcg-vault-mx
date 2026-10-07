/**
 * accessories-panel.e2e-spec.ts — stream (A) de v1.86⟨accesorios⟩ contra la app REAL y Postgres REAL.
 * API_CONTRACT §AC.3 (tienda pública), §AC.7 «Cajas en el panel», §AC.11 (panel), §AC.13. Propiedad: backend.
 *
 * Pruebas de §AC.14 que cubre (la parte que no es cobro; la de `quote`/`session`/`track` es del stream (B)):
 *  - **AC-B3**  público: inactivos fuera, agotados al final, ⛔ ninguna llave de costo/existencias/`suggested`/medidas
 *               (lista, ficha, sugerencias).
 *  - **AC-B4**  foto por HTTP: PNG/JPG/WebP aceptados; texto renombrado `.png` ⇒ `422`; 10 MiB + 1 ⇒ `422 too_large`
 *               (⛔ no el `413` de multer); nada persistido en rechazo.
 *  - **AC-B6**  activar: `422 {missing}` exacto.
 *  - **AC-B7**  permisos: `403 FORBIDDEN_FIELD` (precio, costo, «Sugerido»); `403` en activar/desactivar/borrar, `PUT` de
 *               cajas y diales; operador ⇒ ok en alta, foto y existencias; `unitCostCents` AUSENTE para el operador.
 *  - **AC-B8**  existencias: `adjust` sin motivo ⇒ `400`; CAS ⇒ `409 STOCK_CONFLICT`; bajo lo apartado ⇒ `409`;
 *               movimiento con actor, antes y después; bitácora.
 *  - **AC-B9**  borrar con ventas ⇒ `409 ACCESSORY_HAS_SALES` (renglón suelto y componente de paquete); sin ventas ⇒ `204`.
 *  - **AC-B23** sugerencias por HTTP: 2 «Sugerido» + el más vendido en 30 días; nunca inactivo/agotado/excluido/energía;
 *               el dial cambia N; `Cache-Control: public, max-age=60`.
 *  - **AC-B39** foto pública: `immutable` + `nosniff`; versión vieja ⇒ `404`; se sirve aunque esté inactivo.
 *  - **AC-B40** `PUT /admin/shipping/packages` con `customerFeeCents`: rango, bitácora antes/después, operador `403`.
 *  - **AC-B45** (mitad de activación) energía sin medidas ⇒ ok; sin foto ⇒ `{missing:['photo']}` exacto; dos activas
 *               del mismo tipo ⇒ `409 ENERGY_TYPE_TAKEN`.
 *
 * Datos: todo lo creado lleva el prefijo `RUN` en el nombre y se borra en `afterAll`; las cajas y los diales se
 * restauran. ⛔ No toca las 8 energías de la semilla (las mide AC-B1).
 */
import * as http from 'http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { E2EHarness, ApiResponse } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

jest.setTimeout(120_000);

const RUN = `acA${Date.now().toString(36)}`;
const MiB = 1024 * 1024;

describe('v1.86⟨accesorios⟩ stream (A) — panel, tienda y fotos', () => {
  let h: E2EHarness;
  let admin: string;
  let op: string;
  let adminId: string;
  let opId: string;
  let PNG: Buffer;
  let JPG: Buffer;
  let WEBP: Buffer;

  const created: string[] = [];
  let packagesBefore: unknown;
  const DIAL_KEYS = ['energy_bundle_price_cents', 'accessory_suggestion_count'];
  let dialsBefore: { key: string; valueJson: unknown }[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    op = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id;
    opId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } })).id;
    PNG = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c00' } }).png().toBuffer();
    JPG = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#0c0' } }).jpeg().toBuffer();
    WEBP = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#00c' } }).webp().toBuffer();
    packagesBefore = (await h.api('GET', '/admin/shipping/packages', { token: admin })).body;
    // Los diales pueden venir sembrados (`seed-e2e` siembra todos los defaults): se guardan y se reponen al final.
    dialsBefore = await h.prisma.configSetting.findMany({ where: { key: { in: DIAL_KEYS } }, select: { key: true, valueJson: true } });
  });

  afterAll(async () => {
    if (!h) return;
    const ids = (await h.prisma.accessory.findMany({ where: { name: { startsWith: RUN } }, select: { id: true } })).map((r) => r.id);
    const lines = await h.prisma.orderAccessoryLine.findMany({
      where: { OR: [{ accessoryId: { in: ids } }, { components: { some: { accessoryId: { in: ids } } } }] },
      select: { id: true, orderId: true },
    });
    await h.prisma.orderEnergyBundleComponent.deleteMany({ where: { lineId: { in: lines.map((l) => l.id) } } });
    await h.prisma.orderAccessoryLine.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
    await h.prisma.order.deleteMany({ where: { guestEmail: { startsWith: RUN.toLowerCase() } } });
    await h.prisma.accessoryStockMovement.deleteMany({ where: { accessoryId: { in: ids } } });
    await h.prisma.accessory.deleteMany({ where: { id: { in: ids } } });
    if (packagesBefore) await h.api('PUT', '/admin/shipping/packages', { token: admin, json: packagesBefore });
    await h.prisma.configSetting.deleteMany({ where: { key: { in: DIAL_KEYS } } });
    for (const d of dialsBefore) await h.prisma.configSetting.create({ data: { key: d.key, valueJson: d.valueJson as never } });
    await h.close();
  });

  // ---------------------------------------------------------------- utilidades

  function raw(method: string, path: string, opts: { token?: string; body?: Buffer; headers?: Record<string, string> } = {}) {
    return new Promise<{ status: number; buf: Buffer; headers: http.IncomingHttpHeaders; json: any }>((resolve, reject) => {
      const url = new URL(h.baseUrl + path);
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      if (opts.body) headers['content-length'] = String(opts.body.length);
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json: unknown;
          try {
            json = JSON.parse(buf.toString('utf8'));
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, buf, headers: res.headers, json });
        });
      });
      req.on('error', reject);
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  function upload(token: string, id: string, file: Buffer | null, filename = 'foto.png', mime = 'image/png', field = 'file') {
    const b = `----acA${randomUUID()}`;
    const parts: Buffer[] = [];
    if (file) {
      parts.push(
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
        file,
        Buffer.from('\r\n'),
      );
    }
    parts.push(Buffer.from(`--${b}--\r\n`));
    return raw('POST', `/admin/accessories/${id}/photo`, { token, body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } });
  }

  let seq = 0;
  const nm = (s: string) => `${RUN} ${s} ${++seq}`;

  async function create(token: string, body: Record<string, unknown>): Promise<ApiResponse> {
    const r = await h.api('POST', '/admin/accessories', { token, json: body });
    if (r.status === 201) created.push(r.body.id);
    return r;
  }

  /** Un accesorio listo para activar (precio, medidas, peso y foto), creado por el súper-admin. */
  async function ready(over: Record<string, unknown> = {}, activate = true): Promise<string> {
    const r = await create(admin, {
      name: nm('listo'),
      category: 'sleeves',
      lengthMm: 90,
      widthMm: 65,
      heightMm: 20,
      weightG: 50,
      priceCents: 8900,
      unitCostCents: 4000,
      ...over,
    });
    expect(r.status).toBe(201);
    const up = await upload(admin, r.body.id, PNG);
    expect(up.status).toBe(200);
    if (activate) expect((await h.api('POST', `/admin/accessories/${r.body.id}/activate`, { token: admin })).status).toBe(200);
    return r.body.id;
  }

  async function setStock(id: string, stockQty: number, reservedQty = 0) {
    await h.prisma.accessory.update({ where: { id }, data: { stockQty, reservedQty } });
  }

  let oseq = 0;
  async function directOrder(over: Record<string, unknown> = {}): Promise<string> {
    oseq += 1;
    const o = await h.prisma.order.create({
      data: {
        subtotalCents: 8900,
        processingFeeCents: 300,
        ivaCents: 1228,
        totalCents: 9200,
        priceConvention: 'IVA_INCLUSIVE',
        guestEmail: `${RUN.toLowerCase()}.${oseq}@e2e.local`,
        fulfillmentMode: 'direct_ship',
        shippingAddressSnapshot: { line1: 'Calle 1' },
        ...over,
      } as never,
    });
    return o.id;
  }

  async function soldLine(accessoryId: string, quantity: number, settledAt: Date, status: 'settled' | 'pending' = 'settled') {
    const orderId = await directOrder({ status, settledAt: status === 'settled' ? settledAt : null });
    await h.prisma.orderAccessoryLine.create({
      data: {
        orderId,
        kind: 'accessory',
        accessoryId,
        quantity,
        unitPriceCents: 8900,
        unitCostCents: 4000,
        snapshot: { name: 'x' },
        status: status === 'settled' ? 'sold' : 'reserved',
        soldAt: status === 'settled' ? settledAt : null,
        reservedUntil: new Date(Date.now() + 3600_000),
      },
    });
    return orderId;
  }

  const CARD_KEYS = ['category', 'energyType', 'id', 'name', 'photo', 'priceCents', 'soldOut'].sort();
  const DETAIL_KEYS = [...CARD_KEYS, 'description', 'maxQty'].sort();

  // ---------------------------------------------------------------- AC-B7 permisos

  describe('AC-B7 — permisos', () => {
    it('operador: alta con campo ★ ⇒ 403 FORBIDDEN_FIELD {fields} y no se escribe nada', async () => {
      const name = nm('prohibido');
      const r = await create(op, { name, category: 'sleeves', priceCents: 100, unitCostCents: 1, suggested: true, active: true });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FORBIDDEN_FIELD');
      expect([...r.body.error.details.fields].sort()).toEqual(['active', 'priceCents', 'suggested', 'unitCostCents']);
      expect(await h.prisma.accessory.count({ where: { name } })).toBe(0);
      for (const f of ['priceCents', 'unitCostCents', 'suggested']) {
        const one = await create(op, { name, category: 'sleeves', [f]: f === 'suggested' ? false : 5 });
        expect([one.status, one.body.error.code, one.body.error.details.fields]).toEqual([403, 'FORBIDDEN_FIELD', [f]]);
      }
      expect(await h.prisma.accessory.count({ where: { name } })).toBe(0);
    });

    it('operador: alta sin precio, foto, medidas ni existencias ⇒ 201, nace inactivo y SIN unitCostCents', async () => {
      const r = await create(op, { name: nm('del operador'), category: 'binders' });
      expect(r.status).toBe(201);
      expect(r.body.active).toBe(false);
      expect(r.body.priceCents).toBeNull();
      expect(r.body.stockQty).toBe(0);
      expect('unitCostCents' in r.body).toBe(false);
      const g = await h.api('GET', `/admin/accessories/${r.body.id}`, { token: op });
      expect(g.status).toBe(200);
      expect('unitCostCents' in g.body).toBe(false);
      const ga = await h.api('GET', `/admin/accessories/${r.body.id}`, { token: admin });
      expect(ga.body.unitCostCents).toBeNull();
      const list = await h.api('GET', `/admin/accessories?q=${encodeURIComponent(RUN)}`, { token: op });
      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      for (const it of list.body.items) expect('unitCostCents' in it).toBe(false);
    });

    it('operador: PATCH de precio/costo/«Sugerido» ⇒ 403 FORBIDDEN_FIELD, nada cambia; de nombre y medidas ⇒ 200', async () => {
      const id = await ready({}, false);
      const r = await h.api('PATCH', `/admin/accessories/${id}`, { token: op, json: { name: nm('renombrado'), priceCents: 1 } });
      expect([r.status, r.body.error.code, r.body.error.details.fields]).toEqual([403, 'FORBIDDEN_FIELD', ['priceCents']]);
      const row = await h.prisma.accessory.findUniqueOrThrow({ where: { id } });
      expect(row.priceCents).toBe(8900);
      expect(row.name).not.toContain('renombrado');
      const ok = await h.api('PATCH', `/admin/accessories/${id}`, { token: op, json: { name: nm('renombrado'), lengthMm: 95 } });
      expect(ok.status).toBe(200);
      expect(ok.body.lengthMm).toBe(95);
      expect('unitCostCents' in ok.body).toBe(false);
    });

    it('operador: activar, desactivar y borrar ⇒ 403', async () => {
      const id = await ready({}, false);
      for (const [m, p] of [
        ['POST', `/admin/accessories/${id}/activate`],
        ['POST', `/admin/accessories/${id}/deactivate`],
        ['DELETE', `/admin/accessories/${id}`],
      ] as const) {
        expect((await h.api(m, p, { token: op })).status).toBe(403);
      }
      expect(await h.prisma.accessory.count({ where: { id } })).toBe(1);
      expect((await h.prisma.accessory.findUniqueOrThrow({ where: { id } })).active).toBe(false);
    });

    it('operador: PUT de cajas y de diales ⇒ 403', async () => {
      const p = await h.api('PUT', '/admin/shipping/packages', { token: op, json: packagesBefore });
      expect(p.status).toBe(403);
      const antes = (await h.api('GET', '/admin/settings', { token: admin })).body.energyBundlePriceCents;
      const s = await h.api('PUT', '/admin/settings', { token: op, json: { energyBundlePriceCents: antes + 1 } });
      expect(s.status).toBe(403);
      expect((await h.api('GET', '/admin/settings', { token: admin })).body.energyBundlePriceCents).toBe(antes);
    });

    it('operador: foto y existencias ⇒ ok', async () => {
      const r = await create(op, { name: nm('foto op'), category: 'toploaders' });
      expect((await upload(op, r.body.id, JPG, 'a.jpg', 'image/jpeg')).status).toBe(200);
      const s = await h.api('POST', `/admin/accessories/${r.body.id}/stock`, { token: op, json: { kind: 'receive', quantity: 5 } });
      expect(s.status).toBe(200);
      expect(s.body.stockQty).toBe(5);
    });
  });

  // ---------------------------------------------------------------- AC-B6 / AC-B45 activar

  describe('AC-B6 / AC-B45 — activar', () => {
    it('sin precio, foto, medidas ni peso ⇒ 422 {missing} exacto; completándolo ⇒ 200 y bitácora', async () => {
      const r = await create(admin, { name: nm('incompleto'), category: 'playmats' });
      const id = r.body.id;
      const a1 = await h.api('POST', `/admin/accessories/${id}/activate`, { token: admin });
      expect(a1.status).toBe(422);
      expect(a1.body.error.code).toBe('ACCESSORY_NOT_ACTIVATABLE');
      expect(a1.body.error.details.missing).toEqual(['price', 'photo', 'dimensions', 'weight']);
      await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { priceCents: 45000, lengthMm: 610, widthMm: 350, heightMm: 5 } });
      const a2 = await h.api('POST', `/admin/accessories/${id}/activate`, { token: admin });
      expect(a2.body.error.details.missing).toEqual(['photo', 'weight']);
      await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { weightG: 400 } });
      await upload(admin, id, WEBP, 'x.webp', 'image/webp');
      const a3 = await h.api('POST', `/admin/accessories/${id}/activate`, { token: admin });
      expect(a3.status).toBe(200);
      expect(a3.body.active).toBe(true);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.activated', entityId: id, actorUserId: adminId } })).toBe(1);
      const d = await h.api('POST', `/admin/accessories/${id}/deactivate`, { token: admin });
      expect([d.status, d.body.active]).toEqual([200, false]);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.deactivated', entityId: id } })).toBe(1);
    });

    it('energía con precio y foto, SIN medidas ni peso ⇒ activa; sin foto ⇒ {missing:[photo]} exacto; segunda del mismo tipo ⇒ 409', async () => {
      const type = 'psychic';
      // ⛔ no toca la semilla: se asegura que ninguna energía `psychic` esté activa ANTES (en este esquema solo hay las mías).
      expect(await h.prisma.accessory.count({ where: { energyType: type, active: true } })).toBe(0);
      const sinFoto = await create(admin, { name: nm('Energía sin foto'), category: 'energy', energyType: type, priceCents: 500 });
      const a0 = await h.api('POST', `/admin/accessories/${sinFoto.body.id}/activate`, { token: admin });
      expect([a0.status, a0.body.error.code, a0.body.error.details.missing]).toEqual([422, 'ACCESSORY_NOT_ACTIVATABLE', ['photo']]);
      const e1 = await ready({ name: nm('Energía Psíquica'), category: 'energy', energyType: type, priceCents: 500, lengthMm: null, widthMm: null, heightMm: null, weightG: null });
      expect((await h.prisma.accessory.findUniqueOrThrow({ where: { id: e1 } })).active).toBe(true);
      const e2 = await ready({ name: nm('Energía Psíquica bis'), category: 'energy', energyType: type, priceCents: 600, lengthMm: null, widthMm: null, heightMm: null, weightG: null }, false);
      const t = await h.api('POST', `/admin/accessories/${e2}/activate`, { token: admin });
      expect([t.status, t.body.error.code, t.body.error.details]).toEqual([409, 'ENERGY_TYPE_TAKEN', { accessoryId: e1 }]);
      expect((await h.prisma.accessory.findUniqueOrThrow({ where: { id: e2 } })).active).toBe(false);
      await h.api('POST', `/admin/accessories/${e1}/deactivate`, { token: admin });
    });

    it('cambiar la categoría de un ACTIVO entre energía y otra ⇒ 409 ACCESSORY_ACTIVE', async () => {
      const id = await ready();
      const r = await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { category: 'energy', energyType: 'metal' } });
      expect([r.status, r.body.error.code]).toEqual([409, 'ACCESSORY_ACTIVE']);
      expect((await h.prisma.accessory.findUniqueOrThrow({ where: { id } })).category).toBe('sleeves');
      // Entre dos categorías que no son energía, sí.
      const ok = await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { category: 'toploaders' } });
      expect([ok.status, ok.body.category]).toEqual([200, 'toploaders']);
    });

    it('validación del cuerpo: energía sin tipo / tipo sin energía / «Sugerido» en energía ⇒ 400', async () => {
      for (const body of [
        { name: nm('e'), category: 'energy' },
        { name: nm('e'), category: 'sleeves', energyType: 'fire' },
        { name: nm('e'), category: 'energy', energyType: 'fire', suggested: true },
        { name: '   ', category: 'sleeves' },
        { name: 'x'.repeat(121), category: 'sleeves' },
        { name: nm('e'), category: 'sleeves', lengthMm: 2001 },
        { name: nm('e'), category: 'sleeves', priceCents: 0 },
        { name: nm('e'), category: 'nope' },
      ]) {
        const r = await create(admin, body);
        expect([r.status, r.body?.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
      }
    });

    it('bitácora: alta, cambio de precio y edición (con antes y después; costo solo en `after`)', async () => {
      const id = await ready({}, false);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.created', entityId: id } })).toBe(1);
      await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { priceCents: 9900, unitCostCents: 4100 } });
      const pc = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'accessory.price_changed', entityId: id } });
      expect(pc.before).toEqual({ priceCents: 8900 });
      expect(pc.after).toEqual({ priceCents: 9900 });
      const up = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'accessory.updated', entityId: id }, orderBy: { createdAt: 'desc' } });
      expect(up.before).toEqual({ priceCents: 8900 });
      expect(up.after).toEqual({ priceCents: 9900, unitCostCents: 4100 });
    });
  });

  // ---------------------------------------------------------------- AC-B8 existencias

  describe('AC-B8 — existencias manuales', () => {
    it('Entraron + Ajuste con CAS, motivo, apartado y movimientos con actor', async () => {
      const id = (await create(op, { name: nm('stock'), category: 'sleeves' })).body.id;
      const rec = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'receive', quantity: 10, note: 'factura 12' } });
      expect([rec.status, rec.body.stockQty]).toEqual([200, 10]);

      for (const json of [
        { kind: 'adjust', newStockQty: 7, expectedStockQty: 10 },
        { kind: 'adjust', newStockQty: 7, expectedStockQty: 10, reason: 'ab' },
        { kind: 'adjust', newStockQty: 10, expectedStockQty: 10, reason: 'sin cambio' },
        { kind: 'adjust', newStockQty: -1, expectedStockQty: 10, reason: 'negativo' },
        { kind: 'receive', quantity: 0 },
        { kind: 'receive', quantity: 10001 },
        { kind: 'otro', quantity: 1 },
      ]) {
        const r = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json });
        expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
      }

      const conflict = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'adjust', newStockQty: 7, expectedStockQty: 9, reason: 'conteo físico' } });
      expect([conflict.status, conflict.body.error.code, conflict.body.error.details]).toEqual([409, 'STOCK_CONFLICT', { stockQty: 10 }]);

      await setStock(id, 10, 4);
      const below = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'adjust', newStockQty: 3, expectedStockQty: 10, reason: 'conteo físico' } });
      expect([below.status, below.body.error.code, below.body.error.details]).toEqual([409, 'STOCK_BELOW_RESERVED', { reservedQty: 4 }]);
      expect((await h.prisma.accessory.findUniqueOrThrow({ where: { id } })).stockQty).toBe(10);

      const adj = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'adjust', newStockQty: 7, expectedStockQty: 10, reason: '  se rompieron 3  ' } });
      expect([adj.status, adj.body.stockQty, adj.body.availableQty]).toEqual([200, 7, 3]);

      const movs = await h.prisma.accessoryStockMovement.findMany({ where: { accessoryId: id }, orderBy: { createdAt: 'asc' } });
      expect(movs.map((m) => [m.kind, m.delta, m.stockBefore, m.stockAfter, m.reason, m.actorUserId, m.orderId])).toEqual([
        ['receive', 10, 0, 10, 'factura 12', opId, null],
        ['adjust', -3, 10, 7, 'se rompieron 3', opId, null],
      ]);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.stock_received', entityId: id, actorUserId: opId } })).toBe(1);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.stock_adjusted', entityId: id, actorUserId: opId } })).toBe(1);

      const g = await h.api('GET', `/admin/accessories/${id}/stock-movements`, { token: op });
      expect(g.status).toBe(200);
      expect(g.body.total).toBe(2);
      expect(g.body.items[0]).toEqual({
        kind: 'adjust',
        delta: -3,
        stockBefore: 10,
        stockAfter: 7,
        reason: 'se rompieron 3',
        actor: { userId: opId, name: E2E_USERS.operator.name },
        orderNumber: null,
        createdAt: expect.any(String),
      });
      expect(g.body.items[1].kind).toBe('receive');
    });

    it('accesorio inexistente ⇒ 404', async () => {
      const r = await h.api('POST', `/admin/accessories/${randomUUID()}/stock`, { token: op, json: { kind: 'receive', quantity: 1 } });
      expect(r.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- AC-B9 borrar

  describe('AC-B9 — borrar', () => {
    it('sin ventas (con foto y movimientos) ⇒ 204 y bitácora; luego 404', async () => {
      const id = await ready({}, true);
      await h.api('POST', `/admin/accessories/${id}/stock`, { token: admin, json: { kind: 'receive', quantity: 3 } });
      const d = await h.api('DELETE', `/admin/accessories/${id}`, { token: admin });
      expect(d.status).toBe(204);
      expect(await h.prisma.accessory.count({ where: { id } })).toBe(0);
      expect(await h.prisma.accessoryPhoto.count({ where: { accessoryId: id } })).toBe(0);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.deleted', entityId: id } })).toBe(1);
      expect((await h.api('GET', `/admin/accessories/${id}`, { token: admin })).status).toBe(404);
    });

    it('con un renglón de pedido ⇒ 409 ACCESSORY_HAS_SALES y sigue ahí; hasSales = true', async () => {
      const id = await ready();
      await soldLine(id, 1, new Date());
      const d = await h.api('DELETE', `/admin/accessories/${id}`, { token: admin });
      expect([d.status, d.body.error.code]).toEqual([409, 'ACCESSORY_HAS_SALES']);
      expect(await h.prisma.accessory.count({ where: { id } })).toBe(1);
      expect((await h.api('GET', `/admin/accessories/${id}`, { token: admin })).body.hasSales).toBe(true);
    });

    it('como componente de un paquete de energías ⇒ 409 ACCESSORY_HAS_SALES', async () => {
      const energy = (await create(admin, { name: nm('Energía comp'), category: 'energy', energyType: 'water', priceCents: 500 })).body.id;
      const orderId = await directOrder();
      const line = await h.prisma.orderAccessoryLine.create({
        data: {
          orderId,
          kind: 'energy_bundle',
          quantity: 1,
          unitPriceCents: 2000,
          snapshot: { name: 'Paquete' },
          metaDeckId: randomUUID(),
          metaDeckListId: randomUUID(),
          deckSlug: 'deck',
          deckName: 'Deck',
          deckOrderItemIds: [randomUUID()],
          reservedUntil: new Date(Date.now() + 3600_000),
        },
      });
      await h.prisma.orderEnergyBundleComponent.create({ data: { lineId: line.id, accessoryId: energy, energyType: 'water', quantity: 8 } });
      const d = await h.api('DELETE', `/admin/accessories/${energy}`, { token: admin });
      expect([d.status, d.body.error.code]).toEqual([409, 'ACCESSORY_HAS_SALES']);
      expect(await h.prisma.accessory.count({ where: { id: energy } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------- v1.86.3 (§AC.19.2, §AC.19.7)

  describe('v1.86.3 — §AC.19.2 (borrado con la lista de movimientos, PATCH que desarma un activo, respuestas fijadas)', () => {
    it('AC-B53: borrar sin ventas con 3 movimientos ⇒ 204; `before.movements` con los 3, en orden y exactos; movementsDeleted = 3', async () => {
      const id = (await create(admin, { name: nm('borrar con movimientos'), category: 'sleeves' })).body.id;
      // `initial` solo lo escribe la migración (§AC.1): se siembra a mano, con fecha anterior y sin actor.
      const t0 = new Date(Date.now() - 60_000);
      await setStock(id, 5);
      await h.prisma.accessoryStockMovement.create({
        data: { accessoryId: id, kind: 'initial', delta: 5, stockBefore: 0, stockAfter: 5, reason: null, actorUserId: null, createdAt: t0 },
      });
      expect((await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'receive', quantity: 3, note: 'factura 7' } })).status).toBe(200);
      expect((await h.api('POST', `/admin/accessories/${id}/stock`, { token: admin, json: { kind: 'adjust', newStockQty: 6, expectedStockQty: 8, reason: 'conteo físico' } })).status).toBe(200);
      const rows = await h.prisma.accessoryStockMovement.findMany({ where: { accessoryId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      expect(rows.map((m) => m.kind)).toEqual(['initial', 'receive', 'adjust']);

      const d = await h.api('DELETE', `/admin/accessories/${id}`, { token: admin });
      expect(d.status).toBe(204);
      expect(await h.prisma.accessoryStockMovement.count({ where: { accessoryId: id } })).toBe(0);
      const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'accessory.deleted', entityId: id } });
      const before = log.before as Record<string, unknown>;
      expect(before.movementsDeleted).toBe(3);
      expect(before.movements).toEqual([
        { kind: 'initial', delta: 5, stockBefore: 0, stockAfter: 5, reason: null, actorUserId: null, createdAt: t0.toISOString() },
        { kind: 'receive', delta: 3, stockBefore: 5, stockAfter: 8, reason: 'factura 7', actorUserId: opId, createdAt: rows[1].createdAt.toISOString() },
        { kind: 'adjust', delta: -2, stockBefore: 8, stockAfter: 6, reason: 'conteo físico', actorUserId: adminId, createdAt: rows[2].createdAt.toISOString() },
      ]);
    });

    it('AC-B54: PATCH de un activo con priceCents:null ⇒ 422 {missing:[price]} y nada cambia; energía activa con weightG:null ⇒ 200', async () => {
      const id = await ready();
      const auditsBefore = await h.prisma.auditLog.count({ where: { entityId: id } });
      const r = await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { priceCents: null } });
      expect([r.status, r.body.error?.code, r.body.error?.details]).toEqual([422, 'ACCESSORY_NOT_ACTIVATABLE', { missing: ['price'] }]);
      const row = await h.prisma.accessory.findUniqueOrThrow({ where: { id } });
      expect([row.priceCents, row.active]).toEqual([8900, true]);
      expect(await h.prisma.auditLog.count({ where: { entityId: id } })).toBe(auditsBefore);

      const type = 'darkness';
      expect(await h.prisma.accessory.count({ where: { energyType: type, active: true } })).toBe(0);
      const e = await ready({ name: nm('Energía Oscura'), category: 'energy', energyType: type, priceCents: 500, lengthMm: null, widthMm: null, heightMm: null, weightG: 10 });
      const ok = await h.api('PATCH', `/admin/accessories/${e}`, { token: admin, json: { weightG: null } });
      expect([ok.status, ok.body.weightG, ok.body.active]).toEqual([200, null, true]);
      await h.api('POST', `/admin/accessories/${e}/deactivate`, { token: admin });
    });

    it('respuestas fijadas: PATCH sin cambio, activar/desactivar repetidos ⇒ 200 con la fila y sin bitácora; stock ⇒ 200 con la fila; no_change contra expectedStockQty', async () => {
      const id = await ready();
      const fila = (await h.api('GET', `/admin/accessories/${id}`, { token: admin })).body;
      const audits = () => h.prisma.auditLog.count({ where: { entityId: id } });
      const n0 = await audits();

      const p = await h.api('PATCH', `/admin/accessories/${id}`, { token: admin, json: { name: fila.name, priceCents: fila.priceCents } });
      expect([p.status, p.body]).toEqual([200, fila]);
      const a = await h.api('POST', `/admin/accessories/${id}/activate`, { token: admin });
      expect([a.status, a.body]).toEqual([200, fila]);
      expect(await audits()).toBe(n0);

      const d1 = await h.api('POST', `/admin/accessories/${id}/deactivate`, { token: admin });
      expect([d1.status, d1.body.active]).toEqual([200, false]);
      const n1 = await audits();
      expect(n1).toBe(n0 + 1);
      const d2 = await h.api('POST', `/admin/accessories/${id}/deactivate`, { token: admin });
      expect([d2.status, d2.body]).toEqual([200, d1.body]);
      expect(await audits()).toBe(n1);

      const s = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'receive', quantity: 10 } });
      expect(s.status).toBe(200);
      expect(s.body).toEqual((await h.api('GET', `/admin/accessories/${id}`, { token: op })).body);

      // `no_change` se mide contra lo que vio el operador (expected), no contra stockQty (10).
      const nc = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'adjust', newStockQty: 7, expectedStockQty: 7, reason: 'conteo físico' } });
      expect([nc.status, nc.body.error.details]).toEqual([400, { field: 'newStockQty', reason: 'no_change' }]);
      const cf = await h.api('POST', `/admin/accessories/${id}/stock`, { token: op, json: { kind: 'adjust', newStockQty: 10, expectedStockQty: 7, reason: 'conteo físico' } });
      expect([cf.status, cf.body.error.code, cf.body.error.details]).toEqual([409, 'STOCK_CONFLICT', { stockQty: 10 }]);
    });
  });

  // ---------------------------------------------------------------- AC-B4 / AC-B39 fotos

  describe('AC-B4 / AC-B39 — fotos', () => {
    it.each([
      ['png', 'a.png', 'image/png'],
      ['jpg', 'a.jpg', 'image/jpeg'],
      ['webp', 'a.webp', 'image/webp'],
    ])('%s aceptado ⇒ 200 con la foto versionada y la fila escrita', async (fmt, filename, mime) => {
      const id = (await create(admin, { name: nm(`foto ${fmt}`), category: 'other' })).body.id;
      const buf = fmt === 'png' ? PNG : fmt === 'jpg' ? JPG : WEBP;
      const r = await upload(admin, id, buf, filename, mime);
      expect(r.status).toBe(200);
      const row = await h.prisma.accessory.findUniqueOrThrow({ where: { id }, include: { photo: true } });
      expect(row.photoVersion).toMatch(/^[0-9a-f]{16}$/);
      expect(row.photo!.version).toBe(row.photoVersion);
      expect(row.photo!.sourceMime).toBe(mime);
      expect(row.photo!.uploadedByUserId).toBe(adminId);
      expect(r.json.photo).toEqual({
        url: `/api/v1/accessories/${id}/photo/${row.photoVersion}/full`,
        thumbUrl: `/api/v1/accessories/${id}/photo/${row.photoVersion}/thumb`,
      });
    });

    it('rechazos (texto renombrado .png, 10 MiB + 1, sin archivo) ⇒ 422/400 y NADA persistido', async () => {
      const id = await ready({}, false);
      const before = await h.prisma.accessory.findUniqueOrThrow({ where: { id }, include: { photo: true } });
      const auditBefore = await h.prisma.auditLog.count({ where: { action: 'accessory.photo_replaced', entityId: id } });

      const txt = await upload(admin, id, Buffer.from('no soy imagen, solo me llamo foto.png'), 'foto.png', 'image/png');
      expect([txt.status, txt.json.error.code, txt.json.error.details]).toEqual([422, 'PHOTO_INVALID', { reason: 'unsupported_type' }]);

      const big = Buffer.concat([PNG, Buffer.alloc(10 * MiB + 1 - PNG.length)]);
      const tooBig = await upload(admin, id, big, 'grande.png', 'image/png');
      expect([tooBig.status, tooBig.json.error.code, tooBig.json.error.details]).toEqual([422, 'PHOTO_INVALID', { reason: 'too_large' }]);

      const none = await upload(admin, id, null);
      expect(none.status).toBe(400);

      const after = await h.prisma.accessory.findUniqueOrThrow({ where: { id }, include: { photo: true } });
      expect(after.photoVersion).toBe(before.photoVersion);
      expect(after.photo!.fullWebp.equals(before.photo!.fullWebp)).toBe(true);
      expect(await h.prisma.auditLog.count({ where: { action: 'accessory.photo_replaced', entityId: id } })).toBe(auditBefore);
    });

    it('AC-B39: pública con immutable + nosniff; aunque esté inactivo; versión vieja ⇒ 404; reemplazo con bitácora', async () => {
      const id = await ready({}, false);
      const v1 = (await h.prisma.accessory.findUniqueOrThrow({ where: { id } })).photoVersion!;
      const full = await raw('GET', `/accessories/${id}/photo/${v1}/full`);
      expect(full.status).toBe(200);
      expect(full.headers['content-type']).toMatch(/^image\/webp/);
      expect(full.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(full.headers['x-content-type-options']).toBe('nosniff');
      // La tienda vive en otro origen y `helmet()` pone CORP `same-origin` por defecto: sin esto el `<img>` se bloquea.
      expect(full.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const meta = await sharp(full.buf).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', 1200, 1200]);
      const thumb = await raw('GET', `/accessories/${id}/photo/${v1}/thumb`);
      expect((await sharp(thumb.buf).metadata()).width).toBe(400);
      expect((await raw('GET', `/accessories/${id}/photo/${v1}/huge`)).status).toBe(404);

      const r2 = await upload(admin, id, JPG, 'b.jpg', 'image/jpeg');
      expect(r2.status).toBe(200);
      const v2 = (await h.prisma.accessory.findUniqueOrThrow({ where: { id } })).photoVersion!;
      expect(v2).not.toBe(v1);
      expect((await raw('GET', `/accessories/${id}/photo/${v1}/full`)).status).toBe(404);
      expect((await raw('GET', `/accessories/${id}/photo/${v2}/full`)).status).toBe(200);
      const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'accessory.photo_replaced', entityId: id }, orderBy: { createdAt: 'desc' } });
      expect([log.before, log.after]).toEqual([{ version: v1 }, { version: v2 }]);
      expect((await raw('GET', `/accessories/${randomUUID()}/photo/${v2}/full`)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------- AC-B3 tienda pública

  describe('AC-B3 — tienda pública', () => {
    it('lista: solo activos; agotados al final; luego categoría (orden del enum) y nombre; llaves EXACTAS', async () => {
      const tag = `${RUN}pub`;
      const play = await ready({ name: `${tag} a playmat`, category: 'playmats' });
      const slv = await ready({ name: `${tag} z fundas`, category: 'sleeves' });
      const agotado = await ready({ name: `${tag} 0 agotado`, category: 'sleeves' });
      const inactivo = await ready({ name: `${tag} inactivo`, category: 'sleeves' }, false);
      await setStock(play, 5);
      await setStock(slv, 5);
      await setStock(agotado, 3, 3);
      await setStock(inactivo, 5);
      const r = await h.api('GET', `/accessories?q=${encodeURIComponent(tag)}`);
      expect(r.status).toBe(200);
      expect(r.body.items.map((i: any) => i.id)).toEqual([slv, play, agotado]);
      expect([r.body.page, r.body.pageSize, r.body.total]).toEqual([1, 24, 3]);
      expect(r.body.items.map((i: any) => i.soldOut)).toEqual([false, false, true]);
      for (const it of r.body.items) expect(Object.keys(it).sort()).toEqual(CARD_KEYS);
      expect(r.body.items[0].priceCents).toBe(8900);

      const cat = await h.api('GET', `/accessories?q=${encodeURIComponent(tag)}&category=playmats`);
      expect(cat.body.items.map((i: any) => i.id)).toEqual([play]);
      const pg = await h.api('GET', `/accessories?q=${encodeURIComponent(tag)}&page=2&pageSize=2`);
      expect([pg.body.items.map((i: any) => i.id), pg.body.total]).toEqual([[agotado], 3]);
    });

    it('ficha: activo ⇒ 200 con llaves exactas y maxQty; inactivo o inexistente ⇒ 404 ACCESSORY_NOT_FOUND', async () => {
      const id = await ready({ description: 'Cien fundas mate' });
      await setStock(id, 130, 10);
      const r = await h.api('GET', `/accessories/${id}`);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(DETAIL_KEYS);
      expect([r.body.maxQty, r.body.description, r.body.soldOut]).toEqual([99, 'Cien fundas mate', false]);
      await h.api('POST', `/admin/accessories/${id}/deactivate`, { token: admin });
      for (const target of [id, randomUUID(), 'no-es-uuid']) {
        const nf = await h.api('GET', `/accessories/${target}`);
        expect([nf.status, nf.body.error.code]).toEqual([404, 'ACCESSORY_NOT_FOUND']);
      }
    });

    it('validación: category fuera del enum, pageSize > 60, q > 60 ⇒ 400', async () => {
      for (const qs of ['category=nope', 'pageSize=61', `q=${'x'.repeat(61)}`, 'page=0']) {
        const r = await h.api('GET', `/accessories?${qs}`);
        expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
      }
    });

    it('q escapa comodines de ILIKE (% y _ son literales)', async () => {
      const r = await h.api('GET', `/accessories?q=${encodeURIComponent('%')}`);
      expect(r.status).toBe(200);
      expect(r.body.items.every((i: any) => i.name.includes('%'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------- AC-B23 sugerencias

  describe('AC-B23 — sugerencias', () => {
    it('2 «Sugerido» + el más vendido en 30 d; nunca inactivo, agotado, excluido ni energía; el dial cambia N', async () => {
      // Aislar: en este esquema solo hay datos de esta suite; se apagan los activos previos.
      await h.prisma.accessory.updateMany({ where: { active: true }, data: { active: false } });
      const tag = `${RUN}sug`;
      const s1 = await ready({ name: `${tag} B sugerido`, suggested: true });
      const s2 = await ready({ name: `${tag} a sugerido`, suggested: true });
      const top = await ready({ name: `${tag} y top` });
      const second = await ready({ name: `${tag} x segundo` });
      const viejo = await ready({ name: `${tag} c vendido hace 40 d` });
      const pend = await ready({ name: `${tag} d pedido pendiente` });
      const resto = await ready({ name: `${tag} e resto` });
      const agotado = await ready({ name: `${tag} 0 agotado`, suggested: true });
      const inactivo = await ready({ name: `${tag} 0 inactivo`, suggested: true }, false);
      const energia = await ready({ name: `${tag} 0 energía`, category: 'energy', energyType: 'grass', priceCents: 500, lengthMm: null, widthMm: null, heightMm: null, weightG: null });
      for (const id of [s1, s2, top, second, viejo, pend, resto, inactivo, energia]) await setStock(id, 10);
      await setStock(agotado, 2, 2);
      await soldLine(top, 5, new Date(Date.now() - 2 * 86400_000));
      await soldLine(second, 2, new Date(Date.now() - 29 * 86400_000));
      await soldLine(viejo, 50, new Date(Date.now() - 40 * 86400_000));
      await soldLine(pend, 50, new Date(), 'pending');
      await soldLine(energia, 99, new Date());

      await h.prisma.configSetting.deleteMany({ where: { key: 'accessory_suggestion_count' } });
      const r = await h.api('GET', '/accessories/suggestions');
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('public, max-age=60');
      expect(r.body.items.map((i: any) => i.id)).toEqual([s2, s1, top]);
      for (const it of r.body.items) expect(Object.keys(it).sort()).toEqual(CARD_KEYS);

      const put = await h.api('PUT', '/admin/settings', { token: admin, json: { accessorySuggestionCount: 6 } });
      expect(put.status).toBe(200);
      const six = await h.api('GET', `/accessories/suggestions?exclude=${s1},${randomUUID()}`);
      expect(six.body.items.map((i: any) => i.id)).toEqual([s2, top, second, viejo, pend, resto]);

      await h.api('PUT', '/admin/settings', { token: admin, json: { accessorySuggestionCount: 1 } });
      expect((await h.api('GET', '/accessories/suggestions')).body.items.map((i: any) => i.id)).toEqual([s2]);
      await h.api('PUT', '/admin/settings', { token: admin, json: { accessorySuggestionCount: 0 } });
      expect((await h.api('GET', '/accessories/suggestions')).body.items).toEqual([]);
    });

    it('exclude inválido (no uuid o > 50) ⇒ 400', async () => {
      expect((await h.api('GET', '/accessories/suggestions?exclude=nope')).status).toBe(400);
      const many = Array.from({ length: 51 }, () => randomUUID()).join(',');
      expect((await h.api('GET', `/accessories/suggestions?exclude=${many}`)).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------- diales

  describe('§AC.11 — diales de precios', () => {
    it('GET muestra los defaults; PUT súper-admin los cambia (validación por clave)', async () => {
      await h.prisma.configSetting.deleteMany({ where: { key: { in: DIAL_KEYS } } });
      const g = await h.api('GET', '/admin/settings', { token: admin });
      expect([g.body.energyBundlePriceCents, g.body.accessorySuggestionCount]).toEqual([2000, 3]);
      const p = await h.api('PUT', '/admin/settings', { token: admin, json: { energyBundlePriceCents: 2500 } });
      expect(p.status).toBe(200);
      expect((await h.api('GET', '/admin/settings', { token: admin })).body.energyBundlePriceCents).toBe(2500);
      for (const json of [{ energyBundlePriceCents: 0 }, { energyBundlePriceCents: 100_001 }, { accessorySuggestionCount: 7 }]) {
        const bad = await h.api('PUT', '/admin/settings', { token: admin, json });
        expect(bad.status).toBeGreaterThanOrEqual(400);
        expect(bad.status).toBeLessThan(500);
      }
      expect((await h.api('GET', '/admin/settings', { token: admin })).body.energyBundlePriceCents).toBe(2500);
    });
  });

  // ---------------------------------------------------------------- AC-B40 cajas

  describe('AC-B40 — cajas con tarifa al cliente', () => {
    it('GET trae customerFeeCents; PUT con tarifa ⇒ 200 y bitácora antes/después; fuera de rango ⇒ 400 {field, index}', async () => {
      const g = await h.api('GET', '/admin/shipping/packages', { token: op });
      expect(g.status).toBe(200);
      for (const p of g.body.packages) expect(p).toHaveProperty('customerFeeCents');
      const base = g.body.packages as any[];
      expect(base.length).toBeGreaterThan(0);
      const next = base.map((p, i) => ({ ...p, customerFeeCents: i === 0 ? 15000 : null }));
      const put = await h.api('PUT', '/admin/shipping/packages', { token: admin, json: { packages: next } });
      expect(put.status).toBe(200);
      expect(put.body.packages.find((p: any) => p.code === base[0].code).customerFeeCents).toBe(15000);
      const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'shipping.packages_updated', actorUserId: adminId }, orderBy: { createdAt: 'desc' } });
      const pick = (side: any) => side.packages.find((p: any) => p.code === base[0].code).customerFeeCents;
      expect([pick(log.before), pick(log.after)]).toEqual([base[0].customerFeeCents, 15000]);
      expect((await h.prisma.shippingPackage.findUniqueOrThrow({ where: { code: base[0].code } })).customerFeeCents).toBe(15000);

      for (const bad of [0, 10_000_001, 1.5]) {
        const r = await h.api('PUT', '/admin/shipping/packages', {
          token: admin,
          json: { packages: base.map((p, i) => ({ ...p, customerFeeCents: i === base.length - 1 ? bad : null })) },
        });
        expect([r.status, r.body.error.details]).toEqual([400, { field: 'customerFeeCents', index: base.length - 1 }]);
      }
      expect((await h.prisma.shippingPackage.findUniqueOrThrow({ where: { code: base[0].code } })).customerFeeCents).toBe(15000);
    });
  });
});
