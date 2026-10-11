/**
 * 💰 v1.84 LIVE-4 · RS5-TD-4 — candado estático (condición C-2 (b) del techlead, `TECH_DEBT` RS5-TD-4 «Candado estático»).
 *
 * Norma (API_CONTRACT §14.4): `pending → failed` sobre `Order` se escribe SOLO con `failPendingOrder(tx, orderId)`
 * (`orders/reservation.ts`), que es un CAS (`where: { id, status: 'pending' }`). Cualquier otra escritura de
 * `status: 'failed'` sobre `order` —`update` por id, un `updateMany` con su propio CAS literal, un `upsert`, un
 * `UPDATE "Order"` crudo— es un segundo cuerpo que puede divergir (perder el `status: 'pending'` del `WHERE` y pisar una
 * orden liquidada o reembolsada con un estado liquidable).
 *
 * Lista de permitidos: UN elemento — la llamada dentro de `failPendingOrder`.
 *
 * Alcance (lo que este candado NO ve, dicho para no venderlo de más): un `data` construido en una variable aparte
 * (`const d = { status: 'failed' }; tx.order.update({ data: d })`) o un estado pasado por parámetro. Para eso está la
 * revisión; el candado caza la forma literal, que es la que se escribe cuando se copia un CAS.
 *
 * Cada predicado lleva su CANARIO: un texto que debe hacerlo saltar, para que el candado no pase por estar ciego.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/**
 * Sustituye comentarios por espacios (conserva los saltos de línea y los desplazamientos, para poder reportar la
 * línea). Un `status: 'failed'` en un comentario no es una escritura.
 */
function blankComments(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])(\/\/.*)$/gm, (_m, a: string, b: string) => a + blank(b));
}

/** Texto entre el `(` en `open` y su `)` pareado (sin entender cadenas: basta para argumentos de Prisma). */
function balancedArgs(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** Quita los `where: { … }` (llaves pareadas): un `status: 'failed'` en el filtro no es una escritura. */
function withoutWhere(args: string): string {
  let out = args;
  for (let m = /\bwhere\s*:\s*\{/.exec(out); m; m = /\bwhere\s*:\s*\{/.exec(out)) {
    let depth = 0;
    let end = out.length;
    for (let i = m.index + m[0].length - 1; i < out.length; i++) {
      if (out[i] === '{') depth++;
      else if (out[i] === '}' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    out = out.slice(0, m.index) + out.slice(end);
  }
  return out;
}

const FAILED = /\bstatus\s*:\s*(['"`])failed\1|\bstatus\s*:\s*OrderStatus\.failed\b/;
const ORDER_WRITE = /\border\s*\.\s*(update|updateMany|upsert|create|createMany)\s*\(/g;
const RAW_ORDER_UPDATE = /UPDATE\s+"?Order"?\s+SET\b[^`]*/gi;

export interface FailedWrite {
  offset: number;
  line: number;
  kind: string;
}

/** Toda escritura de `status: 'failed'` sobre `order` en `text` (Prisma o SQL crudo). */
export function failedOrderWrites(text: string): FailedWrite[] {
  const t = blankComments(text);
  const lineOf = (off: number) => t.slice(0, off).split('\n').length;
  const hits: FailedWrite[] = [];
  for (const m of t.matchAll(ORDER_WRITE)) {
    const open = m.index! + m[0].length - 1;
    if (FAILED.test(withoutWhere(balancedArgs(t, open)))) hits.push({ offset: m.index!, line: lineOf(m.index!), kind: `order.${m[1]}` });
  }
  for (const m of t.matchAll(RAW_ORDER_UPDATE)) {
    if (/\bstatus"?\s*=\s*'failed'/i.test(m[0].split(/\bWHERE\b/i)[0])) hits.push({ offset: m.index!, line: lineOf(m.index!), kind: 'raw UPDATE "Order"' });
  }
  return hits;
}

/** Cuerpo de `export async function failPendingOrder(` en `text`: [inicio, fin) (hasta el siguiente `export`). */
function failPendingOrderSpan(text: string): [number, number] | null {
  const start = text.indexOf('export async function failPendingOrder(');
  if (start < 0) return null;
  const next = text.indexOf('\nexport ', start + 1);
  return [start, next < 0 ? text.length : next];
}

const DEFINER = 'modules/orders/reservation.ts';

describe('RS5-TD-4 · candado — `status: failed` sobre `order` solo en `failPendingOrder`', () => {
  it('canario: el predicado ve las formas literales (update por id, CAS copiado multilínea, upsert, SQL crudo)', () => {
    expect(failedOrderWrites(`await tx.order.update({ where: { id }, data: { status: 'failed' } });`)).toHaveLength(1);
    // La forma exacta que tenía `payments.service.ts:701` (`failAndRelease`) en 10d1430c.
    expect(
      failedOrderWrites(
        `const moved = await tx.order.updateMany({\n  where: { id: order.id, status: 'pending' },\n  data: { status: "failed" },\n});`,
      ),
    ).toHaveLength(1);
    expect(failedOrderWrites(`this.prisma.order.upsert({ where: { id }, update: { status: OrderStatus.failed }, create })`)).toHaveLength(1);
    expect(failedOrderWrites('await tx.$executeRaw`UPDATE "Order" SET status = \'failed\' WHERE id = ${id}`;')).toHaveLength(1);
  });

  it('canario: NO salta con otros modelos, otros estados ni comentarios', () => {
    expect(failedOrderWrites(`tx.paymentRefund.update({ where: { id }, data: { status: 'failed' } })`)).toEqual([]);
    expect(failedOrderWrites(`tx.spendDigestRun.update({ data: { status: 'failed' } })`)).toEqual([]);
    expect(failedOrderWrites(`tx.order.updateMany({ where: { id, status: 'failed' }, data: { status: 'settled' } })`)).toEqual([]);
    expect(failedOrderWrites(`tx.order.updateMany({ where: { id, status: 'pending' }, data: { status: 'settled' } })`)).toEqual([]);
    expect(failedOrderWrites('tx.$executeRaw`UPDATE "Order" SET status = \'settled\' WHERE status = \'failed\'`')).toEqual([]);
    expect(failedOrderWrites(`// tx.order.update({ data: { status: 'failed' } })\n/* tx.order.update({ data: { status: 'failed' } }) */`)).toEqual([]);
  });

  it('el censo no está ciego: ve la escritura de `failPendingOrder` en el código real', () => {
    const text = fs.readFileSync(path.join(SRC, DEFINER), 'utf8');
    const span = failPendingOrderSpan(text);
    expect(span).not.toBeNull();
    const hits = failedOrderWrites(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].offset).toBeGreaterThanOrEqual(span![0]);
    expect(hits[0].offset).toBeLessThan(span![1]);
  });

  it('en todo `backend/src` hay EXACTAMENTE una escritura, y es la de `failPendingOrder` (lista de permitidos de un elemento)', () => {
    const found: string[] = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join('/');
      const text = fs.readFileSync(f, 'utf8');
      const span = rel === DEFINER ? failPendingOrderSpan(text) : null;
      for (const h of failedOrderWrites(text)) {
        const allowed = span !== null && h.offset >= span[0] && h.offset < span[1];
        found.push(allowed ? 'failPendingOrder' : `${rel}:${h.line} (${h.kind})`);
      }
    }
    expect(found).toEqual(['failPendingOrder']);
  });
});
