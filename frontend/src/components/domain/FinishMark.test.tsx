import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { FinishMark, FinishBand } from './FinishMark';

describe('FinishMark (§16.6) · doble canal: banda decorativa + etiqueta SIEMPRE visible', () => {
  it('reverse_holo: banda SÓLIDA ROJA (aria-hidden) + etiqueta mono "Reverse"', () => {
    renderWithIntl(<FinishMark finish="reverse_holo" />, 'es');

    const band = screen.getByTestId('finish-band');
    expect(band).toHaveAttribute('aria-hidden', 'true'); // decorativa: el texto porta
    expect(band).toHaveAttribute('data-finish', 'reverse_holo');
    // Spec humano: ROJO sólido y estable (no gradiente). Token vivo con fallback (SB-D8).
    expect(band.getAttribute('style')).toContain('var(--color-finish-reverse');
    expect(band.getAttribute('style')).not.toContain('gradient');

    // Etiqueta del hobby (no se traduce por locale) + nombre legible como canal accesible.
    const label = screen.getByText('Reverse');
    expect(label).toHaveAttribute('aria-label', 'Reverse Holo');
  });

  it('holofoil: banda SÓLIDA AZUL (token vivo + fallback, SB-D8) + etiqueta "Holo"', () => {
    renderWithIntl(<FinishMark finish="holofoil" />, 'es');
    const band = screen.getByTestId('finish-band');
    // Spec humano: AZUL (token nuevo --color-finish-holo) con fallback al hex del DS.
    expect(band.getAttribute('style')).toContain('var(--color-finish-holo');
    expect(band.getAttribute('style')).not.toContain('gradient');
    expect(screen.getByText('Holo')).toBeInTheDocument();
  });

  it('normal: SIN banda (conserva el borde base) pero la etiqueta sigue presente', () => {
    renderWithIntl(<FinishMark finish="normal" />, 'es');
    expect(screen.queryByTestId('finish-band')).not.toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('nunca banda sin texto: FinishBand suelto existe, pero FinishMark siempre etiqueta', () => {
    renderWithIntl(
      <>
        <FinishBand finish="first_edition_holofoil" />
        <FinishMark finish="first_edition_holofoil" band={false} />
      </>,
      'es',
    );
    expect(screen.getByText('1ed Holo')).toBeInTheDocument();
  });
});
