import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { MailMessage } from '../src/modules/mail/mail.port';
import * as kycTpl from '../src/modules/admin/mail/kyc-notice.templates';
import * as orderTpl from '../src/modules/orders/mail/order-notice.templates';
import * as shipmentTpl from '../src/modules/shipments/mail/shipment-notice.templates';
import * as disputeTpl from '../src/modules/disputes/mail/dispute-notice.templates';
import { buylistPortalUrl } from '../src/modules/buylist/buylist-mail.templates';

/**
 * # Candado: todo enlace de correo al cliente apunta a una RUTA QUE EXISTE en el front
 *
 * ## El defecto que cierra (medido en clientes reales, 2026-09-29)
 * Los CTA de los avisos al cliente registrado apuntaban a `cuenta/pedidos`, `boveda/envios`,
 * `cuenta/identidad` y `cuenta/aclaraciones`: **ninguna existe** en `frontend/src/app/[locale]/` ⇒
 * el botón del correo terminaba en un 404. Las pruebas de las plantillas miraban el copy y los datos
 * prohibidos, pero **nadie comparaba el href contra el árbol de rutas del front**.
 *
 * ## Cómo muerde
 * 1. Lee el árbol real de páginas del front (`page.tsx` bajo `frontend/src/app/[locale]/`, ignorando
 *    grupos `(x)` y con `[param]` como segmento dinámico).
 * 2. **Render:** pinta cada aviso con `APP_PUBLIC_URL` puesto, extrae TODO href/URL del origen y
 *    exige que su ruta exista. Exhaustivo sobre los exports `*Template` de los ficheros de avisos.
 * 3. **Estático:** barre `backend/src` buscando los constructores de enlaces al front (`appUrl('…')`,
 *    `${origin}/${locale}/…`, `buildFrontendLink(…, '…')`) — quien añada uno nuevo queda cubierto sin
 *    tocar este fichero.
 *
 * ⚠️ Lee `../frontend`: corre sobre el **árbol entero** (O-9). Sin front, falla en voz alta, no pasa.
 */

const BACKEND_ROOT = join(__dirname, '..');
const FRONT_LOCALE_DIR = join(BACKEND_ROOT, '..', 'frontend', 'src', 'app', '[locale]');
const ORIGIN = 'https://app.example.test';
const DYN = '__dyn__';

type Segment = { kind: 'static'; name: string } | { kind: 'dynamic' } | { kind: 'catchAll'; optional: boolean };

/**
 * Un catch-all cuyo `page.tsx` SOLO llama a `notFound()` es un CENTINELA, no un destino: existe para que
 * una URL desconocida case dentro de `[locale]` y la 404 salga por-petición con nonce de CSP
 * (`frontend/src/app/[locale]/[...rest]/page.tsx`, candado `e2e/csp.spec.ts` CSP-2). Si lo contáramos como
 * ruta, su segmento catch-all casaría con CUALQUIER path ⇒ `routeExists(lo-que-sea)` sería `true` y este
 * candado quedaría vacío. Un catch-all REAL (que renderiza contenido) sí es ruta y no entra aquí.
 */
function isNotFoundOnlySentinel(dir: string, entries: string[]): boolean {
  const pageName = entries.find((e) => /^page\.(tsx|ts|jsx|js)$/.test(e));
  if (!pageName) return false;
  const raw = readFileSync(join(dir, pageName), 'utf8');
  // Fuera comentarios de bloque y de línea: no queremos leer un `return` o un `<Tag` que viva en un comentario.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  if (!/\bnotFound\s*\(\s*\)/.test(src)) return false; // sin llamada a notFound() no es centinela
  // Quitadas las llamadas a notFound(), si aún hay un `return` o JSX, la página SIRVE contenido ⇒ ruta real.
  const sinNotFound = src
    .replace(/\breturn\s+notFound\s*\(\s*\)\s*;?/g, '')
    .replace(/\bnotFound\s*\(\s*\)\s*;?/g, '');
  if (/\breturn\b/.test(sinNotFound)) return false;
  if (/<[A-Za-z]/.test(sinNotFound)) return false; // JSX ⇒ contenido
  return true;
}

/** Todas las rutas con `page.tsx`, como listas de segmentos (grupos `(x)` fuera). */
function frontendRoutes(): Segment[][] {
  const routes: Segment[][] = [];
  const walk = (dir: string, segs: Segment[]): void => {
    const entries = readdirSync(dir);
    const last = segs[segs.length - 1];
    const esCentinela = last?.kind === 'catchAll' && isNotFoundOnlySentinel(dir, entries);
    if (!esCentinela && entries.some((e) => /^page\.(tsx|ts|jsx|js)$/.test(e))) routes.push(segs);
    for (const e of entries) {
      const full = join(dir, e);
      if (!statSync(full).isDirectory()) continue;
      if (e.startsWith('_') || e.startsWith('@')) continue; // carpetas privadas / slots: no son ruta
      if (/^\(.*\)$/.test(e)) {
        walk(full, segs);
        continue;
      }
      const catchAll = /^\[\[?\.\.\.[^\]]+\]\]?$/.exec(e);
      if (catchAll) {
        walk(full, [...segs, { kind: 'catchAll', optional: e.startsWith('[[') }]);
        continue;
      }
      if (/^\[[^\]]+\]$/.test(e)) {
        walk(full, [...segs, { kind: 'dynamic' }]);
        continue;
      }
      walk(full, [...segs, { kind: 'static', name: e }]);
    }
  };
  walk(FRONT_LOCALE_DIR, []);
  return routes;
}

function matches(route: Segment[], parts: string[]): boolean {
  for (let i = 0; i < route.length; i++) {
    const seg = route[i];
    if (seg.kind === 'catchAll') return seg.optional || parts.length > i;
    const part = parts[i];
    if (part === undefined) return false;
    if (seg.kind === 'dynamic') continue;
    // El marcador de segmento dinámico del barrido estático SOLO casa con `[param]`.
    if (part === DYN || part !== seg.name) return false;
  }
  return parts.length === route.length;
}

let ROUTES: Segment[][] = [];

/** `path` = lo que va DESPUÉS de `/<locale>/`, sin query. */
function routeExists(path: string): boolean {
  const parts = path.split('?')[0].split('#')[0].split('/').filter(Boolean);
  return ROUTES.some((r) => matches(r, parts));
}

/**
 * v1.84.4 (`API_CONTRACT §14.17` E4-5): el pie de TODO correo enlaza el aviso de privacidad. No es el
 * CTA del aviso, así que `linkedPaths` lo aparta; que su ruta exista lo mide «el pie legal» (abajo) y que
 * esté en cada familia lo mide `mail.privacy-footer.spec.ts`.
 */
const PRIVACY_PATH = '/privacidad';

/** Extrae de un correo las rutas (post-locale) de todo enlace al origen del front (sin el pie legal). */
function linkedPaths(msg: Omit<MailMessage, 'to'>): string[] {
  const escaped = ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}/(es|en)(/[^\\s"'<>]*)?`, 'g');
  const out: string[] = [];
  for (const body of [msg.html, msg.text ?? '']) {
    for (const m of body.matchAll(re)) out.push((m[2] ?? '/').replace(/&amp;/g, '&'));
  }
  return out.filter((p) => p !== PRIVACY_PATH);
}

beforeAll(() => {
  if (!existsSync(FRONT_LOCALE_DIR)) {
    throw new Error(
      `No existe ${FRONT_LOCALE_DIR}: este candado lee el árbol del front. Córrelo sobre el repo ENTERO (O-9).`,
    );
  }
  ROUTES = frontendRoutes();
});

describe('el lector del árbol del front (sanidad: sin esto el candado sería vacío)', () => {
  it('reconoce rutas reales y rechaza las inventadas', () => {
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(routeExists('orders')).toBe(true);
    expect(routeExists('orders/abc-123')).toBe(true);
    expect(routeExists('shipments/abc')).toBe(true);
    expect(routeExists('pedido')).toBe(true);
    expect(routeExists('verify-email')).toBe(true);
    expect(routeExists('')).toBe(true); // portada
    expect(routeExists('cuenta/pedidos')).toBe(false);
    expect(routeExists('boveda/envios')).toBe(false);
    expect(routeExists('orders/abc/extra')).toBe(false);
    expect(routeExists(`account/${DYN}`)).toBe(false);
  });
});

describe('el pie legal: el enlace «Aviso de privacidad» apunta a una ruta que existe (§14.17 E4-5)', () => {
  it('`/privacidad` existe en el front y es la que emite el pie', () => {
    expect(routeExists(PRIVACY_PATH)).toBe(true);
    const saved = process.env.APP_PUBLIC_URL;
    process.env.APP_PUBLIC_URL = ORIGIN;
    try {
      const html = kycTpl.kycRejectedTemplate({ reason: 'borrosa' }, 'Ash', 'es').html;
      expect(html).toContain(`href="${ORIGIN}/es${PRIVACY_PATH}"`);
    } finally {
      if (saved === undefined) delete process.env.APP_PUBLIC_URL;
      else process.env.APP_PUBLIC_URL = saved;
    }
  });
});

describe('render: cada aviso al cliente enlaza a una ruta que existe', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeAll(() => {
    process.env.APP_PUBLIC_URL = ORIGIN;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });

  /** Cada variante que DEBE llevar CTA (con su enlace esperado para no aceptar un href cualquiera). */
  const CASOS: Record<string, { tpl: string; render: (l: string) => Omit<MailMessage, 'to'>; ruta: string }> = {
    'AV-1 kyc': {
      tpl: 'kycRejectedTemplate',
      render: (l) => kycTpl.kycRejectedTemplate({ reason: 'borrosa' }, 'Ash', l),
      ruta: '/account',
    },
    'AV-2 pedido liquidado': {
      tpl: 'orderSettledTemplate',
      render: (l) =>
        orderTpl.orderSettledTemplate({ orderNumber: 'TCG-1', orderId: 'ord-1', items: [], totalCents: 100 }, l),
      ruta: '/orders/ord-1',
    },
    'AV-3 reembolso (registrado)': {
      tpl: 'orderRefundedTemplate',
      render: (l) => orderTpl.orderRefundedTemplate({ orderNumber: 'TCG-1', orderId: 'ord-1', totalCents: 100 }, l),
      ruta: '/orders/ord-1',
    },
    'AV-4 guía (pedido)': {
      tpl: 'shipmentGuideTemplate',
      render: (l) =>
        shipmentTpl.shipmentGuideTemplate(
          { shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: 'ord-1', carrier: 'E', trackingNumber: 'T' },
          l,
        ),
      ruta: '/orders/ord-1',
    },
    'AV-4 guía (bóveda)': {
      tpl: 'shipmentGuideTemplate',
      render: (l) =>
        shipmentTpl.shipmentGuideTemplate({ shipmentId: 'shp-1', orderNumber: null, carrier: 'E', trackingNumber: 'T' }, l),
      ruta: '/shipments/shp-1',
    },
    'AV-5 salida (pedido)': {
      tpl: 'shipmentShippedTemplate',
      render: (l) => shipmentTpl.shipmentShippedTemplate({ shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: 'ord-1' }, l),
      ruta: '/orders/ord-1',
    },
    'AV-5 salida (bóveda)': {
      tpl: 'shipmentShippedTemplate',
      render: (l) => shipmentTpl.shipmentShippedTemplate({ shipmentId: 'shp-1', orderNumber: null }, l),
      ruta: '/shipments/shp-1',
    },
    'AV-6 cancelado (bóveda)': {
      tpl: 'shipmentCancelledTemplate',
      render: (l) => shipmentTpl.shipmentCancelledTemplate({ shipmentId: 'shp-1', orderNumber: null }, l),
      ruta: '/shipments/shp-1',
    },
    'AV-6 cancelado (pedido)': {
      tpl: 'shipmentCancelledTemplate',
      render: (l) => shipmentTpl.shipmentCancelledTemplate({ shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: 'ord-1' }, l),
      ruta: '/orders/ord-1',
    },
    // ⭐ D2e (§19.12, PS-87): los tres avisos del transportista, y la liga del invitado `pedido?token=` (ruta `pedido`).
    'AV-17 entregado (pedido)': {
      tpl: 'shipmentDeliveredTemplate',
      render: (l) =>
        shipmentTpl.shipmentDeliveredTemplate({ shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: 'ord-1', carrier: 'E', trackingNumber: 'T' }, l),
      ruta: '/orders/ord-1',
    },
    'AV-17 entregado (invitado, customerUrl del servicio)': {
      tpl: 'shipmentDeliveredTemplate',
      render: (l) =>
        shipmentTpl.shipmentDeliveredTemplate(
          { shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: null, carrier: 'E', trackingNumber: 'T', customerUrl: `${ORIGIN}/${l}/pedido?token=TKN` },
          l,
        ),
      ruta: '/pedido?token=TKN',
    },
    'AV-18 en sucursal (bóveda)': {
      tpl: 'shipmentAtBranchTemplate',
      render: (l) => shipmentTpl.shipmentAtBranchTemplate({ shipmentId: 'shp-1', orderNumber: null, carrier: 'E', trackingNumber: 'T', branchName: 'Centro' }, l),
      ruta: '/shipments/shp-1',
    },
    'AV-19 intento (pedido)': {
      tpl: 'shipmentDeliveryAttemptTemplate',
      render: (l) =>
        shipmentTpl.shipmentDeliveryAttemptTemplate({ shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: 'ord-1', carrier: 'E', trackingNumber: 'T' }, l),
      ruta: '/orders/ord-1',
    },
    'AV-10 disputa recompra': {
      tpl: 'disputeRepurchaseTemplate',
      render: (l) => disputeTpl.disputeRepurchaseTemplate({ folio: 'd-1', resolution: null }, l),
      ruta: '/vault',
    },
    'AV-11 disputa rechazada': {
      tpl: 'disputeRejectedTemplate',
      render: (l) => disputeTpl.disputeRejectedTemplate({ folio: 'd-1', resolution: null }, l),
      ruta: '/vault',
    },
  };

  it('EXHAUSTIVIDAD: toda plantilla exportada de estos ficheros tiene al menos un caso', () => {
    const exportadas = [kycTpl, orderTpl, shipmentTpl, disputeTpl]
      .flatMap((m) => Object.entries(m))
      .filter(([k, v]) => typeof v === 'function' && k.endsWith('Template'))
      .map(([k]) => k)
      .sort();
    const cubiertas = [...new Set(Object.values(CASOS).map((c) => c.tpl))].sort();
    expect(cubiertas).toEqual(exportadas);
  });

  for (const [nombre, caso] of Object.entries(CASOS)) {
    for (const l of ['es', 'en']) {
      it(`${nombre} [${l}]: lleva enlace y su ruta existe en el front`, () => {
        const paths = linkedPaths(caso.render(l));
        expect(paths.length).toBeGreaterThan(0); // sin enlace el candado no mide nada
        for (const p of paths) {
          expect({ ruta: p, existe: routeExists(p) }).toEqual({ ruta: p, existe: true });
          expect(p).toBe(caso.ruta);
        }
      });
    }
  }

  it('pedido de INVITADO: sin CTA (el detalle exige sesión) — nunca un enlace a una ruta de cuenta', () => {
    for (const l of ['es', 'en']) {
      expect(linkedPaths(orderTpl.orderRefundedTemplate({ orderNumber: 'TCG-1', orderId: null, totalCents: 1 }, l))).toEqual([]);
      expect(
        linkedPaths(shipmentTpl.shipmentShippedTemplate({ shipmentId: 'shp-1', orderNumber: 'TCG-1', orderId: null }, l)),
      ).toEqual([]);
    }
  });

  it('portal de buylist: su ruta existe', () => {
    const url = buylistPortalUrl('sr-1', 'es');
    expect(url).toBeDefined();
    const path = (url as string).slice(`${ORIGIN}/es`.length);
    expect(routeExists(path)).toBe(true);
  });
});

describe('estático: todo constructor de enlace al front en backend/src apunta a una ruta que existe', () => {
  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return e.endsWith('.ts') && !e.endsWith('.spec.ts') ? [full] : [];
    });
  }
  /** `${…}` ⇒ segmento dinámico. */
  const norm = (p: string): string => p.replace(/\$\{[^}]*\}/g, DYN);

  const hallados: { donde: string; ruta: string }[] = [];
  for (const file of tsFiles(join(BACKEND_ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const donde = relative(BACKEND_ROOT, file);
    // appUrl('ruta', …) / appUrl(`ruta/${id}`, …)
    for (const m of src.matchAll(/\bappUrl\(\s*(['`])((?:(?!\1).)*)\1/g)) hallados.push({ donde, ruta: norm(m[2]) });
    // `${origin}/${locale}/ruta…`
    for (const m of src.matchAll(/\$\{origin\}\/\$\{[^}]+\}\/([^`'"?\s]*)/g)) {
      if (/^\$\{[^}]*\}$/.test(m[1])) continue; // `${path}` entero: lo cubre el barrido de sus llamadas
      hallados.push({ donde, ruta: norm(m[1]) });
    }
    // buildFrontendLink(user, 'ruta', …)
    for (const m of src.matchAll(/\bbuildFrontendLink\(\s*[\w.]+,\s*'([^']+)'/g)) hallados.push({ donde, ruta: m[1] });
  }

  it('el barrido encuentra los constructores conocidos (no es vacío)', () => {
    const rutas = hallados.map((h) => h.ruta);
    expect(rutas).toEqual(expect.arrayContaining(['account', 'vault', 'pedido', 'verify-email', 'reset-password']));
    expect(hallados.length).toBeGreaterThanOrEqual(10);
  });

  it('ninguno apunta a una ruta inexistente', () => {
    const rotos = hallados.filter((h) => !routeExists(h.ruta));
    expect(rotos).toEqual([]);
  });
});
