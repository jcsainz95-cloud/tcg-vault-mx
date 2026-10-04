import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import { ShippingSection, tierErrors } from './ShippingSection';

/** UX-SDX-17 (`DESIGN_SYSTEM §43.15`) y la forma de §43.10 contra el contrato `§M4-SHIP.19.19.12`. */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, shippingProvider: 'skydropx', shippingLabelPurchase: 'super_admin_only' });
  vi.spyOn(api, 'getShippingBalance').mockResolvedValue({ balanceCents: 96516, currency: 'MXN', lowBalance: false, thresholdCents: 50000, fetchedAt: '2026-10-04T16:00:00Z' });
  vi.spyOn(api, 'getShippingCatalogs').mockResolvedValue({
    packagings: [{ code: '4G', name: 'Caja de cartón' }],
    consignmentNote: { code: '49101600', description: 'Coleccionables' },
    addressTemplates: [{ id: 'tpl', alias: 'Verapaz', addressType: 'from', isDefault: true, postalCode: '14210' }],
  });
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue([]);
});

describe('UX-SDX-17 · la puerta de compra y los escalones', () => {
  it('pasar a «También los operadores» abre el diálogo y NO manda PUT hasta confirmar', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const group = await screen.findByTestId('shipping-purchase');
    fireEvent.click(within(group).getByRole('radio', { name: /También los operadores/ }));
    const dialog = await screen.findByRole('dialog', { name: '¿Dejar que los operadores compren guías?' });
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, dejar que compren' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ shippingLabelPurchase: 'operators' }));
  });
  it('bajar a «Nadie» no pregunta', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    fireEvent.click(within(await screen.findByTestId('shipping-purchase')).getByRole('radio', { name: /Nadie/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ shippingLabelPurchase: 'disabled' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('escalones no crecientes ⇒ error bajo la fila y CERO PUT', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const row1 = await screen.findByTestId('tier-row-1');
    fireEvent.change(within(row1).getByLabelText('Cubre hasta'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar envíos' }));
    expect(await within(row1).findByText('Cada escalón debe cubrir más que el anterior.')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });
  it('con todo válido, «Guardar envíos» manda los diales en centavos', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    await screen.findByTestId('tier-row-0');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar envíos' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toMatchObject({
      shippingInsuranceTiers: [
        { coverageCents: 250000, costCents: 2500, measuredAt: '2026-10-04' },
        { coverageCents: 1000000, costCents: 17000, measuredAt: '2026-10-04' },
      ],
      shippingConsignmentNote: '49101600',
      shippingPreferredCarriers: ['ninetynineminutes'],
    });
    expect(screen.getByText('Hasta MX$2,500.00 → seguro de MX$2,500.00 por MX$25.00')).toBeInTheDocument();
    expect(screen.getByText('Más de MX$10,000.00 → sin seguro configurado: guía a mano')).toBeInTheDocument();
  });
  it('sin los diales en el DTO (servidor anterior a la fase D) lo dice y no pinta valores', async () => {
    const { shippingProvider: _p, ...older } = mockSettings;
    vi.spyOn(api, 'getSettings').mockResolvedValue(older);
    renderWithProviders(<ShippingSection />, 'es');
    expect(await screen.findByText('Este servidor todavía no trae los ajustes de envío.')).toBeInTheDocument();
    expect(screen.queryByTestId('shipping-purchase')).not.toBeInTheDocument();
  });
});

describe('§19.22.3 · Carta Porte y empaques con las formas del contrato v1.80.12.2', () => {
  it('la búsqueda lee `{ consignmentNotes, hasMore }` y con `hasMore` pide afinar', async () => {
    const search = vi.spyOn(api, 'searchConsignmentNotes').mockResolvedValue({
      consignmentNotes: [{ code: '55101500', description: 'Publicaciones impresas' }],
      hasMore: true,
    });
    renderWithProviders(<ShippingSection />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar otro código por descripción' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'publica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(search).toHaveBeenCalledWith('publica'));
    expect(await within(screen.getByTestId('consignment-results')).findByText('55101500: Publicaciones impresas')).toBeInTheDocument();
    expect(screen.getByText('Hay más resultados: afina la descripción.')).toBeInTheDocument();
  });
  it('`400 {field:description}` ⇒ el texto de 3 a 60 caracteres', async () => {
    vi.spyOn(api, 'searchConsignmentNotes').mockRejectedValue(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'description' } }));
    renderWithProviders(<ShippingSection />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar otro código por descripción' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Escribe de 3 a 60 caracteres para buscar.')).toBeInTheDocument();
  });
  it('`PUT …/packages` ⇒ `400 {reason:no_active_package}` ⇒ «Debe quedar al menos un empaque activo…»', async () => {
    vi.spyOn(api, 'listShippingPackages').mockResolvedValue([
      { code: 'envelope', label: 'Sobre', lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, providerPackageType: '5H4', active: true, sortOrder: 1 },
    ]);
    const put = vi.spyOn(api, 'putShippingPackages').mockRejectedValue(
      new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'packages', reason: 'no_active_package' } }),
    );
    renderWithProviders(<ShippingSection />, 'es');
    const row = await screen.findByTestId('package-row-envelope');
    fireEvent.click(within(row).getByRole('checkbox', { name: 'Activo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar empaques' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Debe quedar al menos un empaque activo con código de Skydropx.')).toBeInTheDocument();
  });
});

describe('tierErrors (función pura)', () => {
  it('mínimo, creciente, costo y fecha', () => {
    expect(tierErrors([{ coverage: '0.5', cost: '-1', measuredAt: '' }])).toEqual({ 0: { coverage: 'coverageMin', cost: 'costNegative', measuredAt: 'dateMissing' } });
    expect(tierErrors([{ coverage: '100', cost: '1', measuredAt: 'x' }, { coverage: '100', cost: '1', measuredAt: 'x' }])).toEqual({ 1: { coverage: 'notIncreasing' } });
  });
});
