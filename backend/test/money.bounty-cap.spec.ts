import * as fs from 'fs';
import * as path from 'path';
import { bountyPayoutCents, quoteAcquisitionFromCurve, VariantPriceControls } from '../src/common/money';
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../src/common/pricing-curve';

/**
 * v1.80 — TOPE DE PAGO DEL BOUNTY (API_CONTRACT §M2-B.11, ARCHITECTURE §4.36.6e; decisión del dueño
 * 2026-09-28 en `HECHOS.md`): un bounty efectivo paga `min(bounty, mercado)`; sin mercado (o mercado
 * degenerado `<= 0`, H-1) paga el bounty tal cual. Sin piso en la tarifa normal.
 *
 * Pruebas BC-1..BC-6 y BC-9 del contrato. BC-7 es el canario de «quién es efectivo»: la tabla de 12
 * casos de `src/common/pricing-curve.spec.ts` sigue verde SIN editarla. BC-8/10/11/12 viven en
 * `test/integration/bounty-cap.e2e-spec.ts` (Postgres real).
 */

// Curva «cara»: 40 % plano, bin $1 ⇒ mercado 1000 cotiza 400 (renglones `1000/400/*` de la tabla).
const CURVE_CARO: PricingCurve = {
  ...DEFAULT_PRICING_CURVE,
  buy: { binCents: 100, points: [{ marketCents: 100000, pctBp: 4000 }] },
};
// Curva «barata»: el BIN domina ⇒ mercado 500 cotiza 700 (renglones `500/700/*`).
const CURVE_BARATO: PricingCurve = {
  ...DEFAULT_PRICING_CURVE,
  buy: { binCents: 700, points: [{ marketCents: 100000, pctBp: 4000 }] },
};

const bounty = (cents: number): VariantPriceControls => ({ bountyEnabled: true, bountyPriceCents: cents });

describe('BC-1..BC-4 — bountyPayoutCents: la regla, un solo cuerpo (§M2-B.11 punto 1)', () => {
  it('BC-1 bounty > mercado ⇒ se paga el MERCADO', () => {
    expect(bountyPayoutCents(1200, 1000)).toBe(1000);
  });

  it('BC-2 bounty < mercado ⇒ se paga el BOUNTY (ni el mercado, ni el máximo)', () => {
    expect(bountyPayoutCents(800, 1000)).toBe(800);
  });

  it('empate bounty == mercado ⇒ ese número', () => {
    expect(bountyPayoutCents(1000, 1000)).toBe(1000);
  });

  it('BC-3 sin mercado ⇒ el bounty completo (decisión del dueño: «Pagar el bounty completo»)', () => {
    expect(bountyPayoutCents(5000, null)).toBe(5000);
  });

  it('BC-4 mercado degenerado (0 / negativo) ⇒ AUSENTE ⇒ el bounty (jamás topar a MX$0)', () => {
    expect(bountyPayoutCents(5000, 0)).toBe(5000);
    expect(bountyPayoutCents(5000, -1)).toBe(5000);
  });

  it('enteros entran, entero sale: ningún redondeo (nunca un centavo por encima del mercado)', () => {
    for (const [b, m] of [
      [1, 1],
      [99999, 99998],
      [2147483647, 12345],
      [7, 2147483647],
    ] as [number, number][]) {
      const out = bountyPayoutCents(b, m);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeLessThanOrEqual(m);
      expect(out).toBeLessThanOrEqual(b);
    }
  });
});

describe('BC-5 — la tabla normativa del punto 6 por quoteAcquisitionFromCurve', () => {
  it.each([
    // mercado, curva, bounty, paga, basis, glosa, curvaUsada
    [null, null, 5000, 5000, 'bounty', 'sin mercado ⇒ bounty', CURVE_CARO],
    [0, null, 5000, 5000, 'bounty', 'mercado degenerado ⇒ ausente ⇒ bounty (H-1)', CURVE_CARO],
    [1000, 400, 401, 401, 'bounty', 'bounty < mercado', CURVE_CARO],
    [1000, 400, 1000, 1000, 'bounty', 'empate con mercado', CURVE_CARO],
    [1000, 400, 1200, 1000, 'bounty', 'bounty > mercado ⇒ mercado (NO la curva)', CURVE_CARO],
    [500, 700, 701, 500, 'bounty', 'barato: bounty > bin > mercado ⇒ mercado (sin piso en tarifa)', CURVE_BARATO],
    [500, 700, 650, 500, 'bounty', 'barato: bin > bounty > mercado ⇒ mercado', CURVE_BARATO],
    [500, 700, 500, 500, 'bounty', 'barato: bounty = mercado', CURVE_BARATO],
    [1000, 400, 400, 400, 'market', 'NO efectivo ⇒ la curva, sin tope', CURVE_CARO],
  ] as [number | null, number | null, number, number, string, string, PricingCurve][])(
    'mercado=%p curva=%p bounty=%p ⇒ paga %p (%s / %s)',
    (market, curveQuote, b, paga, basis, _glosa, curve) => {
      const res = quoteAcquisitionFromCurve(market, curve, bounty(b));
      expect(res).toEqual({
        priceCents: paga,
        basis,
        // `marketMxnCents` y `curveQuoteCents` SIN cambio: el tope toca solo el monto.
        marketMxnCents: market,
        curveQuoteCents: curveQuote,
      });
    },
  );

  it('dueño, literal: mercado $5, tarifa $7, bounty $8 ⇒ se pagan $5', () => {
    const curve: PricingCurve = {
      ...DEFAULT_PRICING_CURVE,
      buy: { binCents: 700, points: [{ marketCents: 100000, pctBp: 4000 }] },
    };
    expect(quoteAcquisitionFromCurve(500, curve).priceCents).toBe(700); // la tarifa normal
    expect(quoteAcquisitionFromCurve(500, curve, bounty(800))).toMatchObject({ priceCents: 500, basis: 'bounty' });
  });
});

describe('BC-6 — el override manual de compra NO se topa (peldaño 2, absoluto)', () => {
  it('bounty NO efectivo + buyOverride 5000 + mercado 1000 ⇒ paga 5000 `override`', () => {
    const res = quoteAcquisitionFromCurve(1000, CURVE_CARO, {
      bountyEnabled: true,
      bountyPriceCents: 400, // = curva ⇒ no efectivo
      buyOverrideCents: 5000,
    });
    expect(res).toMatchObject({ priceCents: 5000, basis: 'override', marketMxnCents: 1000 });
  });

  it('sin bounty: override por encima del mercado se paga verbatim', () => {
    expect(quoteAcquisitionFromCurve(1000, CURVE_CARO, { buyOverrideCents: 5000 })).toMatchObject({
      priceCents: 5000,
      basis: 'override',
    });
  });
});

// ============================================================================================
// BC-9 — candado de FORMA: `bountyPayoutCents` es el ÚNICO `Math.min` sobre un monto de bounty.
// ============================================================================================

const SRC_ROOT = path.resolve(__dirname, '..', 'src');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * Blanquea los comentarios (`//…` y `/* … *\/`) conservando los offsets, para que la prosa de un
 * docblock que CITA la regla no cuente como código. Respeta literales de cadena (una URL `https://`
 * dentro de una cadena no abre comentario).
 */
function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i += 2;
      else {
        if (c === quote) quote = null;
        i += 1;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      i += 1;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i += 1) if (src[i] !== '\n') out[i] = ' ';
    } else i += 1;
  }
  return out.join('');
}

/** Cada `Math.min(...)` con sus argumentos completos (paréntesis balanceados). */
function mathMinCalls(src: string): { index: number; args: string }[] {
  const calls: { index: number; args: string }[] = [];
  const re = /Math\s*\.\s*min\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    calls.push({ index: m.index, args: src.slice(start, i - 1) });
  }
  return calls;
}

/** Offsets `[inicio, fin)` del cuerpo de `export function bountyPayoutCents`. */
function bountyPayoutBodyRange(src: string): [number, number] | null {
  const at = src.indexOf('export function bountyPayoutCents(');
  if (at < 0) return null;
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 1;
  let i = open + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    i += 1;
  }
  return [open, i];
}

/** Devuelve las ubicaciones `archivo:offset` de todo `Math.min` sobre bounty FUERA de la función única. */
function bountyMinOffenders(files: { file: string; src: string }[]): string[] {
  const offenders: string[] = [];
  for (const { file, src: raw } of files) {
    const src = blankComments(raw);
    const range = file.endsWith(path.join('common', 'money.ts')) ? bountyPayoutBodyRange(src) : null;
    for (const call of mathMinCalls(src)) {
      if (!/bounty/i.test(call.args)) continue;
      if (range && call.index >= range[0] && call.index < range[1]) continue;
      offenders.push(`${path.relative(SRC_ROOT, file)}@${call.index}: Math.min(${call.args})`);
    }
  }
  return offenders;
}

describe('BC-9 — candado de forma: un solo tope (§M2-B.11 punto 3)', () => {
  const files = listSourceFiles(SRC_ROOT).map((file) => ({ file, src: fs.readFileSync(file, 'utf8') }));

  it('el escáner ve el árbol (no pasa en vacío)', () => {
    expect(files.length).toBeGreaterThan(50);
    const money = files.find((f) => f.file.endsWith(path.join('common', 'money.ts')));
    expect(money).toBeDefined();
    const src = blankComments(money!.src);
    expect(bountyPayoutBodyRange(src)).not.toBeNull();
    // El cuerpo único SÍ tiene su Math.min sobre el bounty (si no, el candado no protege nada).
    const [a, b] = bountyPayoutBodyRange(src)!;
    expect(mathMinCalls(src).some((c) => c.index >= a && c.index < b && /bounty/i.test(c.args))).toBe(true);
  });

  it('ningún `Math.min` sobre un monto de bounty fuera de `bountyPayoutCents`', () => {
    expect(bountyMinOffenders(files)).toEqual([]);
  });

  it('🐤 canario: un `Math.min` a mano en la vitrina SÍ se detecta', () => {
    const fake = {
      file: path.join(SRC_ROOT, 'modules', 'buylist', 'buylist.service.ts'),
      src: 'const pay = Math.min(r.bountyPriceCents as number, referenceMxnCents);',
    };
    expect(bountyMinOffenders([fake])).toHaveLength(1);
    // …y uno COMENTADO no (la prosa que cita la regla no es código).
    expect(bountyMinOffenders([{ ...fake, src: '// Math.min(bounty, market)\n/* Math.min(bountyX, m) */' }])).toEqual([]);
  });

  it('la vitrina, el peldaño 1 y el composer LLAMAN a `bountyPayoutCents`', () => {
    const read = (rel: string) => fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
    const buylist = read('modules/buylist/buylist.service.ts');
    const publicBody = buylist.slice(buylist.indexOf('async publicBounties('), buylist.indexOf('async createRequest('));
    expect(publicBody).toMatch(/bountyPayoutCents\(/);
    expect(read('modules/pricing/variant-pricing.ts')).toMatch(/bountyPayoutCents\(/);
    const money = read('common/money.ts');
    const q = money.slice(money.indexOf('export function quoteAcquisitionFromCurve('));
    expect(q.slice(0, q.indexOf('\n}\n'))).toMatch(/bountyPayoutCents\(/);
  });
});
