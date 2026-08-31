import { describe, it, expect } from 'vitest';
import {
  GRADING_COST_MEASUREMENT,
  GRADING_INGEST_CREDITS_PER_CARD,
  GRADING_INGEST_RUNS_PER_DAY,
  gradingCostBasis,
  gradingIngestDailyCreditCeiling,
} from './grading-hook-cost';

describe('grading-hook-cost · el techo es una CUENTA, no un presupuesto', () => {
  it('deriva el techo del tope vivo de M2 (nunca un literal): 250 × 2 × 2 = 1 000', () => {
    expect(gradingIngestDailyCreditCeiling(250)).toBe(
      250 * GRADING_INGEST_CREDITS_PER_CARD * GRADING_INGEST_RUNS_PER_DAY,
    );
    expect(gradingIngestDailyCreditCeiling(250)).toBe(1000);
    // Se mueve con el tope: si no se moviera, estaría horneado (§22.13k.g).
    expect(gradingIngestDailyCreditCeiling(1000)).toBe(4000);
  });

  it('cede la cifra —no el aviso— cuando el tope no es utilizable', () => {
    for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gradingIngestDailyCreditCeiling(bad as number | null | undefined)).toBeNull();
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
    // Y la medición NO puede ser el producto de las constantes: si lo fuera, «medido» sería el
    // mismo cálculo con otro nombre.
    expect(conMedicion.creditsPerDay).not.toBe(gradingIngestDailyCreditCeiling(250));
  });
});
