import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { IvaLabel } from './IvaLabel';

/**
 * ⭐⭐ **EL PUNTO ÚNICO QUE ROTULA LA CONVENCIÓN DE IVA DE UN PRECIO** (§M10-IVA.3/.4).
 *
 * Este fichero es el candado de los criterios **195** y **208** *«cero afirmaciones jurídicas»* en su
 * forma más barata: como **todas** las superficies de venta cuelgan de este componente, una sola
 * medición por ausencia vale para todas ellas.
 */
describe('IvaLabel · el rótulo lo dice el DATO, no la pantalla', () => {
  /**
   * ⭐ **Criterio 977 (dueño 2026-11-03, «quitar "IVA 16 % incluido"»):** el PRECIO con el IVA dentro ya no lleva
   * rótulo, en ES ni en EN. Antes este caso pintaba «IVA 16 % incluido» / «16 % VAT included». Por AUSENCIA.
   */
  it('977 · `ivaIncluded: true` (precio) ⇒ SIN rótulo, en ES y EN', () => {
    for (const locale of ['es', 'en'] as const) {
      const { container, unmount } = renderWithIntl(<IvaLabel ivaIncluded ivaRatePct={16} />, locale);
      expect(screen.queryByTestId('iva-label')).toBeNull();
      expect(container.textContent).toBe('');
      unmount();
    }
  });

  /**
   * ⭐ **Criterio 190 — un precio `IVA_EXCLUSIVE` ⛔ NO se reinterpreta solo.** Es la mitad que se
   * olvida: encender la convención no puede cambiar cómo se lee una orden que ya se cobró.
   */
  it('`ivaIncluded: false` ⇒ sigue diciendo «sin IVA», para siempre', () => {
    renderWithIntl(<IvaLabel ivaIncluded={false} ivaRatePct={16} />, 'es');
    const el = screen.getByTestId('iva-label');
    expect(el).toHaveTextContent('sin IVA');
    expect(el.getAttribute('data-iva-included')).toBe('false');
  });

  /**
   * ⭐⭐ **LA REGLA QUE MÁS FÁCIL SE PIERDE EN UN REFACTOR: NO HAY DEFAULT.**
   *
   * Un `ivaIncluded = true` por omisión rotularía «IVA incluido» sobre cifras que no lo llevan —la
   * mentira exacta que §M10-IVA existe para evitar— y un `false` por omisión haría lo simétrico en
   * cuanto se encienda la convención. Con la convención ausente **no se pinta nada**.
   *
   * ⛔ **Rojo en cuanto alguien escriba `ivaIncluded = false` en la firma.** *Un rótulo de impuesto
   * adivinado es peor que ningún rótulo: se lee como un hecho.*
   */
  it('⛔ sin convención NO pinta rótulo — ni «incluido» ni «sin IVA»', () => {
    const { container } = renderWithIntl(<IvaLabel ivaRatePct={16} />, 'es');
    expect(screen.queryByTestId('iva-label')).toBeNull();
    expect(container.textContent).toBe('');
  });

  /**
   * ⭐ **Criterios 195 y 208, POR AUSENCIA y en los dos idiomas** (`DESIGN_SYSTEM §7.12a`): el único
   * rótulo admitido es **de importe**. ⛔ Ni «trasladado», ni «conforme a la ley», ni «no es un
   * recargo», ni «por disposición fiscal», ni cita de norma — **tampoco en negativo**.
   *
   * Se mide sobre el **DOM renderizado** y también sobre el árbol accesible, que es texto de cliente
   * aunque no se vea. **Hoy no hay abogado en el proyecto**: la única postura segura es no tener
   * ninguna.
   */
  it.each([
    ['es', /trasladad|traslado|conforme a la ley|disposici[óo]n fiscal|no es un recargo|art[íi]culo|LIVA|SAT/i],
    ['en', /passed on|pursuant to|by law|not a surcharge|tax authority|statute/i],
  ])('(%s) ⛔ cero afirmaciones jurídicas, en ninguna de las dos convenciones', (locale, prohibido) => {
    for (const incluido of [true, false]) {
      const { container, unmount } = renderWithIntl(
        <IvaLabel ivaIncluded={incluido} ivaRatePct={16} />,
        locale as 'es' | 'en',
      );
      expect(container.textContent ?? '').not.toMatch(prohibido);
      for (const el of Array.from(container.querySelectorAll('[title], [aria-label]'))) {
        expect(el.getAttribute('title') ?? '').not.toMatch(prohibido);
        expect(el.getAttribute('aria-label') ?? '').not.toMatch(prohibido);
      }
      unmount();
    }
  });

  /**
   * ⛔⛔ **CRITERIO 209 — el dial de traslación NO viaja a superficie de cliente.**
   *
   * Este componente recibe la **TASA** (`ivaRatePct`), que sí es pública. La comprobación que
   * importa es que la tasa **no se confunda con la fracción absorbida**: con el dial en cualquier
   * posición el rótulo dice **16 %**, porque el IVA registrado no se mueve — lo que se mueve es
   * nuestro neto. *Un rótulo que cambiara con el dial publicaría qué fracción absorbemos.*
   */
  it('⛔ ningún rótulo pinta la tasa (ni el dial): precio sin rótulo, mercado sin tasa', () => {
    for (const rate of [0, 16, 50]) {
      for (const showRate of [true, false]) {
        const { container, unmount } = renderWithIntl(<IvaLabel ivaIncluded ivaRatePct={rate} showRate={showRate} />, 'es');
        expect(container.textContent ?? '').not.toMatch(/%|\d/);
        unmount();
      }
    }
  });

  /**
   * ⭐ **MIV-UX-7 (vMIV-2, §MIV.10.3) — la variante SIN tasa del MERCADO: «incluye IVA».**
   *
   * `showRate={false}` hace que la rama inclusiva diga «incluye IVA» / «VAT included» (`common.ivaIncludedBare`),
   * SIN la tasa — es el rótulo del **valor de mercado**. ⛔ `showRate` SOLO afecta la rama inclusiva: con
   * `ivaIncluded={false}` sigue siendo «sin IVA» (criterio 190) y con la convención ausente no pinta nada. Y el
   * **precio** (sin la prop, o `showRate` por defecto) sigue «IVA 16 % incluido»: su tasa no desaparece.
   */
  it('`showRate={false}` ⇒ «incluye IVA» / «VAT included», SIN tasa; el precio, sin rótulo (977)', () => {
    const { unmount } = renderWithIntl(<IvaLabel ivaIncluded showRate={false} />, 'es');
    const es = screen.getByTestId('iva-label');
    expect(es).toHaveTextContent('incluye IVA');
    expect(es.textContent).not.toMatch(/%|16/);
    unmount();

    const { unmount: u2 } = renderWithIntl(<IvaLabel ivaIncluded showRate={false} />, 'en');
    const en = screen.getByTestId('iva-label');
    expect(en).toHaveTextContent('VAT included');
    expect(en.textContent).not.toMatch(/%|16/);
    u2();

    // ⛔ `showRate={false}` NO toca la rama «sin IVA» (es el corazón de §M10-IVA).
    const { unmount: u3 } = renderWithIntl(<IvaLabel ivaIncluded={false} showRate={false} />, 'es');
    expect(screen.getByTestId('iva-label')).toHaveTextContent('sin IVA');
    u3();

    // El PRECIO (default `showRate`) ya no lleva rótulo (977): el mercado conserva el suyo (P-CTA-5(b)).
    renderWithIntl(<IvaLabel ivaIncluded ivaRatePct={16} />, 'es');
    expect(screen.queryByTestId('iva-label')).toBeNull();
  });
});
