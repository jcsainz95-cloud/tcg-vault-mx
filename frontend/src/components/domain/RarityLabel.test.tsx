import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { RarityLabel } from './RarityLabel';

describe('RarityLabel · P-44', () => {
  it('pinta la rareza cruda (lang="en") con prefijo accesible localizado', () => {
    renderWithIntl(<RarityLabel rarity="Special Illustration Rare" />, 'es');
    const el = screen.getByText('Special Illustration Rare');
    expect(el).toHaveAttribute('lang', 'en');
    expect(el).toHaveAttribute('aria-label', 'Rareza: Special Illustration Rare');
  });

  it('NO se pinta para SELLADO (una caja/ETB no tiene rareza de carta)', () => {
    const { container } = renderWithIntl(
      <RarityLabel rarity="Rare Holo" productType="sealed" />,
      'es',
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('NO se pinta con rareza vacía/ausente (nunca inventa un valor)', () => {
    const { container } = renderWithIntl(<RarityLabel rarity="  " />, 'es');
    expect(container).toBeEmptyDOMElement();
  });
});
