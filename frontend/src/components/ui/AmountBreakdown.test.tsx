import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AmountBreakdown } from './AmountBreakdown';
import type { BreakdownDTO } from '@/types/contract';

const breakdown: BreakdownDTO = {
  subtotalCents: 140800,
  ivaCents: 22528,
  ivaRatePct: 16,
  processingFeeCents: 5192,
  totalCents: 168520,
  currency: 'MXN',
};

describe('AmountBreakdown', () => {
  it('renders subtotal, itemized IVA line, platform fee and total (ES)', () => {
    renderWithIntl(<AmountBreakdown breakdown={breakdown} />, 'es');

    // El desglose distingue las cuatro líneas del contrato (BreakdownDTO).
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('IVA 16%')).toBeInTheDocument();
    // §29 (v3.6): la línea es «Comisión de plataforma», no «Costo de procesamiento».
    expect(screen.getByText('Comisión de plataforma')).toBeInTheDocument();
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();

    // Total formateado en MXN a partir de centavos (168520 → MX$1,685.20).
    expect(screen.getByText(/1,685\.20/)).toBeInTheDocument();
  });

  /*
   * ⭐ §29 · 🔴 exposición legal — **lo que la PANTALLA DE PAGO no puede llegar a decir.**
   *
   * El candado de catálogo (`src/lib/i18n-parity.test.ts`) prohíbe la declaración de traslado en las
   * cadenas; este lo comprueba **sobre el DOM renderizado**, que es la otra mitad: el hint no se
   * pinta como texto, viaja en el `title` y en el `aria-label` de la etiqueta, así que una cadena
   * limpia mal cableada —o una frase nueva inyectada en el componente— no la vería el otro candado.
   *
   * Se afirma **por ausencia**, en las dos superficies que un cliente puede leer (la visible y la
   * accesible), y sin fijar el literal: mide qué **puede llegar a afirmar** la pantalla, no cómo
   * está redactada hoy.
   */
  it.each([
    ['es', /trasladad|traslado|procesador de pago|stripe/i],
    ['en', /passed on|payment processor|stripe|process/i],
  ])(
    'la pantalla de pago (%s) no declara ningún traslado de comisión, ni visible ni en el árbol accesible',
    (locale, prohibido) => {
      const { container } = renderWithIntl(
        <AmountBreakdown breakdown={breakdown} />,
        locale as 'es' | 'en',
      );

      expect(container.textContent ?? '').not.toMatch(prohibido);
      // El hint vive en `title` + `aria-label`: es texto de cliente aunque no se vea.
      for (const el of Array.from(container.querySelectorAll('[title], [aria-label]'))) {
        expect(el.getAttribute('title') ?? '').not.toMatch(prohibido);
        expect(el.getAttribute('aria-label') ?? '').not.toMatch(prohibido);
      }
    },
  );

  it('la línea de comisión SÍ trae su explicación cableada (el candado de ausencia no vale con un hueco)', () => {
    renderWithIntl(<AmountBreakdown breakdown={breakdown} />, 'es');
    // Sin esto, borrar el hint entero pondría verde el test de arriba sin arreglar nada.
    expect(
      screen.getByLabelText(/^Comisión de plataforma\. Nuestra comisión por operar tu compra/),
    ).toBeInTheDocument();
  });

  it('labels the subtotal line as shipping in shipment variant (EN)', () => {
    renderWithIntl(<AmountBreakdown breakdown={breakdown} variant="shipment" />, 'en');
    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('VAT 16%')).toBeInTheDocument();
  });
});
