import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge (enum → texto localizado)', () => {
  it('translates ownership.settled to Spanish by default', () => {
    renderWithIntl(<StatusBadge domain="ownership" value="settled" />, 'es');
    expect(screen.getByText('Liquidada')).toBeInTheDocument();
  });

  it('translates the same enum to English when locale switches', () => {
    renderWithIntl(<StatusBadge domain="ownership" value="settled" />, 'en');
    expect(screen.getByText('Settled')).toBeInTheDocument();
  });

  it('renders a pending price badge with warning copy', () => {
    renderWithIntl(<StatusBadge domain="price" value="pending" />, 'es');
    expect(screen.getByText('Precio pendiente')).toBeInTheDocument();
  });
});
