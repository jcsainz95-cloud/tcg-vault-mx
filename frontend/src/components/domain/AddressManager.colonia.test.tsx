import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type { AddressDTO } from '@/types/contract';
import { AddressManager } from './AddressManager';

const listAddresses = vi.fn();
const createAddress = vi.fn();
const updateAddress = vi.fn();
const deleteAddress = vi.fn();
const getPostalCode = vi.fn();
vi.mock('@/lib/api', () => ({
  getPostalCode: (cp: string) => getPostalCode(cp),
  listAddresses: () => listAddresses(),
  createAddress: (...a: unknown[]) => createAddress(...a),
  updateAddress: (...a: unknown[]) => updateAddress(...a),
  deleteAddress: (...a: unknown[]) => deleteAddress(...a),
}));

/** El doble de `GET /geo/postal-codes/:cp` (§M4-SHIP.19.5). */
const CATALOG: Record<string, { state: string; municipality: string; neighborhoods: string[] }> = {
  '06600': { state: 'Ciudad de México', municipality: 'Cuauhtémoc', neighborhoods: ['Juárez', 'Roma Norte'] },
  '44100': { state: 'Jalisco', municipality: 'Guadalajara', neighborhoods: ['Guadalajara Centro'] },
};
function postalCodeImpl(cp: string) {
  const hit = CATALOG[cp];
  if (!hit) {
    return Promise.reject(new ApiClientError(404, { code: 'POSTAL_CODE_UNKNOWN', message: 'x', details: { postalCode: cp } }));
  }
  return Promise.resolve({ postalCode: cp, ...hit, source: 'local' as const });
}

const saved: AddressDTO = {
  id: 'a-1',
  recipientName: 'Ana López',
  line1: 'Av. Reforma 222',
  neighborhood: 'Juárez',
  city: 'Cuauhtémoc',
  state: 'Ciudad de México',
  postalCode: '06600',
  country: 'MX',
  phone: '5555123456',
  references: null,
  isDefault: true,
  complete: true,
};

async function openCreate() {
  listAddresses.mockResolvedValue([]);
  renderWithProviders(<AddressManager />, 'es');
  fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
  return screen.findByRole('dialog');
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function chooseColonia(name: string) {
  await screen.findByRole('option', { name });
  fireEvent.change(screen.getByRole('combobox', { name: 'Colonia' }), { target: { value: name } });
}

/**
 * Fase C (`API_CONTRACT §M4-SHIP.19.5`, criterio 235): la libreta pide la colonia DE LA LISTA del CP;
 * municipio y estado los da el CP (⛔ no son campos); `references` opcional ≤ 70; CP 5 / tel 10; y la
 * errata v1.80.12.3 (§19.23.4): `line2` 0..200.
 */
describe('AddressManager · colonia de lista por CP (fase C)', () => {
  beforeEach(() => {
    for (const f of [listAddresses, createAddress, updateAddress, deleteAddress, getPostalCode]) f.mockReset();
    getPostalCode.mockImplementation(postalCodeImpl);
  });

  it('sin 5 dígitos no se consulta y la colonia está apagada CON su motivo; ciudad y estado no son campos', async () => {
    const dialog = await openCreate();
    expect(within(dialog).queryByLabelText('Ciudad')).toBeNull();
    expect(within(dialog).queryByLabelText('Estado')).toBeNull();
    const colonia = within(dialog).getByRole('combobox', { name: 'Colonia' });
    expect(colonia).toBeDisabled();
    expect(colonia).toHaveAccessibleDescription(/Escribe los 5 dígitos del CP para ver sus colonias\./);
    type('Código postal', '0660');
    expect(getPostalCode).not.toHaveBeenCalled();
  });

  it('con 5 dígitos consulta el CP, lista sus colonias y manda la elegida con municipio y estado DEL CP', async () => {
    createAddress.mockResolvedValue({ ...saved, id: 'a-new' });
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana López');
    type('Calle y número', 'Av. Reforma 222');
    type('Código postal', '06600');
    await chooseColonia('Roma Norte');
    expect(getPostalCode).toHaveBeenCalledWith('06600');
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elige una colonia', 'Juárez', 'Roma Norte']);
    expect(within(dialog).getByTestId('address-city-state')).toHaveTextContent(
      'Municipio y estado: Cuauhtémoc, Ciudad de México (salen del CP).',
    );
    type('Teléfono', '55 5512 3456');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledTimes(1));
    const body = createAddress.mock.calls[0][0];
    expect(body).toMatchObject({
      neighborhood: 'Roma Norte',
      city: 'Cuauhtémoc',
      state: 'Ciudad de México',
      postalCode: '06600',
      phone: '5555123456',
      country: 'MX',
    });
    // Referencias vacías en el alta ⇒ no viajan.
    expect(body.references).toBeUndefined();
  });

  it('sin colonia elegida no se manda nada: «Elige la colonia de la lista del CP.»', async () => {
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Código postal', '06600');
    await screen.findByRole('option', { name: 'Juárez' });
    type('Teléfono', '5555123456');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Elige la colonia de la lista del CP.')).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('CP que no está en el catálogo ⇒ mensaje bajo el CP y colonia apagada', async () => {
    const dialog = await openCreate();
    type('Código postal', '99999');
    expect(
      await within(dialog).findByText('No encontramos el CP 99999 en el catálogo de colonias. Revisa que esté bien escrito.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toBeDisabled();
  });

  it('422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE ⇒ aviso BAJO la colonia y la lista pasa a ser `allowed`', async () => {
    createAddress.mockRejectedValue(
      new ApiClientError(422, {
        code: 'NEIGHBORHOOD_NOT_IN_POSTAL_CODE',
        message: 'x',
        details: { postalCode: '06600', allowed: ['Juárez', 'Tabacalera'] },
      }),
    );
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Código postal', '06600');
    await chooseColonia('Roma Norte');
    type('Teléfono', '5555123456');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(
      await within(dialog).findByText('Esa colonia no es del CP 06600. No se guardó nada: elige una de la lista.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Tabacalera' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('referencias de 71 y número interior de 201 no se mandan; 70 y 200 sí (§19.5, §19.23.4)', async () => {
    createAddress.mockResolvedValue({ ...saved, id: 'a-new' });
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Número interior o depto. (opcional)', 'x'.repeat(201));
    type('Código postal', '06600');
    await chooseColonia('Juárez');
    type('Teléfono', '5555123456');
    type('Referencias para el repartidor (opcional)', 'r'.repeat(71));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Hasta 200 caracteres: acórtalo.')).toBeInTheDocument();
    expect(within(dialog).getByText('Las referencias no caben en la guía: acórtalas (hasta 70 caracteres).')).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();

    type('Número interior o depto. (opcional)', 'x'.repeat(200));
    type('Referencias para el repartidor (opcional)', 'r'.repeat(70));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledTimes(1));
    expect(createAddress.mock.calls[0][0]).toMatchObject({ line2: 'x'.repeat(200), references: 'r'.repeat(70) });
  });

  it('teléfono de 9 dígitos no se manda (la libreta queda al nivel del invitado)', async () => {
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Código postal', '06600');
    await chooseColonia('Juárez');
    type('Teléfono', '555512345');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Teléfono inválido')).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('al editar, una colonia guardada con otra grafía se preselecciona en su forma canónica; vaciar referencias manda null', async () => {
    listAddresses.mockResolvedValue([{ ...saved, neighborhood: 'juarez', references: 'Portón negro' }]);
    updateAddress.mockResolvedValue(saved);
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toHaveValue('Juárez'));
    type('Referencias para el repartidor (opcional)', '');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(updateAddress).toHaveBeenCalledTimes(1));
    expect(updateAddress.mock.calls[0][1]).toMatchObject({ neighborhood: 'Juárez', references: null });
  });

  it('fila con complete:false ⇒ «Dirección incompleta» + «Completar dirección», que abre la edición con el foco en el CP', async () => {
    listAddresses.mockResolvedValue([{ ...saved, neighborhood: null, postalCode: '0660', complete: false }]);
    renderWithProviders(<AddressManager />, 'es');
    const flag = await screen.findByTestId('address-incomplete');
    expect(flag).toHaveTextContent('Dirección incompleta: falta la colonia, el CP de 5 dígitos o el teléfono de 10.');
    fireEvent.click(within(flag).getByRole('button', { name: 'Completar dirección' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Código postal')).toHaveFocus());
  });

  it('complete:true no pinta la marca (la decisión es del servidor)', async () => {
    listAddresses.mockResolvedValue([saved]);
    renderWithProviders(<AddressManager />, 'es');
    await screen.findByText('Recibe: Ana López');
    expect(screen.queryByTestId('address-incomplete')).toBeNull();
  });
});
