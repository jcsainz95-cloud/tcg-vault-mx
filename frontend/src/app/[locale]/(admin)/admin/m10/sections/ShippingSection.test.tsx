import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { mockSettings } from '@/lib/mock/fixtures';
import { ShippingSection, tierErrors, STORE_REQUIRED_KEYS } from './ShippingSection';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  // 🔒 v1.80.12.10: el interruptor y el saldo bajo son diales del dueño ⇒ estas pruebas corren con la sesión del dueño.
  vi.spyOn(api, 'getMe').mockResolvedValue({ id: 'u-sa1', email: 'd@x.mx', name: 'Dueño', role: 'super_admin', locale: 'es', isOwner: true });
});

describe('UX-SDX-17 · la puerta de compra y los escalones', () => {
  it('pasar a «También el personal» abre el diálogo y NO manda PUT hasta confirmar', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const group = await screen.findByTestId('shipping-purchase');
    await waitFor(() => expect(within(group).getByRole('radio', { name: /También el personal/ })).toBeEnabled());
    fireEvent.click(within(group).getByRole('radio', { name: /También el personal/ }));
    const dialog = await screen.findByRole('dialog', { name: '¿Dejar que el personal compre guías?' });
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, dejar que compren' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ shippingLabelPurchase: 'operators' }));
  });
  it('bajar a «Nadie» no pregunta', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const group = await screen.findByTestId('shipping-purchase');
    await waitFor(() => expect(within(group).getByRole('radio', { name: /Nadie/ })).toBeEnabled());
    fireEvent.click(within(group).getByRole('radio', { name: /Nadie/ }));
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

describe('FS-67 (`DESIGN_SYSTEM §43.22.3`) · el ancla de «Ver el saldo»', () => {
  it('la sección de envíos lleva `id="envios-skydropx"`', async () => {
    renderWithProviders(<ShippingSection />, 'es');
    const section = await screen.findByTestId('shipping-section');
    expect(section).toHaveAttribute('id', 'envios-skydropx');
  });
});

/** Dirección de la tienda (`skydropx_origin_snapshot`): destino de la guía de entrada de buylist. Datos FICTICIOS. */
describe('Dirección de la tienda (destino de la guía de entrada)', () => {
  const fake = { name: 'Tienda Ejemplo', company: 'Ejemplo SA', street1: 'Calle Falsa 123', postalCode: '00000', areaLevel1: 'Estado Ejemplo', areaLevel2: 'Municipio Ejemplo', areaLevel3: 'Colonia Ejemplo', phone: '5500000000', email: 'tienda@example.invalid', reference: null };
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Guardar envíos' }));

  it('carga lo guardado en los campos', async () => {
    vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, shippingProvider: 'skydropx', shippingLabelPurchase: 'super_admin_only', skydropxOriginSnapshot: fake });
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    expect(within(box).getByLabelText('Calle y número (obligatorio)')).toHaveValue('Calle Falsa 123');
    expect(within(box).getByLabelText('Referencia (opcional)')).toHaveValue('');
  });
  it('guarda las diez claves (vacías como null) con el mismo botón', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    const set = (l: string, v: string) => fireEvent.change(within(box).getByLabelText(l), { target: { value: v } });
    set('Nombre de quien recibe (obligatorio)', fake.name);
    set('Calle y número (obligatorio)', fake.street1);
    set('Código postal (obligatorio)', fake.postalCode);
    set('Estado (obligatorio)', fake.areaLevel1);
    set('Ciudad o municipio (obligatorio)', fake.areaLevel2);
    set('Colonia (obligatorio)', fake.areaLevel3);
    set('Teléfono (obligatorio)', fake.phone);
    set('Correo (obligatorio)', fake.email);
    save();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0].skydropxOriginSnapshot).toEqual({ ...fake, company: null });
  });
  it('con algún dato y obligatorias vacías: error bajo cada una, lista de faltantes y el resto SÍ se guarda sin el dial', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    fireEvent.change(within(box).getByLabelText('Empresa'), { target: { value: 'Ejemplo SA' } });
    expect(within(box).getByTestId('shipping-store-blocked')).toHaveTextContent('Faltan: Nombre de quien recibe, Calle y número');
    save();
    expect((await within(box).findAllByText('Falta este dato.')).length).toBe(8);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect('skydropxOriginSnapshot' in put.mock.calls[0][0]).toBe(false);
  });
  it('solo espacios cuenta como vacío (mata «sin trim»)', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    fireEvent.change(within(box).getByLabelText('Nombre de quien recibe (obligatorio)'), { target: { value: 'Tienda Ejemplo' } });
    for (const l of ['Calle y número', 'Código postal', 'Estado', 'Ciudad o municipio', 'Colonia', 'Teléfono', 'Correo']) {
      fireEvent.change(within(box).getByLabelText(`${l} (obligatorio)`), { target: { value: '   ' } });
    }
    save();
    expect((await within(box).findAllByText('Falta este dato.')).length).toBe(7);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect('skydropxOriginSnapshot' in put.mock.calls[0][0]).toBe(false);
  });
  it('solo espacios en todo ⇒ vacío ⇒ null', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    fireEvent.change(within(box).getByLabelText('Empresa'), { target: { value: '   ' } });
    save();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0].skydropxOriginSnapshot).toBeNull();
  });
  it('CP de 4 dígitos o con letras ⇒ error y no se manda el dial', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, shippingProvider: 'skydropx', shippingLabelPurchase: 'super_admin_only', skydropxOriginSnapshot: fake });
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    fireEvent.change(within(box).getByLabelText('Código postal (obligatorio)'), { target: { value: '1234' } });
    save();
    expect(await within(box).findByText('Debe tener 5 dígitos.')).toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect('skydropxOriginSnapshot' in put.mock.calls[0][0]).toBe(false);
  });
  it('referencia: maxLength 70 y error si se pasa', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    vi.spyOn(api, 'getSettings').mockResolvedValue({ ...mockSettings, shippingProvider: 'skydropx', shippingLabelPurchase: 'super_admin_only', skydropxOriginSnapshot: fake });
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    const ref = within(box).getByLabelText('Referencia (opcional)');
    expect(ref).toHaveAttribute('maxLength', '70');
    fireEvent.change(ref, { target: { value: 'x'.repeat(71) } });
    save();
    expect(await within(box).findByText('Máximo 70 caracteres.')).toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect('skydropxOriginSnapshot' in put.mock.calls[0][0]).toBe(false);
  });
  it('la ayuda dice que también es el remitente de los envíos a clientes (es y en)', async () => {
    renderWithProviders(<ShippingSection />, 'es');
    const box = await screen.findByTestId('shipping-store-address');
    expect(box).toHaveTextContent('el remitente de los envíos a clientes');
    expect(box).not.toHaveTextContent('No cambia la plantilla');
  });
  it('paridad: las obligatorias del front = STORE_REQUIRED del backend (label-inbound.ts)', () => {
    const src = readFileSync(resolve(process.cwd(), '../backend/src/modules/shipments/label-inbound.ts'), 'utf8');
    const m = /const STORE_REQUIRED = \[([^\]]+)\] as const/.exec(src);
    expect(m).not.toBeNull();
    const back = m![1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect([...STORE_REQUIRED_KEYS].sort()).toEqual(back);
  });
  it('todo vacío guarda null (sin dirección) y no bloquea el guardado', async () => {
    const put = vi.spyOn(api, 'updateSettings').mockResolvedValue(mockSettings);
    renderWithProviders(<ShippingSection />, 'es');
    await screen.findByTestId('shipping-store-address');
    save();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0].skydropxOriginSnapshot).toBeNull();
  });
  it('400 del validador del servidor ⇒ lo muestra', async () => {
    vi.spyOn(api, 'updateSettings').mockRejectedValue(new ApiClientError(400, { code: 'VALIDATION_ERROR', message: "unknown key 'zip'" }));
    renderWithProviders(<ShippingSection />, 'es');
    await screen.findByTestId('shipping-store-address');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent("unknown key 'zip'");
  });
});
