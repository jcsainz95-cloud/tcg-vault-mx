/**
 * sdx-d2e.units.spec.ts — ⭐ D2e: los correos al cliente que dispara el transportista y lo que el cliente ve
 * (API_CONTRACT §M4-SHIP.19.12, §19.19.15 fila D2e, §19.20.6, §19.33.2; DESIGN_SYSTEM §43.11–§43.12c). Propiedad: backend.
 *
 *  - ML-24 (`AV-17`), ML-25 (`AV-18`), ML-26 (`AV-19`): asunto exacto, prosa, frase de soporte FUERA del pie, ⛔ sin plazos,
 *    disputas ni importes, `trackingUrl` solo si vino, CTA por `customerUrl` (el servicio lo resuelve; la plantilla no).
 *  - PS-88 (lado plantilla): `AV-4`/`AV-5` llevan la URL de rastreo SOLO si vino; ninguna plantilla construye una con la guía
 *    (`C-SDX-6`).
 *  - PS-89 (lado cuerpo): `toCustomerTimeline` — mapeo fijo, `exception` y compañía fuera, conjunto de claves exacto.
 *  - §19.33.2 (PS-78 ampliada, lado cuerpo): estado desconocido ⇒ evento `exception` con `detail` y llave `unknown:`.
 *  - §19.12 «la cabecera se reescribe»: ya no dice «NO HAY PLANTILLA DE ENTREGADO».
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MailMessage } from '../src/modules/mail/mail.port';
import * as tpl from '../src/modules/shipments/mail/shipment-notice.templates';
import { carrierEventsOf } from '../src/modules/shipments/carrier-status.service';
import { toCustomerTimeline } from '../src/modules/shipments/customer-timeline';

type Msg = Omit<MailMessage, 'to'>;
const ORIGIN = 'https://app.example.test';
const SUPPORT = 'ayuda@tcghunt.test';
const ORDER = { shipmentId: 'shp-1', orderNumber: 'TCG-1001', orderId: 'ord-1', carrier: 'Estafeta', trackingNumber: 'EST123' };
const VAULT = { shipmentId: 'shp-9', orderNumber: null, orderId: null, carrier: 'DHL', trackingNumber: 'DHL999' };
const GUEST_URL = `${ORIGIN}/es/pedido?token=TOKEN_DE_PRUEBA`;
const TRACK = 'https://tracking.skydropx.com/t/EST123';

/** §43.12/ML-24..26: lo que NINGUNO de los tres puede decir (asunto, HTML y texto). */
const PROHIBIDO = /disput|aclaraci|\d+ d[ií]as|\d+ days|plazo|deadline|claim/i;
const IMPORTE = /\$\d/;
const all = (m: Msg) => [m.subject, m.html, m.text ?? ''].join('\n');
/** El cuerpo SIN el pie en tinta (la frase de soporte tiene que vivir fuera del pie, §43.12). */
const bodyOf = (m: Msg) => m.html.split('Recibes este correo').shift()!.split('You are receiving this email').shift()!;

const savedEnv = { app: process.env.APP_PUBLIC_URL, support: process.env.SUPPORT_EMAIL };
beforeAll(() => {
  process.env.APP_PUBLIC_URL = ORIGIN;
  process.env.SUPPORT_EMAIL = SUPPORT;
});
afterAll(() => {
  for (const [k, v] of [['APP_PUBLIC_URL', savedEnv.app], ['SUPPORT_EMAIL', savedEnv.support]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// =================================================================================================== ML-24
describe('ML-24 — AV-17 «Tu paquete fue entregado» (§43.12)', () => {
  const at = new Date('2026-10-05T18:30:00Z');
  it.each([
    ['es', 'Tu paquete fue entregado', 'La paquetería confirmó la entrega el', '¿Problema con tu pedido? Escríbenos a'],
    ['en', 'Your package was delivered', 'The carrier confirmed delivery on', 'Problem with your order? Write to'],
  ])('[%s] asunto exacto, prosa con la fecha del transportista, soporte fuera del pie, sin plazos ni importes', (l, subject, prose, support) => {
    const m = tpl.shipmentDeliveredTemplate({ ...ORDER, customerUrl: `${ORIGIN}/${l}/orders/ord-1`, carrierStatusAt: at }, l);
    expect(m.subject).toBe(subject);
    expect(m.text).toContain(prose);
    // `America/Mexico_City` (UTC−6): 18:30Z ⇒ 12:30.
    expect(m.text).toMatch(/12:30/);
    expect(bodyOf(m)).toContain(support);
    expect(bodyOf(m)).toContain(SUPPORT);
    expect(m.text).toContain(SUPPORT);
    expect(m.text).toContain('TCG-1001');
    expect(all(m)).not.toMatch(PROHIBIDO);
    expect(all(m)).not.toMatch(IMPORTE);
    expect(m.text).toContain(`${ORIGIN}/${l}/orders/ord-1`);
    expect(m.html).toContain(l === 'en' ? 'SEE MY ORDER' : 'VER MI PEDIDO');
  });

  it('sin fecha ⇒ la variante sin fecha; retiro ⇒ «¿Problema con tu envío?» con la referencia y VER MI ENVÍO', () => {
    const m = tpl.shipmentDeliveredTemplate({ ...VAULT, customerUrl: `${ORIGIN}/es/shipments/shp-9`, carrierStatusAt: null }, 'es');
    expect(m.text).toContain('La paquetería confirmó la entrega de tu paquete.');
    expect(m.text).toContain(`¿Problema con tu envío? Escríbenos a ${SUPPORT} con la referencia shp-9 y, si hace falta, fotos.`);
    expect(m.html).toContain('VER MI ENVÍO');
    expect(m.text).toContain('Paquetería: DHL · Guía: DHL999');
  });

  it('`trackingUrl` null ⇒ NINGUNA URL de rastreo; con URL ⇒ esa exacta en letra chica (y no como segundo botón)', () => {
    const sin = tpl.shipmentDeliveredTemplate({ ...ORDER, customerUrl: null, trackingUrl: null, carrierStatusAt: null }, 'es');
    expect(all(sin)).not.toMatch(/tracking\.|Rastreo en la paquetería/);
    const con = tpl.shipmentDeliveredTemplate({ ...ORDER, customerUrl: null, trackingUrl: TRACK, carrierStatusAt: null }, 'es');
    expect(con.text).toContain(`Rastreo en la paquetería: ${TRACK}`);
    expect(con.html).not.toContain(`href="${TRACK}"`);
  });

  it('invitado: el CTA es el `customerUrl` que resolvió el servicio (`/pedido?token=`), sin carrier ⇒ «Guía: <n>»', () => {
    const m = tpl.shipmentDeliveredTemplate({ ...ORDER, orderId: null, carrier: null, customerUrl: GUEST_URL, carrierStatusAt: null }, 'es');
    expect(m.text).toContain(GUEST_URL);
    expect(m.html).toContain('pedido?token=TOKEN_DE_PRUEBA');
    expect(m.text).toContain('Guía: EST123');
    expect(m.text).not.toContain('Paquetería:');
  });

  it('CANARIO del barrido: «Tienes 7 días para abrir una disputa» lo caza el patrón', () => {
    expect('Tienes 7 días para abrir una disputa').toMatch(PROHIBIDO);
    expect('You have 7 days to open a dispute').toMatch(PROHIBIDO);
  });
});

// =================================================================================================== ML-25
describe('ML-25 — AV-18 «Tu paquete está en sucursal» (§43.12b)', () => {
  it.each([
    ['es', 'Tu paquete está en sucursal', 'La paquetería dejó tu paquete en la sucursal Centro Norte. Para recibirlo, tienes que pasar a recogerlo ahí.', 'tienes que pasar a recogerlo'],
    ['en', 'Your package is at the branch', 'The carrier left your package at the Centro Norte branch. To get it, you need to pick it up there.', 'pick it up'],
  ])('[%s] asunto exacto, con la sucursal, que debe recogerlo, soporte fuera del pie, sin plazos ni importes', (l, subject, prose, pick) => {
    const m = tpl.shipmentAtBranchTemplate({ ...ORDER, customerUrl: `${ORIGIN}/${l}/orders/ord-1`, branchName: 'Centro Norte' }, l);
    expect(m.subject).toBe(subject);
    expect(m.text).toContain(prose);
    expect(m.text).toContain(pick);
    expect(bodyOf(m)).toContain(SUPPORT);
    expect(all(m)).not.toMatch(PROHIBIDO);
    expect(all(m)).not.toMatch(IMPORTE);
  });

  it('sin `branchName` ⇒ «una de sus sucursales»; sin carrier ⇒ «pregúntale a la paquetería»; con carrier ⇒ su nombre', () => {
    const a = tpl.shipmentAtBranchTemplate({ ...ORDER, carrier: null, customerUrl: null, branchName: null }, 'es');
    expect(a.text).toContain('La paquetería dejó tu paquete en una de sus sucursales. Para recibirlo, tienes que pasar a recogerlo.');
    expect(a.text).toContain('Si no sabes cuál es la sucursal o su horario, pregúntale a la paquetería con tu número de guía.');
    const b = tpl.shipmentAtBranchTemplate({ ...ORDER, customerUrl: null, branchName: null }, 'es');
    expect(b.text).toContain('pregúntale a Estafeta con tu número de guía.');
  });

  it('`trackingUrl` null ⇒ sin URL de rastreo; con URL ⇒ «Rastrear mi paquete en la paquetería: <url>»; invitado ⇒ CTA `/pedido?token=`', () => {
    expect(all(tpl.shipmentAtBranchTemplate({ ...ORDER, customerUrl: null, trackingUrl: null, branchName: 'X' }, 'es'))).not.toMatch(/Rastrear mi paquete/);
    const m = tpl.shipmentAtBranchTemplate({ ...ORDER, orderId: null, customerUrl: GUEST_URL, trackingUrl: TRACK, branchName: 'X' }, 'es');
    expect(m.text).toContain(`Rastrear mi paquete en la paquetería: ${TRACK}`);
    expect(m.text).toContain(GUEST_URL);
  });

  it('`branchName` es texto de un tercero: va escapado en el HTML', () => {
    const m = tpl.shipmentAtBranchTemplate({ ...ORDER, customerUrl: null, branchName: '<b>Centro</b>' }, 'es');
    expect(m.html).not.toContain('<b>Centro</b>');
    expect(m.html).toContain('&lt;b&gt;Centro&lt;/b&gt;');
  });

  it('CANARIO: «Tienes 7 días para recogerlo» lo caza el patrón', () => {
    expect('Tienes 7 días para recogerlo').toMatch(PROHIBIDO);
  });
});

// =================================================================================================== ML-26
describe('ML-26 — AV-19 «La paquetería intentó entregar tu paquete» (§43.12c)', () => {
  it.each([
    ['es', 'La paquetería intentó entregar tu paquete', 'Comunícate con Estafeta con tu número de guía para acordar otra entrega.'],
    ['en', 'The carrier tried to deliver your package', 'Contact Estafeta with your tracking number to arrange another delivery.'],
  ])('[%s] asunto exacto, fecha del intento en hora de México, qué hacer, soporte fuera del pie', (l, subject, todo) => {
    const m = tpl.shipmentDeliveryAttemptTemplate({ ...ORDER, customerUrl: null, attemptAt: new Date('2026-10-05T16:05:00Z') }, l);
    expect(m.subject).toBe(subject);
    expect(m.text).toMatch(/10:05/);
    expect(m.text).toContain(todo);
    expect(bodyOf(m)).toContain(SUPPORT);
    expect(all(m)).not.toMatch(PROHIBIDO);
    expect(all(m)).not.toMatch(IMPORTE);
  });

  it('dos intentos con fechas distintas ⇒ el MISMO asunto y fechas distintas; sin fecha ⇒ «y no pudo.»; sin carrier ⇒ «la paquetería»', () => {
    const a = tpl.shipmentDeliveryAttemptTemplate({ ...ORDER, customerUrl: null, attemptAt: new Date('2026-10-05T16:05:00Z') }, 'es');
    const b = tpl.shipmentDeliveryAttemptTemplate({ ...ORDER, customerUrl: null, attemptAt: new Date('2026-10-06T17:40:00Z') }, 'es');
    expect(a.subject).toBe(b.subject);
    expect(a.text).not.toBe(b.text);
    expect(a.text).not.toMatch(/segundo|second/i);
    const c = tpl.shipmentDeliveryAttemptTemplate({ ...ORDER, carrier: null, customerUrl: null, attemptAt: null }, 'es');
    expect(c.text).toContain('La paquetería intentó entregar tu paquete y no pudo.');
    expect(c.text).toContain('Comunícate con la paquetería con tu número de guía para acordar otra entrega.');
  });

  it('CANARIO: «Este es tu segundo intento» o un plazo los caza el barrido', () => {
    expect('Este es tu segundo intento').toMatch(/segundo|second/i);
    expect('Tienes 3 días').toMatch(PROHIBIDO);
  });
});

// =================================================================================================== barrido de variantes
describe('ML-24/25/26 — barrido: TODA variante (fecha sí/no, sucursal sí/no, paquetería sí/no, rastreo sí/no, pedido/retiro/invitado, es/en)', () => {
  const variants = () => {
    const out: { name: string; m: Msg }[] = [];
    for (const l of ['es', 'en'])
      for (const who of [ORDER, VAULT, { ...ORDER, orderId: null }])
        for (const carrier of ['Estafeta', null])
          for (const trackingUrl of [TRACK, null])
            for (const at of [new Date('2026-10-05T18:30:00Z'), null]) {
              const p = { ...who, carrier, trackingUrl, customerUrl: who.orderId === null && who.orderNumber ? GUEST_URL : undefined };
              out.push({ name: `AV-17 ${l} ${who.shipmentId} ${carrier} ${!!trackingUrl} ${!!at}`, m: tpl.shipmentDeliveredTemplate({ ...p, carrierStatusAt: at }, l) });
              out.push({ name: `AV-18 ${l} ${who.shipmentId} ${carrier} ${!!trackingUrl} ${!!at}`, m: tpl.shipmentAtBranchTemplate({ ...p, branchName: at ? 'Centro' : null }, l) });
              out.push({ name: `AV-19 ${l} ${who.shipmentId} ${carrier} ${!!trackingUrl} ${!!at}`, m: tpl.shipmentDeliveryAttemptTemplate({ ...p, attemptAt: at }, l) });
            }
    return out;
  };
  it('ninguna lleva plazo, disputa ni importe; todas llevan la frase de soporte FUERA del pie', () => {
    const bad = variants()
      .filter(({ m }) => PROHIBIDO.test(all(m)) || IMPORTE.test(all(m)) || !bodyOf(m).includes(SUPPORT) || /segundo|second/i.test(all(m)))
      .map((v) => v.name);
    expect(bad).toEqual([]);
    expect(variants()).toHaveLength(2 * 3 * 2 * 2 * 2 * 3);
  });
});

// =================================================================================================== PS-88 (plantillas)
describe('PS-88 (plantillas) — `trackingUrl` solo si vino; ⛔ ninguna URL construida con la guía (C-SDX-6)', () => {
  it('AV-4 y AV-5: sin `trackingUrl` ⇒ ninguna URL de rastreo; con ella ⇒ ESA exacta', () => {
    for (const l of ['es', 'en']) {
      expect(all(tpl.shipmentGuideTemplate({ ...ORDER, carrier: 'E', trackingNumber: 'T1', trackingUrl: null }, l))).not.toContain('skydropx');
      expect(all(tpl.shipmentShippedTemplate({ ...ORDER, trackingUrl: null }, l))).not.toContain('skydropx');
      expect(tpl.shipmentGuideTemplate({ ...ORDER, carrier: 'E', trackingNumber: 'T1', trackingUrl: TRACK }, l).text).toContain(TRACK);
      expect(tpl.shipmentShippedTemplate({ ...ORDER, trackingUrl: TRACK }, l).text).toContain(TRACK);
    }
  });

  it('`customerUrl` (del servicio) manda sobre la ruta por defecto; `null` ⇒ sin CTA', () => {
    const m = tpl.shipmentShippedTemplate({ ...ORDER, orderId: null, customerUrl: GUEST_URL }, 'es');
    expect(m.text).toContain(GUEST_URL);
    const n = tpl.shipmentShippedTemplate({ ...VAULT, customerUrl: null }, 'es');
    expect(n.text).not.toContain(ORIGIN);
  });

  it('C-SDX-6: ninguna plantilla de `backend/src` construye una URL de rastreo con la guía (`rastreo.` / `tracking?`)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (/templates?\.ts$|mail.*\.ts$/.test(e) && !e.endsWith('.spec.ts')) files.push(f);
      }
    };
    walk(join(__dirname, '..', 'src'));
    expect(files.length).toBeGreaterThan(5);
    const hits = files.filter((f) => /rastreo\.|tracking\?|\/track(ing)?\/\$\{/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('§19.12: la cabecera «NO HAY PLANTILLA DE ENTREGADO» se reescribió (la plantilla existe y NO cuelga de `updateStatus`)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'shipments', 'mail', 'shipment-notice.templates.ts'), 'utf8');
    expect(src).not.toMatch(/NO HAY PLANTILLA DE «ENTREGADO»/);
    expect(src).toMatch(/AV-17/);
  });
});

// =================================================================================================== PS-89 (cuerpo)
describe('PS-89 (cuerpo) — `toCustomerTimeline`: mapeo fijo, sin `exception` ni detalle, claves exactas', () => {
  const T = (m: number) => new Date(Date.UTC(2026, 9, 5, 10, m));
  const ev = (status: string, m: number, extra: Record<string, unknown> = {}) => ({
    status,
    occurredAt: T(m),
    branchName: null,
    detail: `detalle interno ${status}`,
    providerShipmentId: 'ps-1',
    ...extra,
  });
  const sdx = { labelSource: 'skydropx', providerShipmentId: 'ps-1', shippedAt: null as Date | null, deliveredAt: null as Date | null };

  it('la secuencia created → picked_up → last_mile → delivery_attempt → delivered_to_branch → delivered ⇒ kinds fijos en orden', () => {
    const tl = toCustomerTimeline(
      [ev('created', 1), ev('picked_up', 2), ev('last_mile', 3), ev('delivery_attempt', 4), ev('delivered_to_branch', 5, { branchName: 'Centro' }), ev('delivered', 6)] as any,
      sdx as any,
    );
    expect(tl.map((x) => x.kind)).toEqual(['label_created', 'in_transit', 'out_for_delivery', 'delivery_attempt', 'at_branch', 'delivered']);
    expect(tl.find((x) => x.kind === 'at_branch')).toEqual({ kind: 'at_branch', at: T(5).toISOString(), branchName: 'Centro' });
    for (const x of tl.filter((y) => y.kind !== 'at_branch')) expect(Object.keys(x).sort()).toEqual(['at', 'kind']);
    expect(JSON.stringify(tl)).not.toMatch(/detalle|ps-1|carrierStatus|providerShipmentId/);
  });

  it('`exception|retained|in_return|destroyed|canceled` ⇒ NO aparecen; `shipped` = `shippedAt`; orden `at asc`', () => {
    const tl = toCustomerTimeline(
      [ev('in_transit', 3), ev('exception', 4), ev('retained', 5), ev('in_return', 6), ev('destroyed', 7), ev('canceled', 8)] as any,
      { ...sdx, shippedAt: T(2) } as any,
    );
    expect(tl).toEqual([
      { kind: 'shipped', at: T(2).toISOString() },
      { kind: 'in_transit', at: T(3).toISOString() },
    ]);
  });

  it('solo los eventos de la guía VIGENTE (una re-emitida no hereda la historia de la cancelada)', () => {
    const tl = toCustomerTimeline([ev('created', 1, { providerShipmentId: 'ps-old' }), ev('created', 2)] as any, sdx as any);
    expect(tl).toEqual([{ kind: 'label_created', at: T(2).toISOString() }]);
  });

  it('guía MANUAL ⇒ solo lo derivado de las fechas (`shipped`, `delivered`); sin envío salido ⇒ []', () => {
    const manual = { labelSource: 'manual', providerShipmentId: null, shippedAt: T(1), deliveredAt: T(9) };
    expect(toCustomerTimeline([ev('delivered', 3)] as any, manual as any)).toEqual([
      { kind: 'shipped', at: T(1).toISOString() },
      { kind: 'delivered', at: T(9).toISOString() },
    ]);
    expect(toCustomerTimeline([], { labelSource: null, providerShipmentId: null, shippedAt: null, deliveredAt: null } as any)).toEqual([]);
  });
});

// =================================================================================================== §19.33.2 (cuerpo)
describe('§19.33.2 (PS-78 ampliada, cuerpo) — estado desconocido ⇒ `exception` con `detail` y llave `unknown:`', () => {
  const obs = new Date('2026-10-05T12:00:00Z');
  const urls = { trackingUrl: null, labelUrl: null };

  it('historial con un valor fuera de los 12 ⇒ evento `exception`, detail «Estado no reconocido: v · detalle», llave `unknown:v:<fecha>`', () => {
    const out = carrierEventsOf(
      {
        carrierStatus: null,
        statusUpdatedAt: null,
        trackingNumber: 'T',
        events: [{ status: null, rawStatus: 'estado_raro', occurredAt: '2026-10-05T11:00:00Z', detail: 'lo que dijo' }],
      } as any,
      obs,
      urls,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(
      expect.objectContaining({
        status: 'exception',
        detail: 'Estado no reconocido: estado_raro · lo que dijo',
        providerEventKey: 'unknown:estado_raro:2026-10-05T11:00:00Z',
        synthetic: false,
      }),
    );
  });

  it('⛔ la llave NUNCA es la de un `exception` real del mismo instante (son DOS eventos)', () => {
    const out = carrierEventsOf(
      {
        carrierStatus: 'exception',
        statusUpdatedAt: null,
        trackingNumber: 'T',
        events: [
          { status: 'exception', rawStatus: 'exception', occurredAt: '2026-10-05T11:00:00Z' },
          { status: null, rawStatus: 'estado_raro', occurredAt: '2026-10-05T11:00:00Z' },
        ],
      } as any,
      obs,
      urls,
    );
    const keys = out.map((e) => e.providerEventKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('valor recortado a 64 y sin caracteres de control; con id del evento ⇒ `id:<id>`', () => {
    const raw = 'x\u0007y'.padEnd(80, 'z');
    const [e] = carrierEventsOf(
      { carrierStatus: null, statusUpdatedAt: null, trackingNumber: 'T', events: [{ status: null, rawStatus: raw, occurredAt: null, providerEventId: 'E9' }] } as any,
      obs,
      urls,
    );
    const v = e.detail!.replace('Estado no reconocido: ', '');
    expect(v).toHaveLength(64);
    expect(v).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(e.providerEventKey).toBe('id:E9');
  });

  it('sin historial: el estado actual desconocido ⇒ UN `exception` sintético con llave `unknown:v[:updated_at]` (⛔ nunca `now`)', () => {
    const a = carrierEventsOf({ carrierStatus: null, unknownCarrierStatus: 'teleported', statusUpdatedAt: null, trackingNumber: 'T', events: [] } as any, obs, urls);
    expect(a).toEqual([expect.objectContaining({ status: 'exception', providerEventKey: 'unknown:teleported', synthetic: true, detail: 'Estado no reconocido: teleported' })]);
    const b = carrierEventsOf({ carrierStatus: null, unknownCarrierStatus: 'teleported', statusUpdatedAt: '2026-10-05T09:00:00Z', trackingNumber: 'T', events: [] } as any, obs, urls);
    expect(b[0].providerEventKey).toBe('unknown:teleported:2026-10-05T09:00:00Z');
  });
});
