import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../../../../../messages/es.json';
import * as api from '@/lib/api';
import { M1View } from './M1View';

/**
 * qa R-2: el enlace «Abrir INV-… en Inventario» de un buscador de carta DENTRO de M1 solo cambia `?folio=`. M1 debe
 * reaccionar al CAMBIO de la URL (no solo al montar): cerrar el alta abierta y abrir el «Detalle de pieza» de ese folio.
 */
const sp = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(sp.value) }));
vi.mock('@/lib/role', () => ({ useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = () => (
  <QueryClientProvider client={client}>
    <NextIntlClientProvider locale="es" messages={es}>
      <M1View />
    </NextIntlClientProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  vi.restoreAllMocks();
  sp.value = '';
  window.history.replaceState(null, '', '/es/admin/m1');
});

describe('M1 · cambio de ?folio= con el alta abierta', () => {
  it('cierra el alta y abre el «Detalle de pieza» del folio (y llama a by-folio); también con el alta gradeada', async () => {
    const byFolio = vi.spyOn(api, 'getInventoryByFolio');
    const view = render(tree());
    fireEvent.click(await screen.findByRole('button', { name: /Alta por lote/ }));
    const search = await screen.findByPlaceholderText('Nombre, número o código impreso (PRE 078)');
    fireEvent.change(search, { target: { value: 'INV-001306' } });
    expect(await screen.findByRole('link', { name: 'Abrir INV-001306 en Inventario' })).toHaveAttribute('href', '/admin/m1?folio=INV-001306');
    expect(byFolio).not.toHaveBeenCalled();

    // El enlace navega a la MISMA página: cambia solo la URL.
    sp.value = 'folio=INV-001306';
    view.rerender(tree());
    expect(await screen.findByTestId('piece-by-folio')).toHaveTextContent('Umbreon ex');
    expect(byFolio).toHaveBeenCalledWith('INV-001306');
    expect(screen.queryByPlaceholderText('Nombre, número o código impreso (PRE 078)')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Alta por lote/ })).toBeNull());
  });

  it('llegando desde otra página (M2 estimados, proveedores) con ?folio= en la URL al montar, abre el detalle', async () => {
    sp.value = 'folio=INV-001306';
    const byFolio = vi.spyOn(api, 'getInventoryByFolio');
    render(tree());
    expect(await screen.findByTestId('piece-by-folio')).toHaveTextContent('Prismatic Evolutions (PRE)');
    expect(byFolio).toHaveBeenCalledTimes(1);
  });
});
