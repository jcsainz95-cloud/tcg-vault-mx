import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { AdminShipmentDTO, NeighborhoodCheck } from '@/types/contract';
import { CaptureLabelDialog } from '../CaptureLabelDialog';
import { TARGET, quote, shipment } from './sdx-test-fixtures';

const Q = quote();

/**
 * «Capturar guía», paso 1, con la colonia como Mercado Libre (v1.80.12.5 `API_CONTRACT §M4-SHIP.19.25`,
 * `HECHOS.md:50` y `:57`; diseño `DESIGN_SYSTEM §43.18m.6`, FC-25/FC-26, UX-ADR-11/12).
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'vault_operator', setRole: () => {}, isSuperAdmin: false, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'listShippingPackages').mockResolvedValue([]);
  vi.spyOn(api, 'getPostalCode').mockImplementation(async (cp: string) => {
    if (cp === '14210') return { postalCode: cp, state: 'Ciudad de México', municipality: 'Tlalpan', neighborhoods: ['Jardines de la Montaña', 'Parques del Pedregal'], source: 'local' };
    if (cp === '37000') return { postalCode: cp, state: 'Guanajuato', municipality: 'León', neighborhoods: ['León de los Aldama Centro'], source: 'local' };
    throw new ApiClientError(404, { code: 'POSTAL_CODE_UNKNOWN', message: 'x', details: { postalCode: cp } });
  });
});

function open(s: AdminShipmentDTO) {
  vi.spyOn(api, 'getAdminShipment').mockResolvedValue(s);
  vi.spyOn(api, 'quoteShipment').mockResolvedValue(Q);
  renderWithProviders(<CaptureLabelDialog target={TARGET} onClose={vi.fn()} onSaved={vi.fn()} />, 'es');
}

function withSnap(over: Record<string, unknown>, check?: NeighborhoodCheck): AdminShipmentDTO {
  const base = shipment();
  return shipment({
    addressSnapshot: { ...base.addressSnapshot!, ...over },
    address: { ...base.address!, ...(check ? { neighborhoodCheck: check } : {}) },
  });
}

async function openForm(s: AdminShipmentDTO) {
  open(s);
  fireEvent.click(await screen.findByRole('button', { name: 'Corregir dirección' }));
  await screen.findByRole('button', { name: 'Guardar dirección' });
  return document.querySelector('form') as HTMLElement;
}

describe('FC-25 parte 1 / UX-ADR-11 · «Corregir dirección» no borra la colonia escrita', () => {
  it.each([
    ['dos colonias', '14210', 'Tlalpan', 'Ciudad de México'],
    ['UNA colonia', '37000', 'León', 'Guanajuato'],
  ])('colonia guardada fuera de la lista (%s) ⇒ abre a mano con su valor; «Guardar» sin tocar la manda tal cual', async (_n, cp, city, state) => {
    const put = vi.spyOn(api, 'correctShipmentAddress').mockResolvedValue({ outcome: 'unchanged', shipment: shipment() });
    const form = await openForm(withSnap({ postalCode: cp, neighborhood: 'Fracc. Los Pinos', city, state }));
    const input = await within(form).findByRole('textbox', { name: 'Colonia (escrita a mano)' });
    expect(input).toHaveValue('Fracc. Los Pinos');
    expect(within(form).queryByRole('combobox', { name: /Colonia/ })).toBeNull();
    expect(within(form).getByRole('button', { name: `Elegir de la lista del CP ${cp}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1]).toMatchObject({ postalCode: cp, neighborhood: 'Fracc. Los Pinos', city, state });
  });

  it('colonia guardada DE la lista ⇒ el select con ella elegida (no se va a mano)', async () => {
    const form = await openForm(shipment());
    await waitFor(() => expect(within(form).getByRole('combobox', { name: /Colonia/ })).toHaveValue('Jardines de la Montaña'));
    expect(within(form).getByRole('button', { name: 'La colonia no está en la lista' })).toBeInTheDocument();
  });
});

describe('C-4 · el operador corrige a texto libre', () => {
  it('«La colonia no está en la lista» ⇒ input enfocado con su label; el PUT lleva la escrita con municipio/estado DEL CP', async () => {
    const put = vi.spyOn(api, 'correctShipmentAddress').mockResolvedValue({ outcome: 'corrected', shipment: shipment() });
    const form = await openForm(shipment());
    await waitFor(() => expect(within(form).getByRole('combobox', { name: /Colonia/ })).toHaveValue('Jardines de la Montaña'));
    fireEvent.click(within(form).getByRole('button', { name: 'La colonia no está en la lista' }));
    const input = await within(form).findByRole('textbox', { name: 'Colonia (escrita a mano)' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: 'Ampliación Pedregal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1]).toMatchObject({ postalCode: '14210', neighborhood: 'Ampliación Pedregal', city: 'Tlalpan', state: 'Ciudad de México' });
  });

  it('CP fuera del catálogo ⇒ aviso (no error), colonia, municipio y estado editables y el PUT los lleva', async () => {
    const put = vi.spyOn(api, 'correctShipmentAddress').mockResolvedValue({ outcome: 'corrected', shipment: shipment() });
    const form = await openForm(shipment());
    const cp = within(form).getByRole('textbox', { name: 'CP' });
    fireEvent.change(cp, { target: { value: '20000' } });
    expect(await within(form).findByTestId('sdx-address-geo-intro')).toHaveTextContent(
      'El CP 20000 no está en el catálogo de colonias. Revísalo; si es correcto, escribe colonia, municipio y estado.',
    );
    expect(cp).not.toHaveAttribute('aria-invalid');
    fireEvent.change(within(form).getByRole('textbox', { name: 'Colonia (escrita a mano)' }), { target: { value: 'Zona Centro' } });
    const city = within(form).getByRole('textbox', { name: 'Municipio o alcaldía' });
    // Municipio y estado del CP ANTERIOR no sobreviven al CP nuevo.
    expect(city).toHaveValue('');
    fireEvent.change(city, { target: { value: 'Aguascalientes' } });
    fireEvent.change(within(form).getByRole('combobox', { name: 'Estado' }), { target: { value: 'Aguascalientes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dirección' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][1]).toMatchObject({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' });
  });
});

describe('UX-ADR-12 · el aviso de revisión sale del dato del servidor (`neighborhoodCheck`) y no bloquea', () => {
  it("'not_in_postal_code_list' ⇒ marca bajo Colonia y la línea de revisión; «Ver opciones de envío» habilitado", async () => {
    open(withSnap({ neighborhood: 'Fracc. Los Pinos' }, 'not_in_postal_code_list'));
    const dl = await screen.findByTestId('sdx-address-dl');
    const marks = within(dl).getAllByTestId('sdx-address-manual-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('Escrita a mano por el cliente · no está en la lista del CP 14210');
    expect(screen.getByTestId('sdx-address-manual-review')).toHaveTextContent(
      'El cliente escribió la colonia a mano. Revísala antes de ver opciones de envío; si está mal escrita, corrígela.',
    );
    expect(screen.getByRole('button', { name: 'Ver opciones de envío' })).toBeEnabled();
  });

  it("'postal_code_not_in_catalog' ⇒ además la marca bajo Estado y `manualReview.all`", async () => {
    open(withSnap({ postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' }, 'postal_code_not_in_catalog'));
    const dl = await screen.findByTestId('sdx-address-dl');
    expect(within(dl).getAllByTestId('sdx-address-manual-mark').map((m) => m.textContent)).toEqual([
      'Escrita a mano por el cliente · no está en la lista del CP 20000',
      'Municipio y estado escritos a mano: el CP 20000 no está en el catálogo',
    ]);
    expect(screen.getByTestId('sdx-address-manual-review')).toHaveTextContent('(el CP 20000 no está en el catálogo)');
    expect(screen.getByRole('button', { name: 'Ver opciones de envío' })).toBeEnabled();
  });

  it.each([
    ["'in_catalog'", 'in_catalog' as NeighborhoodCheck],
    ['sin el dato (servidor anterior)', undefined],
  ])('%s ⇒ CERO marcas, aunque la colonia no esté en la lista (⛔ la pantalla no lo deduce)', async (_n, check) => {
    open(withSnap({ neighborhood: 'Fracc. Los Pinos' }, check));
    await screen.findByTestId('sdx-address-dl');
    expect(screen.queryAllByTestId('sdx-address-manual-mark')).toHaveLength(0);
    expect(screen.queryByTestId('sdx-address-manual-review')).toBeNull();
  });
});
