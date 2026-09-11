import { describe, it, expect } from 'vitest';
import {
  computeVerdict,
  formatFigure,
  verdictRole,
  verdictTone,
  type VerdictFacts,
} from './verdict';

/**
 * `DESIGN_SYSTEM §32.4` — la norma de honestidad del aviso de resultado, medida sobre la función
 * que la implementa. Estos casos son **el candado del algoritmo**; los de la pantalla
 * (`CatalogSyncSection.test.tsx`) son el candado de lo que el dueño LEE.
 *
 * ⚠ Ningún caso de aquí menciona `isSuccess`, ni un status HTTP, ni un `ok`. Es a propósito: si
 * el veredicto pudiera depender de algo de eso, tendría que aparecer en `VerdictFacts`, y no está.
 */

const facts = (over: Partial<VerdictFacts> = {}): VerdictFacts => ({
  nothingRan: false,
  writes: [],
  failedOrPending: false,
  hadWork: true,
  ...over,
});

describe('§32.4a · el algoritmo del veredicto', () => {
  it('1 — ninguna fase corrió ⇒ FALLÓ (y manda sobre todo lo demás)', () => {
    expect(computeVerdict(facts({ nothingRan: true, writes: [7], failedOrPending: false }))).toBe('failed');
  });

  it('2 — una cifra DESCONOCIDA con algo medido > 0 ⇒ PARCIAL', () => {
    expect(computeVerdict(facts({ writes: [12, null] }))).toBe('partial');
  });

  it('2 — una cifra DESCONOCIDA sin nada medido ⇒ NO SE SABE', () => {
    expect(computeVerdict(facts({ writes: [0, null] }))).toBe('unknown');
  });

  /**
   * ⭐ **El orden es la norma, no un detalle de implementación.** El paso 2 va ANTES del 4 para
   * que «no lo medí» no se colapse con «fue cero» — que es exactamente D2. Si alguien invierte
   * los pasos, este caso deja de dar `NO SE SABE` y pasa a dar `NO SE HIZO`: dos afirmaciones
   * distintas sobre el mismo hecho, y una de ellas falsa.
   */
  it('⭐ 2 antes que 4 — `null` junto a ceros NO se lee como «todo cero»', () => {
    expect(computeVerdict(facts({ writes: [0, 0, null], hadWork: true }))).toBe('unknown');
    // …mientras que el MISMO caso con la cifra medida en 0 sí es «no se hizo».
    expect(computeVerdict(facts({ writes: [0, 0, 0], hadWork: true }))).toBe('notDone');
  });

  it('3 — algo falló o quedó pendiente ⇒ PARCIAL, aunque se haya escrito', () => {
    expect(computeVerdict(facts({ writes: [10, 3], failedOrPending: true }))).toBe('partial');
  });

  it('4a — todo cero HABIENDO trabajo ⇒ NO SE HIZO (⭐ el caso de D2)', () => {
    expect(computeVerdict(facts({ writes: [0, 0], hadWork: true }))).toBe('notDone');
  });

  it('4b — todo cero y NO había nada que hacer (demostrable) ⇒ SIN CAMBIOS', () => {
    expect(computeVerdict(facts({ writes: [0], hadWork: false }))).toBe('noChanges');
  });

  it('5 — con al menos una cifra > 0 y nada pendiente ⇒ HECHO', () => {
    expect(computeVerdict(facts({ writes: [0, 5] }))).toBe('done');
  });

  /**
   * H1 — **el verde exige escritura**. Terminar sin excepción no es trabajo hecho: una corrida
   * que no midió NI UNA cifra no puede decir `HECHO`, por muy bien que haya terminado.
   */
  it('H1 — sin ninguna cifra medida NO hay verde: es NO SE SABE', () => {
    expect(computeVerdict(facts({ writes: [] }))).toBe('unknown');
  });
});

describe('§32.4 · tono y semántica accesible', () => {
  /** H2 — el cero escrito NUNCA es verde. Ni con un adverbio amable al lado. */
  it('⭐ H2 — sólo UN veredicto usa el token de éxito', () => {
    const green = (['done', 'noChanges', 'partial', 'notDone', 'failed', 'unknown'] as const).filter(
      (v) => verdictTone(v) === 'success',
    );
    expect(green).toEqual(['done']);
  });

  it('§32.4a — `NO SE HIZO` y `PARCIAL` son warning; `FALLÓ` es danger; los neutros son info', () => {
    expect(verdictTone('notDone')).toBe('warning');
    expect(verdictTone('partial')).toBe('warning');
    expect(verdictTone('failed')).toBe('danger');
    expect(verdictTone('noChanges')).toBe('info');
    expect(verdictTone('unknown')).toBe('info');
  });

  it('§32.10 — sólo `FALLÓ` interrumpe con role="alert"', () => {
    expect(verdictRole('failed')).toBe('alert');
    expect(verdictRole('notDone')).toBe('status');
    expect(verdictRole('done')).toBe('status');
  });
});

describe('§32.4 H4 · lo desconocido es «—»', () => {
  it('`null` y `undefined` se pintan «—»; el cero MEDIDO se pinta 0', () => {
    expect(formatFigure(null)).toBe('—');
    expect(formatFigure(undefined)).toBe('—');
    expect(formatFigure(0)).toBe('0');
    expect(formatFigure(191)).toBe('191');
  });
});
