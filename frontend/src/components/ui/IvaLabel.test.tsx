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
  it('`ivaIncluded: true` ⇒ rótulo de IMPORTE con la tasa, en ES y EN', () => {
    const { unmount } = renderWithIntl(<IvaLabel ivaIncluded ivaRatePct={16} />, 'es');
    expect(screen.getByTestId('iva-label')).toHaveTextContent('IVA 16 % incluido');
    unmount();
    renderWithIntl(<IvaLabel ivaIncluded ivaRatePct={16} />, 'en');
    expect(screen.getByTestId('iva-label')).toHaveTextContent('16 % VAT included');
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
  it('⛔ el rótulo dice la TASA, y la tasa no se mueve con el dial', () => {
    renderWithIntl(<IvaLabel ivaIncluded ivaRatePct={16} />, 'es');
    expect(screen.getByTestId('iva-label').textContent).toBe('IVA 16 % incluido');
  });
});
