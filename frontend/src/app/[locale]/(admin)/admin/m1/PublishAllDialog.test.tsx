import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { PublishAllDialog } from './PublishAllDialog';
import * as api from '@/lib/api';
import type { PublishAllResponse } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function response(overrides: Partial<PublishAllResponse['summary']> = {}): PublishAllResponse {
  return {
    batchKey: 'k',
    idempotentReplay: false,
    summary: { selected: 180, published: 128, alreadyListed: 40, pendingPrice: 12, failed: 0, ...overrides },
    failures: [],
  };
}

describe('PublishAllDialog (P-19, §16.5c) · confirmación con alcance + resultado honesto', () => {
  it('confirma con alcance y notas de dinero; el POST lleva batchKey (idempotencia)', async () => {
    const spy = vi.spyOn(api, 'publishAllInventory').mockResolvedValue(response());
    renderWithProviders(
      <PublishAllDialog open onClose={() => {}} currentSet={{ id: 'base1', name: 'Base Set' }} />,
      'es',
    );

    const dialog = screen.getByRole('dialog', { name: 'Publicar todo el inventario' });
    expect(
      within(dialog).getByText('Se publicarán todas las piezas en stock que tengan precio resoluble.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Las piezas sin precio NO se publican: quedan en la cola de precios pendientes.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Expone piezas a la venta · queda en bitácora.')).toBeInTheDocument();

    // Alcance: todo (default) / solo este set / solo sellado.
    const scope = within(dialog).getByLabelText('Alcance');
    expect(within(scope).getByRole('option', { name: 'Todo el inventario' })).toBeInTheDocument();
    expect(within(scope).getByRole('option', { name: 'Solo este set (Base Set)' })).toBeInTheDocument();
    expect(within(scope).getByRole('option', { name: 'Solo sellado' })).toBeInTheDocument();

    fireEvent.change(scope, { target: { value: 'sealed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar todo' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0].productType).toBe('sealed');
    expect(spy.mock.calls[0][0].batchKey).toBeTruthy();
  });

  it('resultado HONESTO de 4 renglones; «Sin precio» > 0 enlaza a la cola M2', async () => {
    vi.spyOn(api, 'publishAllInventory').mockResolvedValue(response());
    renderWithProviders(<PublishAllDialog open onClose={() => {}} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar todo' }));

    const result = await screen.findByTestId('publish-all-result');
    // Los cuatro renglones con sus cifras (mono tabular).
    expect(within(result).getByText('Publicadas')).toBeInTheDocument();
    expect(within(result).getByText('128')).toBeInTheDocument();
    expect(within(result).getByText('Ya estaban listadas')).toBeInTheDocument();
    expect(within(result).getByText('40')).toBeInTheDocument();
    expect(within(result).getByText('Sin precio')).toBeInTheDocument();
    expect(within(result).getByText('12')).toBeInTheDocument();
    expect(within(result).getByText('Fallidas')).toBeInTheDocument();
    expect(within(result).getByText('0')).toBeInTheDocument();
    // Deep-link a la cola de pendientes (context=inventory).
    const link = within(result).getByRole('link', { name: 'Ver pendientes de precio' });
    expect(link.getAttribute('href')).toContain('/admin/m2');
    // Cierre con "Entendido" (el modal mutó a resumen).
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument();
  });

  it('replay idempotente → nota «Resultado de la corrida anterior»', async () => {
    vi.spyOn(api, 'publishAllInventory').mockResolvedValue({
      ...response(),
      idempotentReplay: true,
    });
    renderWithProviders(<PublishAllDialog open onClose={() => {}} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar todo' }));
    expect(
      await screen.findByText('Resultado de la corrida anterior (reintento idempotente).'),
    ).toBeInTheDocument();
  });

  it('fallidas > 0 → detalle por folio con causa', async () => {
    vi.spyOn(api, 'publishAllInventory').mockResolvedValue({
      ...response({ failed: 1, pendingPrice: 0 }),
      failures: [
        {
          inventoryItemId: 'inv-x',
          folio: 'INV-000999',
          error: { code: 'ITEM_NOT_PUBLISHABLE', message: 'reserved' },
        },
      ],
    });
    renderWithProviders(<PublishAllDialog open onClose={() => {}} />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar todo' }));
    expect(await screen.findByText(/INV-000999 — ITEM_NOT_PUBLISHABLE/)).toBeInTheDocument();
  });
});
