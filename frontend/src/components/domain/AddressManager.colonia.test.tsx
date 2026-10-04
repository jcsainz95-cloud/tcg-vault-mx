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

  it('UX-ADR-1 · CP 404 ⇒ bajo el CP «Revisa…» + «escríbenos a soporte@tcghunt.mx»; colonia apagada con su motivo; cero campos libres', async () => {
    const dialog = await openCreate();
    type('Código postal', '99999');
    const cpInput = within(dialog).getByLabelText('Código postal');
    await waitFor(() =>
      expect(cpInput).toHaveAccessibleDescription(
        'No encontramos el CP 99999 en nuestro catálogo y sin él no podemos enviar. Revisa que esté bien escrito; si es correcto, escríbenos a soporte@tcghunt.mx con tu CP.',
      ),
    );
    const colonia = within(dialog).getByRole('combobox', { name: 'Colonia' });
    expect(colonia).toBeDisabled();
    expect(colonia).toHaveAccessibleDescription(/Sin colonias: este CP no está en el catálogo\./);
    // «¿No aparece tu colonia?» NO se pinta con el CP desconocido (ahí manda `cpUnknown`).
    expect(within(dialog).queryByTestId('neighborhood-not-listed')).toBeNull();
    // CA-1: ningún texto libre para colonia, municipio o estado.
    for (const name of [/colonia/i, /municipio/i, /estado/i, /ciudad/i]) {
      expect(within(dialog).queryByRole('textbox', { name })).toBeNull();
    }
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

  it('§43.18d · con lista, «¿No aparece tu colonia? Escríbenos…» bajo el select y en su aria-describedby', async () => {
    const dialog = await openCreate();
    type('Código postal', '06600');
    const line = await within(dialog).findByTestId('neighborhood-not-listed');
    expect(line).toHaveTextContent(
      '¿No aparece tu colonia? Escríbenos a soporte@tcghunt.mx con tu CP y el nombre de tu colonia.',
    );
    expect(within(dialog).getByRole('combobox', { name: 'Colonia' })).toHaveAccessibleDescription(
      /¿No aparece tu colonia\? Escríbenos a soporte@tcghunt\.mx/,
    );
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
