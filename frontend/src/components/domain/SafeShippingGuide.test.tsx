import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { SafeShippingGuide } from './SafeShippingGuide';

/**
 * DESIGN_SYSTEM §7.13 (reescrita v2.3.2) · §23.14.1 · §23.14.6-4.
 *
 * ⚠ POR QUÉ ESTE ARCHIVO EXISTE. El `step4Body` viejo decía «Asegura por el valor cotizado»
 * cuando bajo D16/D31 la etiqueta la ponemos nosotros: quien obedecía ese paso PAGABA DOS
 * VECES. Era la única línea del producto que le costaba dinero real a quien la seguía. Estos
 * tests son el candado para que no vuelva — ni por «consistencia», ni por copiar el texto de
 * un correo viejo, ni por deshacer un merge.
 *
 * El segundo candado es simétrico: los pasos 1 y 2 NO se tocan porque AC 34 exige las palabras
 * funda/sleeve y top loader. Reescribirlos «por consistencia» rompería un criterio de
 * aceptación, así que también se fijan aquí (§23.14.5).
 */
describe('SafeShippingGuide · el paso 4 bajo D16/D31 (§23.14.1)', () => {
  const CASES = [
    {
      locale: 'es' as const,
      texts: {
        step4Title: 'La guía la ponemos nosotros',
        step4Body:
          'Al aceptar la oferta te mandamos la guía y su costo se descuenta de tu pago. Tú no compras ni aseguras nada, y no mandas el paquete hasta tenerla.',
        sleeve: 'Funda blanda',
        topLoader: 'Top loader rígido',
        nm: /Near Mint/,
        forbidden: /asegura por|asegura tu|compra (?:la|una) gu[íi]a|paga(?:s)? el env[íi]o/i,
      },
    },
    {
      locale: 'en' as const,
      texts: {
        step4Title: 'We provide the label',
        step4Body:
          "When you accept the offer we send you the label and its cost is deducted from your payment. You buy and insure nothing, and you don't ship until you have it.",
        sleeve: 'Soft sleeve',
        topLoader: 'Rigid top loader',
        nm: /Near Mint/,
        forbidden: /insure (?:for|your|it)|buy (?:a|the) label|you pay (?:for )?shipping/i,
      },
    },
  ];

  for (const { locale, texts } of CASES) {
    describe(locale, () => {
      it('el paso 4 dice QUIÉN pone la etiqueta, QUE se descuenta y las tres prohibiciones', () => {
        renderWithIntl(<SafeShippingGuide />, locale);
        // El título nombra al responsable: en una retícula de cuatro columnas es lo único
        // que se lee si el vendedor va rápido, así que el arreglo no puede vivir solo en el cuerpo.
        expect(screen.getByText(texts.step4Title)).toBeInTheDocument();
        // §23.14.3 «la cadena que viaja sola»: el ofrecimiento y la RESTA van en la misma
        // cadena. Este componente se pinta en un modal sin dinero al lado y PROJECT §H lo
        // repite dentro de dos correos, así que la resta no se puede delegar a otra superficie.
        expect(screen.getByText(texts.step4Body)).toBeInTheDocument();
      });

      it('NUNCA le dice al vendedor que compre, asegure o pague el envío hacia nosotros', () => {
        const { container } = renderWithIntl(<SafeShippingGuide />, locale);
        expect(container.textContent).not.toMatch(texts.forbidden);
      });

      it('D43: ningún paso lleva monto, rango ni porcentaje de envío', () => {
        const { container } = renderWithIntl(<SafeShippingGuide />, locale);
        // Los numerales 01–04 de la retícula son `aria-hidden` decorativos; se descuentan.
        const prose = Array.from(container.querySelectorAll('p'))
          .map((n) => n.textContent ?? '')
          .join(' ');
        expect(prose).not.toMatch(/MX\$|\$\s?\d|\d+\s?%|gratis|free shipping/i);
      });

      it('AC 34 intacto: siguen diciéndose funda/sleeve y top loader, y el intro lleva la política NM', () => {
        renderWithIntl(<SafeShippingGuide />, locale);
        expect(screen.getByText(texts.sleeve)).toBeInTheDocument();
        expect(screen.getByText(texts.topLoader)).toBeInTheDocument();
        // El modal TAPA el bloque NM-only de la página: por eso la política viaja en el intro
        // y AC 34 se cumple en toda instancia del componente, no solo en la sección inline.
        expect(screen.getByText(texts.nm)).toBeInTheDocument();
      });
    });
  }

  it('el número de solicitud sobrevive al paso 4 viejo: se hereda en el paso 3 (empaque)', () => {
    // Información útil de recepción que no tenía por qué morir con el trato viejo (§23.14.1).
    renderWithIntl(<SafeShippingGuide />, 'es');
    expect(screen.getByText(/una hoja con tu número de solicitud/)).toBeInTheDocument();
  });

  it('los cuatro pasos son una lista ordenada con el numeral decorativo fuera del árbol a11y', () => {
    const { container } = renderWithIntl(<SafeShippingGuide />, 'es');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
  });

  it('el paso 4 NO se trunca: sin line-clamp ni altura fija (es el cuerpo más largo, §7.13)', () => {
    const { container } = renderWithIntl(<SafeShippingGuide columns={4} />, 'es');
    expect(container.innerHTML).not.toMatch(/line-clamp|truncate|max-h-|\bh-\[/);
  });
});
