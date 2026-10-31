import { describe, it, expect } from 'vitest';
import {
  GRADING_COST_MEASUREMENT,
  gradingCostBasis,
  gradingDailyCreditCap,
} from './grading-hook-cost';

/**
 * v1.113⟨portada⟩ (§DYN.3/§DYN.4.3): el techo de gasto PSA es el tope diario VIVO de M10, no un producto de constantes
 * con el tope de cartas por corrida (retirado).
 */
describe('grading-hook-cost · el techo es el tope diario de M10 (§DYN.3)', () => {
  it('devuelve el tope vivo tal cual (nunca un literal) y se mueve con él', () => {
    expect(gradingDailyCreditCap(3000)).toBe(3000);
    expect(gradingDailyCreditCap(1200)).toBe(1200);
    // 0 es un valor válido del dial: «no se pide nada».
    expect(gradingDailyCreditCap(0)).toBe(0);
  });

  it('cede la cifra —no el aviso— cuando el tope no es utilizable', () => {
    for (const bad of [undefined, null, -1, 20_001, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gradingDailyCreditCap(bad as number | null | undefined)).toBeNull();
    }
  });
});

/**
 * §22.13(d.1)/(h) — `onMeasured` está **previsto y dormido**. Su fuente (la línea
 * `[VEREDICTO-PSA] COSTE MEDIDO:` de la sonda, transcrita a `DEVOPS_NOTES.md`) **no viaja en ningún
 * DTO**, así que la pantalla no puede verificarla. Rellenarla desde un `.env`, un literal o una
 * constante «temporal» sería afirmar «medido» sobre algo que nadie midió — el defecto original con
 * una palabra peor encima.
 *
 * Este test es el candado de esa prohibición: si alguien hornea una medición, se pone rojo aquí y
 * no en la pantalla de consentimiento del dueño.
 */
describe('grading-hook-cost · el selector `costBasis` (§22.13d.1)', () => {
  it('hoy devuelve SIEMPRE `estimated`: no hay coste medido en ningún canal del contrato', () => {
    expect(gradingCostBasis()).toBe('estimated');
    expect(GRADING_COST_MEASUREMENT).toBeNull();
  });

  it('`measured` exige cifra Y fecha: el tipo no deja declararlo medido sin medición', () => {
    // El día que el contrato exponga coste medido, encenderlo es rellenar ESTA constante — y el
    // tipo obliga a traer las dos cosas. `gradingCostBasis()` se deriva, no se escribe a mano.
    const conMedicion = { creditsPerDay: 3720, measuredOn: '2026-09-01' } as const;
    expect(conMedicion.creditsPerDay).toBeGreaterThan(0);
    expect(conMedicion.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Y la medición NO puede ser el tope: si lo fuera, «medido» sería el dial con otro nombre.
    expect(conMedicion.creditsPerDay).not.toBe(gradingDailyCreditCap(3000));
  });
});
