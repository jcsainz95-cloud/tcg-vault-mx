import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import type { UnifyRaritiesResponse } from '@/types/contract';
import { RarityHealthSection, unifyRaritiesView } from './RarityHealthSection';

/**
 * ⭐⭐ **EL CANDADO DE «Unificar rarezas»** — `DESIGN_SYSTEM §32.4`, la norma **transversal**.
 *
 * Este panel es el mismo donde nació D2, **diez líneas más allá**: el aviso de esta acción salía de
 * `mutation.isSuccess` y abría **en verde** con «Rarezas unificadas. La lista ya refleja las
 * rarezas canónicas.» aunque la corrida hubiera reescrito **0** cartas de 191 revisadas — la frase
 * exacta que el docstring de `lib/verdict.ts` cita como el defecto de origen.
 *
 * Estos tests están escritos para poder **ponerse rojo**: afirman lo que el dueño LEE (la
 * versalita, la frase, y el token de color del aviso), no un detalle interno. Si alguien vuelve a
 * derivar el tono de `isSuccess`, el caso `0 escritas` se pinta verde y esta suite cae.
 */

const HEALTH = {
  rarities: [
    { canonical: 'Common', premium: false, mapped: true, cardCount: 120 },
  ],
};

/** El desenlace que quemó al dueño, con los números que lo quemaron. */
function response(over: Partial<UnifyRaritiesResponse> = {}): UnifyRaritiesResponse {
  return {
    ok: true,
    cardsProcessed: 191,
    cardsUpdated: 34,
    distinctCanonical: 21,
    unmapped: [],
    ...over,
  };
}

/** Todos los avisos vivos de la sección (`role=status` / `role=alert`). */
function notices(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="status"],[role="alert"]'));
}

async function findNotice(re: RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const hit = notices().find((n) => re.test(n.textContent ?? ''));
    if (!hit) {
      throw new Error(
        `ningún aviso casa con ${re}. Avisos: ${notices().map((n) => n.textContent).join(' | ')}`,
      );
    }
    return hit;
  });
}

/**
 * ⭐ **La aserción del encargo**: «este aviso NO está en verde». El token de éxito de `Banner` es
 * `border-success`; `warning` y `danger` comparten bermellón y se distinguen por la PALABRA.
 */
function expectNotGreen(notice: HTMLElement) {
  expect(notice.className).not.toContain('border-success');
}

/** Lanza la acción: botón → confirmación → CTA. La confirmación es parte del candado (money-safe). */
async function runUnify() {
  fireEvent.click(await screen.findByRole('button', { name: /Unificar rarezas/ }));
  const dialog = await screen.findByRole('dialog', { name: /Unificar rarezas del catálogo/ });
  fireEvent.click(within(dialog).getByRole('button', { name: /Unificar rarezas/ }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getRarityHealth').mockResolvedValue(HEALTH);
});

describe('§32.4 · «Unificar rarezas» — el aviso no puede afirmar más de lo que pasó', () => {
  /**
   * ⭐⭐ **EL CANDADO.** `cardsUpdated: 0` sobre `cardsProcessed: 191`. Antes: verde + «Rarezas
   * unificadas. La lista ya refleja las rarezas canónicas.» Ahora: ni verde, ni esa frase.
   */
  it('⭐⭐ 0 cartas actualizadas de 191 revisadas ⇒ NI verde NI «Rarezas unificadas»', async () => {
    vi.spyOn(api, 'unifyRarities').mockResolvedValue(response({ cardsUpdated: 0 }));
    renderWithProviders(<RarityHealthSection />, 'es');
    await runUnify();

    const notice = await findNotice(/rareza/i);
    // 1) El color: el token de éxito no puede aparecer sin una cifra de ESCRITURA > 0 (H1/H2).
    expectNotGreen(notice);
    // 2) La palabra: el veredicto lo porta la versalita, y no es `HECHO`.
    expect(notice.textContent).toMatch(/SIN CAMBIOS/i);
    // ⚠ La versalita se pinta en mayúsculas por CSS: en `textContent` es «Hecho» / «Sin cambios».
    expect(notice.textContent).not.toMatch(/\bhecho\b/i);
    // 3) La frase que afirmaba el trabajo NO puede encabezar un desenlace sin escritura.
    expect(notice.textContent).not.toMatch(/La lista ya refleja las rarezas canónicas/);
    expect(notice.textContent).toMatch(/No se reescribió ninguna/);
  });

  /** Control positivo de H1: con escritura real SÍ hay verde, y con su recibo delante. */
  it('H1 (control positivo): con cartas actualizadas > 0 ⇒ HECHO, verde, y la cifra de escritura abre', async () => {
    vi.spyOn(api, 'unifyRarities').mockResolvedValue(
      response({ cardsUpdated: 3400, cardsProcessed: 12000, distinctCanonical: 21 }),
    );
    renderWithProviders(<RarityHealthSection />, 'es');
    await runUnify();

    const notice = await findNotice(/3400/);
    expect(notice.className).toContain('border-success');
    expect(notice.textContent).toMatch(/^\s*Hecho\b/);
    expect(notice.textContent).toMatch(/3400 cartas actualizadas/);
    // H3 — el contexto va DETRÁS, tras «de», y nunca solo.
    expect(notice.textContent).toMatch(/de 12000 revisadas/);
    const text = notice.textContent ?? '';
    expect(text.indexOf('3400')).toBeLessThan(text.indexOf('12000'));
  });

  /**
   * H3 · el cero de contexto **no puede abrir la frase**. `cardsProcessed` es «cartas recorridas»,
   * no trabajo: es literalmente el «191 cartas procesadas» de D2.
   */
  it('H3/H8: la frase no abre con la cifra de contexto ni dice «procesadas»', async () => {
    vi.spyOn(api, 'unifyRarities').mockResolvedValue(response({ cardsUpdated: 0 }));
    renderWithProviders(<RarityHealthSection />, 'es');
    await runUnify();

    const notice = await findNotice(/rareza/i);
    expect(notice.textContent).not.toMatch(/procesad/i);
    // La versalita es lo primero que se lee; ninguna cifra la precede.
    const text = (notice.textContent ?? '').trim();
    expect(text.indexOf('Sin cambios')).toBe(0);
    expect(text.indexOf('191')).toBeGreaterThan(text.indexOf('Sin cambios'));
  });

  /**
   * El censo recorrió cartas y **no reconoció ni una** rareza canónica: no hay nada que demuestre
   * que no hiciera falta trabajo ⇒ en la duda, `NO SE HIZO` (nunca «sin cambios», nunca verde).
   */
  it('censo sin clasificar (0 canónicas) ⇒ NO SE HIZO, en warning y con la consecuencia', async () => {
    vi.spyOn(api, 'unifyRarities').mockResolvedValue(
      response({ cardsUpdated: 0, distinctCanonical: 0 }),
    );
    renderWithProviders(<RarityHealthSection />, 'es');
    await runUnify();

    const notice = await findNotice(/rareza/i);
    expectNotGreen(notice);
    expect(notice.className).toContain('border-accent'); // warning
    expect(notice.textContent).toMatch(/NO SE HIZO/i);
    expect(notice.textContent).toMatch(/siguen como estaban/i);
    expect(notice.textContent).toMatch(/guardarraíl/i);
  });

  /** La lista de rarezas sin mapear es una lista de HECHOS: sobrevive a cualquier veredicto. */
  it('la lista de rarezas sin mapear se conserva íntegra, también sin escritura', async () => {
    vi.spyOn(api, 'unifyRarities').mockResolvedValue(
      response({ cardsUpdated: 0, unmapped: [{ raw: 'Galaxy Foil', canonical: 'Galaxy Foil', count: 40 }] }),
    );
    renderWithProviders(<RarityHealthSection />, 'es');
    await runUnify();

    const notice = await findNotice(/sin mapear/);
    expectNotGreen(notice);
    expect(within(notice).getByText('Galaxy Foil')).toBeInTheDocument();
    expect(notice.textContent).toMatch(/\(40\)/);
  });

  /** FALLÓ: el único veredicto que interrumpe (`role="alert"`), y el tono sale del veredicto. */
  it('un fallo de la llamada ⇒ FALLÓ, con `role="alert"` y sin verde', async () => {
    vi.spyOn(api, 'unifyRarities').mockRejectedValue(new Error('boom'));
    renderWithProviders(<RarityHealthSection />, 'es');
    await runUnify();

    const notice = await findNotice(/FALLÓ/i);
    expect(notice.getAttribute('role')).toBe('alert');
    expectNotGreen(notice);
  });

  /**
   * ⭐ **El candado estructural.** No basta con el caso que quemó al dueño: **ninguna** forma de
   * respuesta con `cardsUpdated: 0` puede pintar el token de éxito. La tabla recorre las que el
   * contrato permite; si alguien reintroduce el verde derivado de `isSuccess`, TODAS caen a la vez.
   */
  it('⭐ ninguna respuesta con 0 cartas actualizadas puede pintar el token de éxito', async () => {
    const cases: Partial<UnifyRaritiesResponse>[] = [
      { cardsUpdated: 0, cardsProcessed: 191, distinctCanonical: 21 },
      { cardsUpdated: 0, cardsProcessed: 0, distinctCanonical: 0 },
      { cardsUpdated: 0, cardsProcessed: 191, distinctCanonical: 0 },
      { cardsUpdated: 0, cardsProcessed: 12000, distinctCanonical: 21, unmapped: [{ raw: 'Galaxy Foil', canonical: 'Galaxy Foil', count: 40 }] },
    ];
    for (const over of cases) {
      vi.spyOn(api, 'unifyRarities').mockResolvedValue(response(over));
      renderWithProviders(<RarityHealthSection />, 'es');
      await runUnify();
      const notice = await findNotice(/rareza|carta/i);
      expectNotGreen(notice);
      // ⚠ La versalita se pinta en mayúsculas por CSS: en `textContent` es «Hecho» / «Sin cambios».
    expect(notice.textContent).not.toMatch(/\bhecho\b/i);
      cleanup();
    }
  });
});

/**
 * La función pura, sin DOM: la tabla de casos del veredicto. Vive fuera del componente para que el
 * tono **no pueda** salir del estado de la mutación (H10) — y para poder ponerla en rojo aquí.
 */
describe('unifyRaritiesView · hechos → veredicto', () => {
  it('cardsUpdated > 0 ⇒ HECHO (y sólo ahí)', () => {
    expect(unifyRaritiesView(response({ cardsUpdated: 1 })).verdict).toBe('done');
    expect(unifyRaritiesView(response({ cardsUpdated: 3400 })).phraseKey).toBe(
      'unifyRarities.result.done',
    );
  });

  it('cardsUpdated 0 sobre censo clasificado ⇒ SIN CAMBIOS (cero demostrable, ⛔ no verde)', () => {
    expect(unifyRaritiesView(response({ cardsUpdated: 0 })).verdict).toBe('noChanges');
  });

  it('cardsUpdated 0 con censo que no clasificó nada ⇒ NO SE HIZO', () => {
    expect(
      unifyRaritiesView(response({ cardsUpdated: 0, distinctCanonical: 0 })).verdict,
    ).toBe('notDone');
  });

  it('universo vacío ⇒ SIN CAMBIOS (no había nada que hacer, y se puede demostrar)', () => {
    expect(
      unifyRaritiesView(response({ cardsUpdated: 0, cardsProcessed: 0, distinctCanonical: 0 }))
        .verdict,
    ).toBe('noChanges');
  });

  it('⛔ `cardsProcessed` NO decide: 191 revisadas con 0 escritas no es HECHO', () => {
    expect(unifyRaritiesView(response({ cardsUpdated: 0, cardsProcessed: 191 })).verdict).not.toBe(
      'done',
    );
  });

  it('⛔ `unmapped` no degrada el veredicto: no es trabajo que esta corrida pudiera hacer', () => {
    const withUnmapped = response({
      cardsUpdated: 10,
      unmapped: [{ raw: 'Galaxy Foil', canonical: 'Galaxy Foil', count: 40 }],
    });
    expect(unifyRaritiesView(withUnmapped).verdict).toBe('done');
  });
});
