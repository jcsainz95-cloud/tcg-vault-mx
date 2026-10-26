import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { analizarFuente, codigoDe } from './strip-comments';

/**
 * 💰 **DCO-F6** (API_CONTRACT §DSC.10, v1.110.3) — el front NO reconstruye el precio antes del descuento.
 *
 * El servidor proyecta `unitPriceBeforeDiscountCents`, `lineTotalBeforeDiscountCents` y
 * `OrderDiscountDTO.merchandiseBeforeDiscountCents`; la pantalla pinta `x ?? unitPriceCents` / `?? lineTotalCents` /
 * `?? breakdown.subtotalCents`. Hasta `c421de13` lo sumaba en ~10 sitios (`unitPriceCents + unitDiscountCents`,
 * `lineTotalCents + quantity × unitDiscountCents`, `subtotalCents + discount.discountCents`): rechazo R2 del techlead.
 *
 * Se mide sobre el CÓDIGO FUENTE (sin comentarios), como `frontend-never-multiplies.test.ts`: una suma de más no rompe la
 * pantalla, la deja cuadrando con una cifra que el servidor no dio.
 *
 * ⚠️ Lo que NO ve, dicho: un alias (`const u = l.unitDiscountCents ?? 0; … q * u`). Lo cubre la mitad positiva de abajo
 * (los sitios pintan el campo del servidor) y las pruebas de pantalla con datos del servidor.
 *
 * «Envío regalado» (pedidos + retiros, v1.110.2) es la única suma ratificada en este dominio y no usa estos campos.
 */

const ROOT = join(process.cwd(), 'src');

/**
 * Simuladores del servidor (su trabajo es producir la cifra que el servidor produciría), igual que en
 * `frontend-never-multiplies.test.ts`. ⛔ Ninguna pantalla entra aquí.
 */
const SIMULADORES = (rel: string) => rel === 'src/lib/api.ts' || rel.startsWith('src/lib/mock/');

/** Un operando de dinero de descuento: `unitDiscountCents` o `discount.discountCents` (`discount?.` incluido). */
const OPERANDO = String.raw`(?:\bunitDiscountCents\b|\bdiscount\??\.discountCents\b)`;

export const PROHIBIDO_DCO_F6: { patron: RegExp; porque: string }[] = [
  {
    // `+ x.unitDiscountCents`, `* (l.unitDiscountCents ?? 0)`, `+ discount.discountCents`
    patron: new RegExp(String.raw`[+*]\s*\(?\s*(?:[\w$]+\??\.)*` + OPERANDO),
    porque: 'sumar o multiplicar POR la rebaja (reconstruir el exhibido)',
  },
  {
    // `unitDiscountCents ?? 0) +`, `discount.discountCents +`, `unitDiscountCents * q`
    patron: new RegExp(OPERANDO + String.raw`(?:\s*\?\?\s*\d+)?\s*\)?\s*[+*]`),
    porque: 'usar la rebaja como sumando o factor',
  },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

const ficheros = walk(ROOT)
  .filter((abs) => /\.(ts|tsx)$/.test(abs))
  .map((abs) => abs.slice(process.cwd().length + 1))
  .filter((rel) => !/\.test\.tsx?$/.test(rel) && !/\.testkit\.tsx?$/.test(rel))
  .filter((rel) => !SIMULADORES(rel));

describe('DCO-F6 · 💰 el front no suma ni multiplica la rebaja (§DSC.6 v1.110.3)', () => {
  it('el barrido mira de verdad (no está vacío)', () => {
    expect(ficheros.length).toBeGreaterThan(200);
    expect(ficheros).toContain('src/app/[locale]/(storefront)/checkout/CheckoutLines.tsx');
  });

  it.each(PROHIBIDO_DCO_F6)('⛔ ninguna pantalla hace: $porque', ({ patron }) => {
    const ofensores = ficheros.filter((rel) => patron.test(codigoDe(join(process.cwd(), rel), rel)));
    expect(ofensores).toEqual([]);
  });

  /** La mitad positiva: los sitios del rechazo R2 pintan el campo que proyecta el servidor. */
  it.each([
    ['src/app/[locale]/(storefront)/checkout/CheckoutLines.tsx', /unitPriceBeforeDiscountCents\s*\?\?\s*item\.unitPriceCents/],
    ['src/app/[locale]/(storefront)/orders/[orderId]/OrderDetailView.tsx', /unitPriceBeforeDiscountCents\s*\?\?\s*it\.unitPriceCents/],
    ['src/app/[locale]/pedido/PublicOrderTracking.tsx', /unitPriceBeforeDiscountCents\s*\?\?\s*item\.unitPriceCents/],
    ['src/app/[locale]/pedido/PublicOrderTracking.tsx', /lineTotalBeforeDiscountCents\s*\?\?\s*l\.lineTotalCents/],
    ['src/app/[locale]/(admin)/admin/m3/[orderId]/M3OrderDetailView.tsx', /unitPriceBeforeDiscountCents\s*\?\?\s*it\.unitPriceCents/],
    ['src/app/[locale]/(admin)/admin/m3/[orderId]/M3OrderDetailView.tsx', /lineTotalBeforeDiscountCents\s*\?\?\s*l\.lineTotalCents/],
    ['src/app/[locale]/(storefront)/checkout/AccessoryCartLines.tsx', /lineTotalBeforeDiscountCents\s*\?\?\s*l\.lineTotalCents/],
    ['src/app/[locale]/(storefront)/checkout/AccessoryCartLines.tsx', /unitPriceBeforeDiscountCents\s*\?\?\s*l\.unitPriceCents/],
    ['src/components/ui/AmountBreakdown.tsx', /discount\.merchandiseBeforeDiscountCents\s*\?\?\s*breakdown\.subtotalCents/],
  ] as const)('⭐ %s pinta el campo del servidor', (rel, patron) => {
    expect(codigoDe(join(process.cwd(), rel), rel)).toMatch(patron);
  });
});

/**
 * Canario (candado + canario): se reintroduce en el fichero REAL el defecto de `c421de13` y se exige rojo; el mismo
 * texto en un comentario no cuenta.
 */
describe('DCO-F6 · canario sobre el fichero real', () => {
  const REL = 'src/app/[locale]/(storefront)/checkout/CheckoutLines.tsx';
  const fuente = readFileSync(join(process.cwd(), REL), 'utf8');
  const limpio = (src: string) => analizarFuente(src, REL).limpio;
  const muerde = (src: string) => PROHIBIDO_DCO_F6.some(({ patron }) => patron.test(limpio(src)));

  it('el fichero de hoy está verde', () => {
    expect(muerde(fuente)).toBe(false);
  });

  it.each([
    ['CheckoutLines:58 de c421de13', 'item.unitPriceCents + (item.unitDiscountCents ?? 0)'],
    ['accesorio de c421de13', 'l.lineTotalCents + l.quantity * (l.unitDiscountCents ?? 0)'],
    ['appliedDiscountOfOrder de c421de13', 'breakdown.subtotalCents + discount.discountCents'],
    ['rebaja a la izquierda', 'item.unitDiscountCents + item.unitPriceCents'],
    ['con encadenado opcional', 'subtotal + order.discount?.discountCents'],
  ])('⛔ %s inyectado ⇒ rojo', (_n, expr) => {
    const mutado = fuente.replace(
      'formatMoneyCents(item.unitPriceBeforeDiscountCents ?? item.unitPriceCents, locale)',
      `formatMoneyCents(${expr}, locale)`,
    );
    expect(mutado).not.toBe(fuente);
    expect(muerde(mutado)).toBe(true);
  });

  it('el mismo defecto en un comentario no cuenta (la regla no se castiga con su documentación)', () => {
    const mutado = fuente.replace(
      'formatMoneyCents(item.unitPriceBeforeDiscountCents ?? item.unitPriceCents, locale)',
      'formatMoneyCents(item.unitPriceBeforeDiscountCents ?? item.unitPriceCents, locale) /* antes: unitPriceCents + unitDiscountCents */',
    );
    expect(muerde(mutado)).toBe(false);
  });

  it('comparar la rebaja (`> 0`) o pasarla tal cual no es aritmética', () => {
    const mutado = fuente.replace(
      'formatMoneyCents(item.unitPriceBeforeDiscountCents ?? item.unitPriceCents, locale)',
      'formatMoneyCents((item.unitDiscountCents ?? 0) > 0 ? item.unitDiscountCents ?? 0 : 0, locale)',
    );
    expect(muerde(mutado)).toBe(false);
  });
});
