/**
 * 💰🔒 D2c-cierre (API_CONTRACT §M4-SHIP.19.31, errata v1.80.12.12) — unitarias y estáticas. Propiedad: backend.
 *
 *  - PS-166 (a) `isPurchaseKeyTurned`: la tabla 3 `kind` × 4 entornos ⇒ `true` SOLO en (`skydropx`, ALLOW) y (`fake`, FAKE).
 *    Mutación: `ALLOW || FAKE` sin mirar `kind` ⇒ rojo en (`skydropx`, FAKE).
 *  - PS-166 (b) arranque: la llave del doble con otro adaptador (o sin adaptador) ⇒ no arranca; con `fake` ⇒ `kind:'fake'`;
 *    `fake` + `SKYDROPX_ALLOW_SPEND=true` ⇒ no arranca (PS-98). Mutación: quitar la comprobación ⇒ rojo.
 *  - PS-166 (c) `evaluateMutationGate(readMutationGateInput({NODE_ENV:'production', <llave del doble>:'true'}))` ⇒
 *    `forbidden 'not_enabled'` (el censo vive en `skydropx.no-real-purchase.spec.ts`).
 *  - PS-168 (a)(b) `quoteExpiryFor` (pura) con su log; la integración vive en `sdx-d2c-cierre.e2e-spec.ts`.
 *  - PS-169 estático: las llaves del `data` del RECLAMO ⊆ las de CADA deshacer (§19.31.7 (d)), con canario sintético.
 *  - Piezas puras de la pieza 1: `parseFolioFilter`, `carrierAlertActive`, `labelFilenameOf`, el PDF del doble.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  evaluateMutationGate,
  fakePurchaseKeyMisplaced,
  isPurchaseKeyTurned,
  ProviderKind,
  readMutationGateInput,
} from '../src/modules/shipping-provider/spend-gate';
import { fakeLabelUrlFor, selectShippingProvider } from '../src/modules/shipping-provider/shipping-provider.factory';
import { FakeShippingProvider, FAKE_LABEL_PDF } from '../src/modules/shipping-provider/fake-shipping-provider';
import { assertProviderUrl } from '../src/modules/shipping-provider/provider-url';
import { QUOTE_TTL_MS, quoteExpiryFor, quotationFingerprint } from '../src/modules/shipments/label-quote.service';
import { parseFolioFilter, SHIPMENT_LABEL_SOURCE_FILTER_VALUES } from '../src/modules/shipments/shipments.service';
import { carrierAlertActive } from '../src/modules/shipments/label-view';
import { labelFilenameOf } from '../src/modules/shipments/label-pdf.service';
import { purchaseKeyFor } from '../src/modules/shipments/label-purchase.service';
import { codigoDeFichero } from './helpers/codigo-de-fichero';

const FAKE_KEY = 'SHIPPING_FAKE_PURCHASE';
const H = 60 * 60 * 1000;

describe('PS-166 (a) — isPurchaseKeyTurned: la tercera llave depende del adaptador elegido al ARRANCAR', () => {
  const envs: Record<string, NodeJS.ProcessEnv> = {
    nada: {},
    allow: { SKYDROPX_ALLOW_SPEND: 'true' },
    fake: { [FAKE_KEY]: 'true' },
    las_dos: { SKYDROPX_ALLOW_SPEND: 'true', [FAKE_KEY]: 'true' },
  };
  const kinds: ProviderKind[] = ['skydropx', 'fake', 'noop'];
  const expected: Record<ProviderKind, Record<string, boolean>> = {
    skydropx: { nada: false, allow: true, fake: false, las_dos: true },
    fake: { nada: false, allow: false, fake: true, las_dos: true },
    noop: { nada: false, allow: false, fake: false, las_dos: false },
  };
  for (const kind of kinds) {
    for (const [name, env] of Object.entries(envs)) {
      it(`(${kind}, ${name}) ⇒ ${expected[kind][name]}`, () => {
        expect(isPurchaseKeyTurned(kind, env)).toBe(expected[kind][name]);
      });
    }
  }

  it('solo el literal `true` gira la llave del doble (`TRUE`, `1`, `yes` ⇒ no)', () => {
    for (const v of ['TRUE', '1', 'yes', ' true', '']) expect(isPurchaseKeyTurned('fake', { [FAKE_KEY]: v })).toBe(false);
  });

  it('la llave por defecto del módulo (`purchaseKeyFor`) lee el entorno del PROCESO en cada llamada (⛔ sin caché)', () => {
    const saved = process.env[FAKE_KEY];
    try {
      delete process.env[FAKE_KEY];
      const key = purchaseKeyFor('fake');
      expect(key.turned()).toBe(false);
      process.env[FAKE_KEY] = 'true';
      expect(key.turned()).toBe(true);
      expect(purchaseKeyFor('skydropx').turned()).toBe(false);
      expect(purchaseKeyFor('noop').turned()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env[FAKE_KEY];
      else process.env[FAKE_KEY] = saved;
    }
  });
});

describe('PS-166 (b) — el arranque con la llave del doble mal puesta', () => {
  const CREDS = { SKYDROPX_BASE_URL: 'https://api.recorder.invalid/api/v1', SKYDROPX_CLIENT_ID: 'id', SKYDROPX_CLIENT_SECRET: 'secret' };
  it('`fakePurchaseKeyMisplaced`: no vacía (trim) ∧ adaptador ≠ fake', () => {
    expect(fakePurchaseKeyMisplaced('skydropx', { [FAKE_KEY]: 'true' })).toBe(true);
    expect(fakePurchaseKeyMisplaced('skydropx', { [FAKE_KEY]: 'false' })).toBe(true); // cualquier valor: falla ruidosa
    expect(fakePurchaseKeyMisplaced('skydropx', { [FAKE_KEY]: '  ' })).toBe(false);
    expect(fakePurchaseKeyMisplaced('skydropx', {})).toBe(false);
    expect(fakePurchaseKeyMisplaced('fake', { [FAKE_KEY]: 'true' })).toBe(false);
  });

  it.each([
    ['skydropx sin credenciales (producción)', { NODE_ENV: 'production', SHIPPING_PROVIDER_ADAPTER: 'skydropx' }],
    ['skydropx con credenciales (producción)', { NODE_ENV: 'production', SHIPPING_PROVIDER_ADAPTER: 'skydropx', ...CREDS }],
    ['sin SHIPPING_PROVIDER_ADAPTER (default skydropx)', { NODE_ENV: 'production', ...CREDS }],
    ['skydropx bajo NODE_ENV=test (sería Noop)', { NODE_ENV: 'test', SHIPPING_PROVIDER_ADAPTER: 'skydropx' }],
    ['valor raro de la llave', { NODE_ENV: 'production', ...CREDS, [FAKE_KEY]: 'false' }],
  ])('%s + la llave del doble ⇒ el proceso NO arranca', (_name, env) => {
    const withKey = { [FAKE_KEY]: 'true', ...env };
    expect(() => selectShippingProvider(withKey)).toThrow(/no arranca/);
  });

  it("con `fake` ⇒ kind 'fake', el doble, y una labelUrl por defecto que pasa assertProviderUrl", () => {
    const s = selectShippingProvider({ NODE_ENV: 'production', SHIPPING_PROVIDER_ADAPTER: 'fake', [FAKE_KEY]: 'true' });
    expect(s.kind).toBe('fake');
    expect(s.port).toBeInstanceOf(FakeShippingProvider);
    const url = (s.port as FakeShippingProvider).defaultLabelUrl as string;
    expect(assertProviderUrl(url, s.urlHosts)).toBe(url);
  });

  // `fake` + `SKYDROPX_ALLOW_SPEND=true` ⇒ no arranca (PS-98): ya lo mide `shipping-provider.factory.spec.ts`; ⛔ no se
  // duplica aquí para no poner esa llave en el proceso una vez más.

  it('fakeLabelUrlFor: primer host; `*.dominio` ⇒ `labels.dominio`; lista vacía ⇒ fake.invalid', () => {
    expect(fakeLabelUrlFor(['pro.skydropx.com'])).toBe('https://pro.skydropx.com/labels/fake.pdf');
    expect(fakeLabelUrlFor(['*.skydropx.com'])).toBe('https://labels.skydropx.com/labels/fake.pdf');
    expect(assertProviderUrl(fakeLabelUrlFor(['*.skydropx.com']), ['*.skydropx.com'])).not.toBeNull();
    expect(fakeLabelUrlFor([])).toBe('https://fake.invalid/labels/fake.pdf');
  });
});

describe('PS-166 (c) — el candado de ejecución del adaptador real NO ve la llave del doble', () => {
  it("evaluateMutationGate(readMutationGateInput({NODE_ENV:'production', llave del doble})) ⇒ forbidden 'not_enabled'", () => {
    expect(evaluateMutationGate(readMutationGateInput({ NODE_ENV: 'production', [FAKE_KEY]: 'true' }))).toEqual({ forbidden: 'not_enabled' });
    // y la firma no cambió: cuatro entradas, ninguna es la llave del doble
    expect(Object.keys(readMutationGateInput({ [FAKE_KEY]: 'true' })).sort()).toEqual(['allowSpend', 'ci', 'jestWorkerId', 'nodeEnv']);
    expect(readMutationGateInput({ [FAKE_KEY]: 'true' }).allowSpend).toBeUndefined();
  });
});

describe('PS-168 (a)(b) — quoteExpiryFor: misma generación mientras haya una viva; nueva si todas vencieron', () => {
  const T = new Date('2026-10-05T12:00:00Z');
  const at = (h: number) => new Date(T.getTime() + h * H);

  it('sin filas ⇒ now + 24 h, sin log', () => {
    expect(quoteExpiryFor([], T)).toEqual({ expiresAt: at(24), reissuedAfter: null });
  });
  it('(a) X visto en T (A), en T+10 h para B ⇒ T+24 h (⛔ no se alarga)', () => {
    expect(quoteExpiryFor([{ expiresAt: at(24) }], at(10))).toEqual({ expiresAt: at(24), reissuedAfter: null });
  });
  it('(b) X visto en T+25 h (todas vencidas) ⇒ T+49 h, con la última vencida para el log', () => {
    expect(quoteExpiryFor([{ expiresAt: at(24) }, { expiresAt: at(20) }], at(25))).toEqual({ expiresAt: at(49), reissuedAfter: at(24) });
  });
  it('con una viva y otra vencida de una generación anterior ⇒ la viva manda', () => {
    expect(quoteExpiryFor([{ expiresAt: at(24) }, { expiresAt: at(49) }], at(30))).toEqual({ expiresAt: at(49), reissuedAfter: null });
  });
  it('la frontera: `expiresAt == now` ya está vencida (como el paso 3 de §19.7: `expiresAt <= now`)', () => {
    expect(quoteExpiryFor([{ expiresAt: at(24) }], at(24)).expiresAt).toEqual(at(48));
  });
  it('QUOTE_TTL_MS = 24 h; la huella del id no lo contiene (⛔ el id entero no viaja al log)', () => {
    expect(QUOTE_TTL_MS).toBe(24 * H);
    const fp = quotationFingerprint('fake-quotation-abc-1');
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(fp).not.toContain('abc');
  });
});

/**
 * PS-169 (§19.31.7 (d)) — el `data` de deshacer el reclamo es el INVERSO EXACTO del `data` del reclamo. Se lee del CÓDIGO
 * (sin comentarios): el bloque `data` del CAS del paso 7 y CADA bloque que deshace un reclamo (`rateChosenAt: null`) en
 * `label-purchase.service.ts` y `label-recovery.service.ts`. Mutación: añadir una columna al reclamo sin el deshacer ⇒ rojo.
 */
describe('PS-169 — las llaves del `data` del reclamo ⊆ las de CADA deshacer', () => {
  const SRC = join(__dirname, '..', 'src', 'modules', 'shipments');

  /** Índices del `{ … }` que encierra la posición `pos` (el primer `{` sin cerrar hacia atrás). */
  const enclosingBlock = (code: string, pos: number): string => {
    let depth = 0;
    let open = -1;
    for (let i = pos; i >= 0; i -= 1) {
      if (code[i] === '}') depth += 1;
      else if (code[i] === '{') {
        if (depth === 0) {
          open = i;
          break;
        }
        depth -= 1;
      }
    }
    if (open < 0) throw new Error('bloque sin abrir');
    depth = 0;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1;
      else if (code[i] === '}') {
        depth -= 1;
        if (depth === 0) return code.slice(open, i + 1);
      }
    }
    throw new Error('bloque sin cerrar');
  };
  /** Las claves de PRIMER nivel de un literal de objeto `{ a: …, b: … }`. */
  const topKeys = (block: string): string[] => {
    const keys: string[] = [];
    let depth = 0;
    const body = block.slice(1, -1);
    for (const m of body.matchAll(/[{}()[\]]|(?:^|[,\n])\s*([A-Za-z_]\w*)\s*:/g)) {
      const t = m[0].trim();
      if (t === '{' || t === '(' || t === '[') depth += 1;
      else if (t === '}' || t === ')' || t === ']') depth -= 1;
      else if (depth === 0 && m[1]) keys.push(m[1]);
    }
    return keys.sort();
  };
  const claimKeysOf = (code: string): string[] => {
    const i = code.indexOf('labelProcessingSince: since,');
    if (i < 0) throw new Error('no encontré el data del reclamo (labelProcessingSince: since)');
    return topKeys(enclosingBlock(code, i));
  };
  const undoBlocksOf = (code: string): string[][] =>
    [...code.matchAll(/rateChosenAt: null/g)].map((m) => topKeys(enclosingBlock(code, m.index as number)));
  const missing = (claim: string[], undo: string[]) => claim.filter((k) => !undo.includes(k));

  it('código real: el reclamo y los CUATRO deshacer (undo, CAS local, CLAIM_UNDO, liberar)', () => {
    const purchase = codigoDeFichero(join(SRC, 'label-purchase.service.ts'), ['labelProcessingSince: since,', 'export const CLAIM_UNDO']);
    const recovery = codigoDeFichero(join(SRC, 'label-recovery.service.ts'), ['rateChosenAt: null']);
    const claim = claimKeysOf(purchase);
    expect(claim).toEqual(
      [
        'labelProcessingSince',
        'providerQuotationId',
        'providerRateId',
        'chosenRateJson',
        'recommendedRateJson',
        'rateChosenByUserId',
        'rateChosenAt',
        'packageCode',
        'packageDimsJson',
        'declaredValueCents',
        'insuredValueCents',
      ].sort(),
    );
    const undos = [...undoBlocksOf(purchase), ...undoBlocksOf(recovery)];
    expect(undos.length).toBe(4);
    for (const u of undos) expect(missing(claim, u)).toEqual([]);
  });

  it('canario: una columna nueva en el reclamo que el deshacer no limpia ⇒ se detecta', () => {
    const src = `
      await tx.shipmentRequest.updateMany({ where: { id }, data: { labelProcessingSince: since, packageCode: x, nueva: 1 } });
      await tx.shipmentRequest.updateMany({ where: { id }, data: { labelProcessingSince: null, packageCode: null, rateChosenAt: null } });`;
    const claim = claimKeysOf(src);
    const [undo] = undoBlocksOf(src);
    expect(missing(claim, undo)).toEqual(['nueva']);
  });
});

describe('pieza 1 — filtros, alerta del transportista, nombre del PDF, PDF del doble', () => {
  it('?folio=: ausente/en blanco ⇒ sin filtro; `^ENV-\\d{6,}$` ⇒ igualdad exacta; otro ⇒ 400 {field:folio}', () => {
    expect(parseFolioFilter(undefined)).toBeUndefined();
    expect(parseFolioFilter('')).toBeUndefined();
    expect(parseFolioFilter('  ')).toBeUndefined();
    expect(parseFolioFilter('ENV-000045')).toBe('ENV-000045');
    expect(parseFolioFilter('ENV-1234567')).toBe('ENV-1234567');
    for (const bad of ['ENV-45', 'env-000045', ' ENV-000045', 'ENV-000045 ', 'ENV-00004a', 'X', ['ENV-000045']]) {
      let err: any = null;
      try {
        parseFolioFilter(bad);
      } catch (e) {
        err = e;
      }
      expect(err?.getStatus?.()).toBe(400);
      expect(err?.getResponse?.()).toEqual(expect.objectContaining({ code: 'VALIDATION_ERROR', details: { field: 'folio' } }));
    }
  });

  it('?labelSource=: el dominio es el enum entero (clase E, derivado)', () => {
    expect([...SHIPMENT_LABEL_SOURCE_FILTER_VALUES].sort()).toEqual(['manual', 'skydropx']);
  });

  it('carrierAlertActive (§19.3): vivo + Skydropx + estado de alerta, o `canceled` sin sello propio', () => {
    const base = { status: 'enviado' as const, labelSource: 'skydropx' as const, carrierStatus: 'exception' as const, providerCanceledAt: null };
    expect(carrierAlertActive(base)).toBe(true);
    for (const cs of ['delivery_attempt', 'exception', 'retained', 'in_return', 'destroyed'] as const) expect(carrierAlertActive({ ...base, carrierStatus: cs })).toBe(true);
    for (const cs of ['created', 'picked_up', 'in_transit', 'last_mile', 'delivered_to_branch', 'delivered'] as const) expect(carrierAlertActive({ ...base, carrierStatus: cs })).toBe(false);
    expect(carrierAlertActive({ ...base, carrierStatus: 'canceled' })).toBe(true);
    expect(carrierAlertActive({ ...base, carrierStatus: 'canceled', providerCanceledAt: new Date() })).toBe(false);
    expect(carrierAlertActive({ ...base, status: 'entregado' })).toBe(false);
    expect(carrierAlertActive({ ...base, status: 'cancelado' })).toBe(false);
    expect(carrierAlertActive({ ...base, labelSource: 'manual' })).toBe(false);
    expect(carrierAlertActive({ ...base, carrierStatus: null })).toBe(false);
  });

  it('labelFilenameOf: `guia-<orderNumber|shipmentId>.pdf`, sin caracteres de cabecera', () => {
    expect(labelFilenameOf('TCG-000123', 'ship1')).toBe('guia-TCG-000123.pdf');
    expect(labelFilenameOf(null, 'ckabc123')).toBe('guia-ckabc123.pdf');
    expect(labelFilenameOf('a"b\r\n;c', 's')).toBe('guia-abc.pdf');
    expect(labelFilenameOf('"";', '')).toBe('guia-envio.pdf');
  });

  it('el PDF del doble: fijo, empieza por %PDF-, termina en %%EOF, y su xref apunta a objetos reales', () => {
    const fake = new FakeShippingProvider();
    const a = fake.labelPdf('x');
    const b = fake.labelPdf('y');
    expect(a.equals(b)).toBe(true);
    const text = a.toString('latin1');
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(FAKE_LABEL_PDF.length).toBeLessThan(2048);
    expect(fake.callsOf('labelPdf')).toHaveLength(2);
  });
});

// Lectura de control: que este fichero mire el código que cree (no-vacuidad del bloque `readFileSync`).
it('control: label-purchase.service.ts existe y trae el CAS del reclamo', () => {
  expect(readFileSync(join(__dirname, '..', 'src', 'modules', 'shipments', 'label-purchase.service.ts'), 'utf8')).toContain('EL CAS del reclamo');
});
