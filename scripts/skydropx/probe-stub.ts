/**
 * probe-stub.ts — doble EN MEMORIA de la API de Skydropx para `prod-probe.test.ts` y `prod-probe.ts --dry-run`.
 * Registra cada petición que le llega (método, URL, cuerpo) para que la prueba compruebe qué intentó la sonda.
 * Imita lo medido en PROD (§3, §4.1 reutilización por ruta+medidas ignorando el seguro, §4.4, §5.4). Los datos
 * personales de la plantilla son INVENTADOS y sirven de canario de la redacción. ⛔ Sin red.     · devops
 */
import type { ProbeFetch, ProbeFetchInit, ProbeFetchResponse } from './prod-probe';

export interface StubCall {
  method: string;
  url: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/** Valores INVENTADOS para el doble (con `_dummy`: la allowlist de gitleaks los reconoce como ficción); la prueba
 * exige que ninguno aparezca en la salida. */
export const STUB_SECRETS = {
  clientId: 'stub_dummy_client_id_0123456789abcdefghijklmn',
  clientSecret: 'stub_dummy_client_secret_zyxwvutsrqponmlkjih',
  token: 'stub_dummy_token.' + 'Q'.repeat(60),
  templateId: 'tmpl-7f3a9c2e',
  phone: '5512345678',
  email: 'duena.inventada@ejemplo-stub.mx',
  name: 'Nombre Inventado Stub',
};

function reply(status: number, body: unknown): ProbeFetchResponse {
  const text = body === undefined ? '' : JSON.stringify(body);
  return { status, text: async () => text };
}

function protectionFor(declared: number): number {
  if (declared <= 2500) return 25;
  if (declared <= 10000) return 170;
  return Math.round(declared * 0.017 * 100) / 100;
}

export function createStubSkydropx(): { origin: string; clientId: string; clientSecret: string; calls: StubCall[]; fetch: ProbeFetch } {
  const origin = 'https://stub.skydropx.invalid';
  const calls: StubCall[] = [];
  const byKey = new Map<string, string>();
  const quotations = new Map<string, { packages: unknown[]; templateFromId: string | null; polls: number }>();
  let seq = 0;

  const fetch: ProbeFetch = async (url: string, init: ProbeFetchInit) => {
    calls.push({ method: init.method, url, body: init.body, headers: { ...init.headers } });
    const u = new URL(url);
    const p = u.pathname;
    const authed = init.headers.Authorization === `Bearer ${STUB_SECRETS.token}`;
    if (init.method === 'POST' && p === '/api/v1/oauth/token') {
      return reply(200, { access_token: STUB_SECRETS.token, token_type: 'Bearer', expires_in: 7200, scope: 'default', created_at: 1791086306 });
    }
    if (!authed) return reply(401, { error: 'unauthorized' });
    if (init.method === 'POST' && (p === '/api/v1/quotations' || p === '/api/v2/quotations')) {
      const q = JSON.parse(init.body ?? '{}').quotation ?? {};
      const parcel = (q.parcels ?? [])[0] ?? {};
      const templateFromId: string | null = q.address_template_from_id ?? q.address_from?.address_template_id ?? null;
      // Reutilización medida (M-5): misma ruta y medidas ⇒ mismo id, el seguro se ignora.
      const key = JSON.stringify([q.address_from?.postal_code ?? templateFromId, q.address_to?.postal_code, parcel.length, parcel.width, parcel.height, parcel.weight]);
      let id = byKey.get(key);
      if (!id) {
        seq += 1;
        id = `quot-${String(seq).padStart(4, '0')}`;
        byKey.set(key, id);
        const declared = Number(parcel.declared_value ?? 2500);
        quotations.set(id, {
          packages: [{ package_number: 1, height: String(parcel.height), package_protected: parcel.package_protected !== false, declared_value: `${declared}.0`, protection_value: protectionFor(declared) }],
          templateFromId,
          polls: 0,
        });
      }
      return reply(201, { id, is_completed: false, rates: [{ id: `${id}-r1`, status: 'pending', success: false }] });
    }
    const qm = /^\/api\/v1\/quotations\/([^/]+)$/.exec(p);
    if (init.method === 'GET' && qm) {
      const q = quotations.get(decodeURIComponent(qm[1]));
      if (!q) return reply(404, { message: 'not found' });
      q.polls += 1;
      const pkg = q.packages[0] as { protection_value: number };
      return reply(200, {
        id: qm[1],
        is_completed: q.polls >= 1,
        requires_origin_verification: q.templateFromId === null,
        address_template_from_id: q.templateFromId,
        packages: q.packages,
        rates: [
          { id: `${qm[1]}-r99`, success: true, status: 'price_found_external', provider_name: 'ninetynineminutes', total: '70.15', protection_value_total: pkg.protection_value, requires_origin_verification: false },
          { id: `${qm[1]}-rpx`, success: true, status: 'price_found_internal', provider_name: 'paquetexpress', total: '51.25', protection_value_total: pkg.protection_value, requires_origin_verification: q.templateFromId === null },
          { id: `${qm[1]}-rjt`, success: false, status: 'price_found_external', provider_name: 'jtexpress', total: '60.00' },
        ],
      });
    }
    if (init.method === 'GET' && p === '/api/v1/finance/credits') return reply(200, { data: { balance: 965.16, currency: 'MXN' } });
    if (init.method === 'GET' && p === '/api/v1/address_templates') {
      return reply(200, {
        data: [
          {
            id: STUB_SECRETS.templateId,
            alias: 'Calle Inventada',
            address_type: 'from',
            default: false,
            address: { name: STUB_SECRETS.name, phone: STUB_SECRETS.phone, email: STUB_SECRETS.email, street1: 'Calle Inventada 1', postal_code: '14210' },
          },
        ],
        meta: { total_count: 1 },
      });
    }
    if (init.method === 'GET' && p === '/api/v1/finance/extra-charges') return reply(200, { data: [], meta: { total_count: 0 } });
    if (init.method === 'GET' && p === '/api/v1/office_points') {
      return reply(200, { data: [{ id: 'op-1', name: 'Punto Inventado', address: { street1: 'x', postal_code: '14210' }, phone: STUB_SECRETS.phone }] });
    }
    if (init.method === 'GET' && p === '/api/v1/shipments') {
      return reply(200, { data: [], included: [], meta: { current_page: 1, total_pages: 0, total_count: 0 } });
    }
    return reply(404, { message: 'El recurso buscado no se pudo encontrar.' });
  };

  return { origin, clientId: STUB_SECRETS.clientId, clientSecret: STUB_SECRETS.clientSecret, calls, fetch };
}
