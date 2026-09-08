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

/**
 * DESIGN_SYSTEM §23.1d — `expirada` es el ÚNICO enum del sistema cuyo color y cuya versalita NO
 * los decide el `status` sino un segundo campo (`expiredReason`), porque sus dos causas afirman
 * cosas OPUESTAS: `not_shipped` dice que el vendedor no envió; `no_offer` dice que NOSOTROS no
 * ofertamos. Pintarlas igual —o las dos en rojo— acusaría de incumplimiento a alguien a quien
 * nunca le ofertamos.
 */
describe('StatusBadge · `expirada` se pinta por su MOTIVO (§23.1d)', () => {
  it('`no_offer` dice «No procedió» y NO usa el token acusatorio', () => {
    renderWithIntl(
      <StatusBadge domain="sellRequest" value="expirada" reason="no_offer" />,
      'es',
    );
    const badge = screen.getByText('No procedió');
    expect(badge).toBeInTheDocument();
    // neutral, no `danger`: la causa es NUESTRA (§23.1d prohíbe pintarlo en accent/danger).
    expect(badge.className).toContain('text-muted');
    expect(badge.className).not.toContain('text-accent');
  });

  it('`not_shipped` dice «Sin envío» y sí es el token de alarma', () => {
    renderWithIntl(
      <StatusBadge domain="sellRequest" value="expirada" reason="not_shipped" />,
      'es',
    );
    const badge = screen.getByText('Sin envío');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-accent');
  });

  it('sin motivo (legacy o `null`) cae al fallback NEUTRO, nunca al acusatorio', () => {
    renderWithIntl(<StatusBadge domain="sellRequest" value="expirada" reason={null} />, 'es');
    const badge = screen.getByText('Expirada');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-muted');
  });

  it('los tres estados vivos del ciclo tienen rótulo en EN (paridad de catálogo)', () => {
    renderWithIntl(<StatusBadge domain="sellRequest" value="en_transito" />, 'en');
    expect(screen.getByText('In transit')).toBeInTheDocument();
  });
});
