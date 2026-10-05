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
  // §43.18e (UX-ADR-2): desordenadas a propósito, con acentos y mayúsculas mezcladas.
  '01000': { state: 'Ciudad de México', municipality: 'Álvaro Obregón', neighborhoods: ['San Ángel', 'Ámsterdam', 'barrio Norte', 'Chimalistac'] },
  // §43.18m.4 (FC-21): `200` con 0 colonias (catálogo con el CP pero sin lista) — cuenta como «sin lista».
  '58000': { state: 'Michoacán de Ocampo', municipality: 'Morelia', neighborhoods: [] },
};
function postalCodeImpl(cp: string) {
  if (cp === '50000') return Promise.reject(new ApiClientError(500, { code: 'INTERNAL', message: 'x' }));
  if (cp === '60000') return new Promise(() => {}); // consulta colgada (UX-ADR-9)
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
 * Fase C (`API_CONTRACT §M4-SHIP.19.5`) con la colonia como Mercado Libre (v1.80.12.5 `§M4-SHIP.19.25`,
 * `HECHOS.md:57`, `DESIGN_SYSTEM §43.18m`): la lista del CP ayuda, no bloquea — colonia de la lista o escrita;
 * sin lista, colonia, municipio y estado se escriben. `references` opcional ≤ 70; CP 5 / tel 10; y la errata
 * v1.80.12.3 (§19.23.4): `line2` 0..200.
 */
describe('AddressManager · colonia de lista por CP (fase C)', () => {
  beforeEach(() => {
    for (const f of [listAddresses, createAddress, updateAddress, deleteAddress, getPostalCode]) f.mockReset();
    getPostalCode.mockImplementation(postalCodeImpl);
  });

  it('sin 5 dígitos no se consulta y la colonia está apagada CON su motivo; municipio y estado no son campos', async () => {
    const dialog = await openCreate();
    expect(within(dialog).queryByLabelText('Municipio o alcaldía')).toBeNull();
    expect(within(dialog).queryByLabelText('Estado')).toBeNull();
    // Sin 5 dígitos no hay botón de modo (§43.18m.1: el CP es obligatorio de todos modos).
    expect(within(dialog).queryByRole('button', { name: /colonia/i })).toBeNull();
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
    expect(
      await within(dialog).findByText('Elige tu colonia de la lista; si no aparece, usa «Mi colonia no está».'),
    ).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('UX-ADR-1 · CP 404 ⇒ colonia, municipio y estado se escriben; el aviso no es error ni remite a soporte; el POST lleva lo tecleado', async () => {
    createAddress.mockResolvedValue({ ...saved, id: 'a-new' });
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    const cpInput = within(dialog).getByLabelText('Código postal');
    cpInput.focus();
    type('Código postal', '20000');
    const intro = await within(dialog).findByTestId('address-geo-intro');
    expect(intro).toHaveTextContent(
      'No tenemos la lista de colonias del CP 20000. Si está bien escrito, escribe tu colonia, municipio y estado: los revisamos antes de enviar.',
    );
    expect(intro.textContent).not.toMatch(/@|Escríbenos/);
    expect(intro).not.toHaveAttribute('role', 'alert');
    // CA-7: el CP no está mal por no estar en el catálogo.
    expect(cpInput).not.toHaveAttribute('aria-invalid');
    expect(cpInput).toHaveFocus();
    const colonia = within(dialog).getByRole('textbox', { name: 'Colonia' });
    expect(within(dialog).queryByRole('combobox', { name: 'Colonia' })).toBeNull();
    expect(colonia).toHaveAccessibleDescription(/No tenemos la lista de colonias del CP 20000/);
    const estado = within(dialog).getByRole('combobox', { name: 'Estado' }) as HTMLSelectElement;
    expect(estado.options).toHaveLength(33); // placeholder + 32 entidades
    expect(estado.options[0]).toHaveTextContent('Elige un estado');
    // Sin lista a la que volver ⇒ ningún botón de modo.
    expect(within(dialog).queryByRole('button', { name: /Elegir de la lista|Mi colonia no está/ })).toBeNull();
    fireEvent.change(colonia, { target: { value: 'Zona Centro' } });
    type('Municipio o alcaldía', 'Aguascalientes');
    fireEvent.change(estado, { target: { value: 'Aguascalientes' } });
    type('Teléfono', '4491234567');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledTimes(1));
    expect(createAddress.mock.calls[0][0]).toMatchObject({
      postalCode: '20000',
      neighborhood: 'Zona Centro',
      city: 'Aguascalientes',
      state: 'Aguascalientes',
    });
  });

  it('UX-ADR-1 · `200` con 0 colonias ⇒ el mismo «todo a mano», con municipio y estado PRELLENADOS de la respuesta', async () => {
    const dialog = await openCreate();
    type('Código postal', '58000');
    expect(await within(dialog).findByTestId('address-geo-intro')).toHaveTextContent('No tenemos la lista de colonias del CP 58000.');
    expect(within(dialog).getByRole('textbox', { name: 'Colonia' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Municipio o alcaldía' })).toHaveValue('Morelia');
    expect(within(dialog).getByRole('combobox', { name: 'Estado' })).toHaveValue('Michoacán de Ocampo');
  });

  it('§43.18m.7 · «todo a mano» vacío ⇒ los tres textos de su modo y ningún POST', async () => {
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Código postal', '20000');
    await within(dialog).findByRole('textbox', { name: 'Colonia' });
    type('Teléfono', '4491234567');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Escribe el nombre de tu colonia.')).toBeInTheDocument();
    expect(within(dialog).getByText('Escribe tu municipio o alcaldía.')).toBeInTheDocument();
    expect(within(dialog).getByText('Elige tu estado.')).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('UX-ADR-8 · «Mi colonia no está» ⇒ input enfocado; el POST lleva la escrita con municipio/estado DEL CP; ir y volver conserva lo tecleado', async () => {
    createAddress.mockResolvedValue({ ...saved, id: 'a-new' });
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Código postal', '06600');
    await screen.findByRole('option', { name: 'Roma Norte' });
    const cta = within(dialog).getByRole('button', { name: 'Mi colonia no está' });
    expect(cta).toHaveAttribute('type', 'button');
    fireEvent.click(cta);
    const input = await within(dialog).findByRole('textbox', { name: 'Colonia' });
    expect(within(dialog).queryByRole('combobox', { name: 'Colonia' })).toBeNull();
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAccessibleDescription(/Escríbela como aparece en un recibo de luz o de agua\./);
    expect(within(dialog).getByTestId('address-city-state')).toHaveTextContent('Cuauhtémoc, Ciudad de México');
    fireEvent.change(input, { target: { value: 'Fracc. Los Pinos' } });
    // Volver a la lista ⇒ el select enfocado (y la escrita no casa ⇒ placeholder).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Elegir de la lista del CP 06600' }));
    const select = await within(dialog).findByRole('combobox', { name: 'Colonia' });
    await waitFor(() => expect(select).toHaveFocus());
    expect(select).toHaveValue('');
    // Y otra vez a mano: lo tecleado sigue ahí (CA-9).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mi colonia no está' }));
    expect(await within(dialog).findByRole('textbox', { name: 'Colonia' })).toHaveValue('Fracc. Los Pinos');
    type('Teléfono', '5555123456');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledTimes(1));
    expect(createAddress.mock.calls[0][0]).toMatchObject({
      postalCode: '06600',
      neighborhood: 'Fracc. Los Pinos',
      city: 'Cuauhtémoc',
      state: 'Ciudad de México',
    });
  });

  it('UX-ADR-9 · CP 500 ⇒ «Reintentar» y «Escribir la colonia a mano»; éste ⇒ los tres campos con `manualAllIntro`', async () => {
    const dialog = await openCreate();
    type('Código postal', '50000');
    expect(await within(dialog).findByText('No se pudieron consultar las colonias del CP 50000.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Escribir la colonia a mano' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Colonia' })).toHaveFocus());
    expect(within(dialog).getByTestId('address-geo-intro')).toHaveTextContent(
      'Escribe tu colonia, municipio y estado: los revisamos antes de enviar.',
    );
    expect(within(dialog).getByRole('textbox', { name: 'Municipio o alcaldía' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Estado' })).toBeInTheDocument();
  });

  it('UX-ADR-9 · consulta colgada ⇒ «Escribir la colonia a mano» visible y usable antes de que llegue respuesta', async () => {
    const dialog = await openCreate();
    type('Código postal', '60000');
    expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Escribir la colonia a mano' }));
    expect(await within(dialog).findByRole('textbox', { name: 'Colonia' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Municipio o alcaldía' })).toBeInTheDocument();
  });

  it('UX-ADR-10 · a mano elegido mientras consulta + llega la lista ⇒ el modo NO cambia solo; otro CP con lista ⇒ select con placeholder', async () => {
    let resolve!: (v: unknown) => void;
    getPostalCode.mockImplementation((cp: string) =>
      cp === '06600' ? new Promise((r) => (resolve = r)) : postalCodeImpl(cp),
    );
    const dialog = await openCreate();
    type('Código postal', '06600');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Escribir la colonia a mano' }));
    const input = await within(dialog).findByRole('textbox', { name: 'Colonia' });
    fireEvent.change(input, { target: { value: 'Mi colonia' } });
    type('Municipio o alcaldía', 'Mi municipio');
    resolve({ postalCode: '06600', ...CATALOG['06600'], source: 'local' });
    expect(await within(dialog).findByRole('button', { name: 'Elegir de la lista del CP 06600' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Colonia' })).toHaveValue('Mi colonia');
    expect(within(dialog).getByRole('textbox', { name: 'Municipio o alcaldía' })).toHaveValue('Mi municipio');
    expect(within(dialog).queryByRole('combobox', { name: 'Colonia' })).toBeNull();
    type('Código postal', '01000');
    const select = await within(dialog).findByRole('combobox', { name: 'Colonia' });
    await screen.findByRole('option', { name: 'Ámsterdam' });
    expect(select).toHaveValue('');
  });

  it('UX-ADR-13 · cada opción del select de colonia es del fixture: ninguna centinela «Mi colonia no está»', async () => {
    const dialog = await openCreate();
    type('Código postal', '01000');
    await screen.findByRole('option', { name: 'Ámsterdam' });
    const values = (within(dialog).getAllByRole('option') as HTMLOptionElement[]).map((o) => o.value).filter((v) => v !== '');
    expect(values.every((v) => CATALOG['01000'].neighborhoods.includes(v))).toBe(true);
    expect(within(dialog).queryByRole('option', { name: /no está/ })).toBeNull();
  });

  it.each([
    ['dos colonias', '06600'],
    ['UNA colonia', '44100'],
  ])('UX-ADR-11 · editar una dirección con colonia escrita fuera de la lista (%s) ⇒ abre a mano con su valor; «Guardar» sin tocar la conserva', async (_n, cp) => {
    const typed: AddressDTO = { ...saved, postalCode: cp, neighborhood: 'Fracc. Los Pinos', city: CATALOG[cp].municipality, state: CATALOG[cp].state };
    listAddresses.mockResolvedValue([typed]);
    updateAddress.mockResolvedValue(typed);
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('textbox', { name: 'Colonia' })).toHaveValue('Fracc. Los Pinos');
    expect(within(dialog).getByRole('button', { name: `Elegir de la lista del CP ${cp}` })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(updateAddress).toHaveBeenCalledTimes(1));
    expect(updateAddress.mock.calls[0][1]).toMatchObject({
      postalCode: cp,
      neighborhood: 'Fracc. Los Pinos',
      city: CATALOG[cp].municipality,
      state: CATALOG[cp].state,
    });
  });

  it('`400 {field:city, reason:required_with_postal_code}` del PATCH ⇒ bajo el municipio en «todo a mano»', async () => {
    const out: AddressDTO = { ...saved, postalCode: '20000', neighborhood: 'Zona Centro', city: 'Aguascalientes', state: 'Aguascalientes' };
    listAddresses.mockResolvedValue([out]);
    updateAddress.mockRejectedValue(
      new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'city', reason: 'required_with_postal_code' } }),
    );
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    // CP fuera del catálogo al abrir ⇒ «todo a mano» con lo guardado (CA-9: no se borra nada).
    expect(await within(dialog).findByRole('textbox', { name: 'Colonia' })).toHaveValue('Zona Centro');
    expect(within(dialog).getByRole('textbox', { name: 'Municipio o alcaldía' })).toHaveValue('Aguascalientes');
    expect(within(dialog).getByRole('combobox', { name: 'Estado' })).toHaveValue('Aguascalientes');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Escribe tu municipio o alcaldía.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Municipio o alcaldía' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('UX-ADR-2 · opciones en orden alfabético (es, sin distinguir acentos ni mayúsculas) con el VALOR del catálogo', async () => {
    const dialog = await openCreate();
    type('Código postal', '01000');
    await screen.findByRole('option', { name: 'Ámsterdam' });
    const options = within(dialog).getAllByRole('option').slice(1) as HTMLOptionElement[];
    expect(options.map((o) => o.textContent)).toEqual(['Ámsterdam', 'barrio Norte', 'Chimalistac', 'San Ángel']);
    expect(options.map((o) => o.value)).toEqual(['Ámsterdam', 'barrio Norte', 'Chimalistac', 'San Ángel']);
    // Con 2+ colonias: placeholder, ⛔ sin preselección.
    expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toHaveValue('');
  });

  it('UX-ADR-2 · una sola colonia ⇒ elegida sin interacción y el POST la lleva', async () => {
    createAddress.mockResolvedValue({ ...saved, id: 'a-new' });
    const dialog = await openCreate();
    type('Nombre de quien recibe', 'Ana');
    type('Calle y número', 'Calle 1');
    type('Código postal', '44100');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toHaveValue('Guadalajara Centro'));
    type('Teléfono', '3333123456');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledTimes(1));
    expect(createAddress.mock.calls[0][0]).toMatchObject({ neighborhood: 'Guadalajara Centro', postalCode: '44100', city: 'Guadalajara' });
  });

  it('UX-ADR-5 · las referencias preceden en el DOM al teléfono', async () => {
    const dialog = await openCreate();
    const refs = within(dialog).getByLabelText('Referencias para el repartidor (opcional)');
    const tel = dialog.querySelector('input[type="tel"]')!;
    expect(refs.compareDocumentPosition(tel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('UX-ADR-6 · pegar 80 caracteres: se conservan (sin maxLength), contador «80 / 70» en bermellón y al guardar referencesTooLong', async () => {
    const dialog = await openCreate();
    const refs = within(dialog).getByLabelText('Referencias para el repartidor (opcional)');
    expect(refs).not.toHaveAttribute('maxlength');
    type('Referencias para el repartidor (opcional)', 'r'.repeat(80));
    expect(refs).toHaveValue('r'.repeat(80));
    const counter = within(dialog).getByTestId('textarea-counter');
    expect(counter).toHaveTextContent('80 / 70');
    expect(counter).toHaveClass('text-accent');
    expect(counter).not.toHaveClass('text-muted');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(
      await within(dialog).findByText('Las referencias no caben en la guía: acórtalas (hasta 70 caracteres).'),
    ).toBeInTheDocument();
  });

  it('contador en el tope (70) sigue en gris', async () => {
    const dialog = await openCreate();
    type('Referencias para el repartidor (opcional)', 'r'.repeat(70));
    const counter = within(dialog).getByTestId('textarea-counter');
    expect(counter).toHaveTextContent('70 / 70');
    expect(counter).toHaveClass('text-muted');
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
    expect(await within(dialog).findByText('El teléfono son 10 dígitos.')).toBeInTheDocument();
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

  it('fila con complete:false ⇒ nombra lo que falta + «Completar dirección» (modo completar, foco en el CP)', async () => {
    listAddresses.mockResolvedValue([{ ...saved, neighborhood: null, postalCode: '0660', complete: false }]);
    renderWithProviders(<AddressManager />, 'es');
    const flag = await screen.findByTestId('address-incomplete');
    expect(flag).toHaveTextContent('Dirección incompleta: falta la colonia y un CP de 5 dígitos.');
    const cta = within(flag).getByRole('button', { name: 'Completar dirección' });
    // §43.18f: dice de qué dirección es (renglón de la dirección) y objetivo táctil ≥ 24 px.
    expect(cta).toHaveAccessibleDescription('Av. Reforma 222');
    expect(cta).toHaveClass('py-1.5');
    fireEvent.click(cta);
    const dialog = await screen.findByRole('dialog');
    // §43.18g: modo completar — título «Completar dirección» e intro con lo que falta.
    expect(within(dialog).getByRole('heading', { name: 'Completar dirección' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('address-complete-intro')).toHaveTextContent(
      'A esta dirección le falta la colonia y un CP de 5 dígitos. Lo que guardes se queda en tu libreta de direcciones.',
    );
    await waitFor(() => expect(within(dialog).getByLabelText('Código postal')).toHaveFocus());
  });

  it('UX-ADR-3 · complete:false con neighborhood:null ⇒ «Dirección incompleta: falta la colonia.»', async () => {
    listAddresses.mockResolvedValue([{ ...saved, neighborhood: null, complete: false }]);
    renderWithProviders(<AddressManager />, 'es');
    expect(await screen.findByTestId('address-incomplete')).toHaveTextContent('Dirección incompleta: falta la colonia.');
  });

  it('UX-ADR-3 · complete:true con neighborhood:null ⇒ SIN marca (manda el servidor)', async () => {
    listAddresses.mockResolvedValue([{ ...saved, neighborhood: null, complete: true }]);
    renderWithProviders(<AddressManager />, 'es');
    await screen.findByText('Recibe: Ana López');
    expect(screen.queryByTestId('address-incomplete')).toBeNull();
  });

  it('UX-ADR-3 · complete:false sin hueco deducible ⇒ el genérico (nunca la marca sin texto) y el modal en genérico', async () => {
    listAddresses.mockResolvedValue([{ ...saved, complete: false }]);
    renderWithProviders(<AddressManager />, 'es');
    const flag = await screen.findByTestId('address-incomplete');
    expect(flag).toHaveTextContent('Dirección incompleta: le faltan datos para la guía.');
    fireEvent.click(within(flag).getByRole('button', { name: 'Completar dirección' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('address-complete-intro')).toHaveTextContent(
      'A esta dirección le faltan datos para la guía. Lo que guardes se queda en tu libreta de direcciones.',
    );
  });

  it('«Editar» sigue siendo «Editar dirección», sin intro de completar', async () => {
    listAddresses.mockResolvedValue([saved]);
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Editar dirección' })).toBeInTheDocument();
    expect(within(dialog).queryByTestId('address-complete-intro')).toBeNull();
  });

  it('complete:true no pinta la marca (la decisión es del servidor)', async () => {
    listAddresses.mockResolvedValue([saved]);
    renderWithProviders(<AddressManager />, 'es');
    await screen.findByText('Recibe: Ana López');
    expect(screen.queryByTestId('address-incomplete')).toBeNull();
  });
});
