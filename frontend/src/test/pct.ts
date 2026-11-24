import { expect } from 'vitest';

/**
 * M-9 (§REPORTES-CEO §2, m-3): ningún porcentaje de la sección de reportes con 0 o 2+ decimales. Recorre un texto y falla ante
 * «12 %», «12.34 %» o «12,5%» mal formados; acepta «12.0 %», «−3.5 %», es «12,0 %». Devuelve cuántos porcentajes revisó
 * (una prueba que no encontró ninguno no probó nada: llamar con `minCount`).
 */
export function expectOneDecimalPercents(text: string, minCount = 1): number {
  const found = [...text.matchAll(/(\d[\d.,]*)\s?%/g)];
  for (const m of found) {
    const num = m[1];
    const dec = /[.,]\d+$/.test(num) ? num.split(/[.,]/).pop()!.length : 0;
    // «1,234.5» (miles + un decimal) y «1.234,5»: solo importa el último grupo, que debe ser de 1 dígito.
    expect(dec, `«${m[0]}» debe llevar UN decimal fijo`).toBe(1);
  }
  expect(found.length).toBeGreaterThanOrEqual(minCount);
  return found.length;
}
