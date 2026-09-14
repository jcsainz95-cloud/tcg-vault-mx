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
  priceConvention: 'IVA_EXCLUSIVE',
  ivaIncluded: false,
};

/**
 * ⭐⭐ **EL MISMO PEDIDO, BAJO `IVA_INCLUSIVE`** (§M10-IVA.4). Las cifras salen de la aritmética
 * publicada del contrato, ⛔ no son números bonitos:
 *
 * ```
 * L = 140800, dial 100 %, r = 16 ⇒ P = round(140800 × 1.16) = 163328
 *   ivaCents  = 163328 − round(163328 / 1.16) = 163328 − 140800 = 22528   (RESIDUAL, jamás 0)
 *   totalCents = grossUpTotal(163328) = ceil((163328 + 300×1.16) / (1 − 0.036×1.16)) = 170810
 *   processingFeeCents = 170810 − 163328 = 7482
 * ```
 *
 * ⭐ **Y el IVA en pesos es EXACTAMENTE el mismo que en la versión exclusiva de arriba (`22528`)** —
 * money-neutral con el dial en 100 %: lo que cambia es **dónde** está, no cuánto es.
 */
const inclusiveBreakdown: BreakdownDTO = {
  subtotalCents: 163328,
  ivaCents: 22528,
  ivaRatePct: 16,
  processingFeeCents: 7482,
  totalCents: 170810,
  currency: 'MXN',
  priceConvention: 'IVA_INCLUSIVE',
  ivaIncluded: true,
};

describe('AmountBreakdown · §M10-IVA.4 — la forma no cambia, el SIGNIFICADO sí', () => {
  /**
   * ⭐⭐ **LA IDENTIDAD (b), QUE ES LA QUE SUSTITUYE A LA VIEJA.** Bajo `IVA_INCLUSIVE`
   * **el IVA NO es un sumando del total**: ya está dentro del subtotal.
   *
   * Se asierta sobre el **fixture**, no sobre el render, a propósito: es una propiedad del DATO, y
   * un fixture que no la cumpla enseñaría a leer mal el desglose aunque la pantalla pintara bien.
   * ⛔ **Rojo si alguien «arregla» el fixture sumando el IVA al total.**
   */
  it('(b) totalCents == subtotal + envío + comisión — el IVA NO suma', () => {
    const b = inclusiveBreakdown;
    expect(b.subtotalCents + (b.shippingFeeCents ?? 0) + b.processingFeeCents).toBe(b.totalCents);
    // (c) del contrato: el IVA es residual y ⛔ jamás 0, ni con el dial de traslación en 0 %.
    expect(b.ivaCents).toBeGreaterThan(0);
    expect(b.ivaCents).toBeLessThan(b.subtotalCents);
  });

  /** Y el contraste: la orden histórica **sí** cumple la identidad vieja, y debe seguir cumpliéndola. */
  it('la convención VIEJA conserva su identidad: total == subtotal + IVA + comisión', () => {
    const b = breakdown;
    expect(b.priceConvention).toBe('IVA_EXCLUSIVE');
    expect(b.subtotalCents + b.ivaCents + b.processingFeeCents).toBe(b.totalCents);
  });

  /**
   * ⭐ **El renglón INFORMA, y se puede comprobar sin leer una hoja de estilos**: `data-informative`
   * es la marca, y `data-price-convention` publica la convención del desglose para que un e2e no
   * tenga que adivinarla por el texto.
   *
   * ⛔ **Ni se oculta** (criterio **192**: el desglose fiscal no se vacía) **ni se convierte en
   * resta** (produciría un total que no es el que se cobra).
   */
  it('bajo IVA_INCLUSIVE el renglón se rotula «incluido» y se marca como informativo', () => {
    renderWithIntl(<AmountBreakdown breakdown={inclusiveBreakdown} />, 'es');
    const root = screen.getByTestId('amount-breakdown');
    expect(root.getAttribute('data-price-convention')).toBe('IVA_INCLUSIVE');
    expect(screen.getByText('IVA 16 % incluido')).toBeInTheDocument();
    expect(screen.queryByText('IVA 16%')).toBeNull();
    // El renglón sigue estando: se ve el importe del impuesto, no se esconde.
    expect(screen.getByText(/225\.28/)).toBeInTheDocument();
    expect(root.querySelectorAll('[data-informative="true"]')).toHaveLength(1);
  });

  /**
   * ⭐⭐ **LA MITAD QUE IMPIDE EL «AJUSTE GLOBAL»** (criterio **190**). La misma pantalla, con un
   * desglose `IVA_EXCLUSIVE`, tiene que volver al rótulo viejo y **dejar de marcar el renglón como
   * informativo**. ⛔ Rojo si alguien cablea la convención desde un dial vivo o desde una constante.
   */
  it('bajo IVA_EXCLUSIVE vuelve al rótulo viejo y el renglón NO es informativo', () => {
    renderWithIntl(<AmountBreakdown breakdown={breakdown} />, 'es');
    const root = screen.getByTestId('amount-breakdown');
    expect(root.getAttribute('data-price-convention')).toBe('IVA_EXCLUSIVE');
    expect(screen.getByText('IVA 16%')).toBeInTheDocument();
    expect(screen.queryByText('IVA 16 % incluido')).toBeNull();
    expect(root.querySelectorAll('[data-informative="true"]')).toHaveLength(0);
  });

  /**
   * ⚠️ **El hueco de contrato de `ShipmentDTO`, medido en vez de supuesto** (§5 no trae la
   * convención). Con ella ausente la pantalla **no afirma ninguna**: rótulo viejo, sin marca de
   * informativo. ⛔ **Rojo si alguien le pone un default**, en cualquiera de los dos sentidos.
   */
  it('⛔ sin convención (rastreo de retiro) la pantalla NO inventa ninguna', () => {
    const { priceConvention: _pc, ivaIncluded: _ii, ...sinConvencion } = inclusiveBreakdown;
    renderWithIntl(<AmountBreakdown breakdown={sinConvencion} variant="shipment" />, 'es');
    const root = screen.getByTestId('amount-breakdown');
    expect(root.getAttribute('data-price-convention')).toBeNull();
    expect(screen.queryByText('IVA 16 % incluido')).toBeNull();
    expect(root.querySelectorAll('[data-informative="true"]')).toHaveLength(0);
  });
});

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
