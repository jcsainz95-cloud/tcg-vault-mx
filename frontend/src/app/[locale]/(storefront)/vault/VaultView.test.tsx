import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { VaultView } from './VaultView';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Orden de los nombres de carta (cada card pinta el nombre en un <p lang="en">). */
function cardNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('p[lang="en"]')).map((e) => e.textContent ?? '');
}

describe('VaultView · orden de holdings', () => {
  it('orden por defecto respeta el orden del backend', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');
    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Latias ex',
      'Surging Sparks Booster Box',
      'Zapdos',
    ]);
  });

  it('ordena por valor descendente (pendientes al final)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'value_desc' } });

    // Latias 950000 > Booster Box 320000 > Blastoise 128000 > Zapdos (precio pendiente → al final)
    expect(cardNames(container)).toEqual([
      'Latias ex',
      'Surging Sparks Booster Box',
      'Blastoise',
      'Zapdos',
    ]);
  });

  it('ordena por valor ascendente (pendientes al final)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'value_asc' } });

    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Surging Sparks Booster Box',
      'Latias ex',
      'Zapdos', // pendiente siempre al final, aun en asc
    ]);
  });

  it('ordena por set (nombre de set, desempate por nombre de carta)', async () => {
    const { container } = renderWithProviders(<VaultView />, 'es');
    await screen.findByText('Blastoise');

    const select = screen.getByLabelText('Ordenar por') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'set' } });

    // Base Set (Blastoise, Zapdos) antes de Surging Sparks (Latias ex, Booster Box)
    expect(cardNames(container)).toEqual([
      'Blastoise',
      'Zapdos',
      'Latias ex',
      'Surging Sparks Booster Box',
    ]);
  });
});
