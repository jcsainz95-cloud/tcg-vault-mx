import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SealedPhoto } from './SealedPhoto';

// Proporciones reales de sellados: 1000×953, 682×1000, 1000×525. La caja NO debe fijar 5:7 ni recortar.
describe.each(['/a-1000x953.png', '/b-682x1000.png', '/c-1000x525.png'])('SealedPhoto %s', (src) => {
  it('tarjeta blanca con marco, sin caja 5:7, sin recorte y sin agrandar', () => {
    render(<SealedPhoto src={src} alt="Booster Box" />);
    const card = screen.getByTestId('sealed-photo');
    expect(card.className).not.toMatch(/aspect-\[5\/7\]/);
    expect(card.className).not.toMatch(/(^|\s)h-full(\s|$)/);
    expect(card.className).toMatch(/border/);
    expect(card.className).toMatch(/bg-photo-mat/);
    expect(card.className).toMatch(/\bp-8\b/);
    const img = screen.getByAltText('Booster Box');
    expect(img.className).toMatch(/object-contain/);
    expect(img.className).toMatch(/\bw-auto\b/);
    expect(img.className).toMatch(/max-w-full/);
    expect(img.className).not.toMatch(/(^|\s)w-full(\s|$)/);
  });
});

describe('SealedPhoto · sin foto o rota', () => {
  it('sin src deja la tarjeta sin imagen', () => {
    render(<SealedPhoto src={null} alt="x" />);
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('si la foto falla no deja imagen rota', () => {
    render(<SealedPhoto src="/rota.png" alt="x" />);
    fireEvent.error(screen.getByAltText('x'));
    expect(screen.queryByAltText('x')).toBeNull();
  });
});
