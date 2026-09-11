import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { AddressDTO } from '@/types/contract';
import { AddressManager, addressMissingRecipient } from './AddressManager';

const listAddresses = vi.fn();
const createAddress = vi.fn();
const updateAddress = vi.fn();
const deleteAddress = vi.fn();
vi.mock('@/lib/api', () => ({
  listAddresses: () => listAddresses(),
  createAddress: (...a: unknown[]) => createAddress(...a),
  updateAddress: (...a: unknown[]) => updateAddress(...a),
  deleteAddress: (...a: unknown[]) => deleteAddress(...a),
}));

const withName: AddressDTO = {
  id: 'a-1',
  recipientName: 'Ana López',
  line1: 'Av. Reforma 222',
  city: 'CDMX',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5555123456',
  isDefault: true,
};
const legacy: AddressDTO = { ...withName, id: 'a-old', recipientName: null, isDefault: false, line1: 'Calle Vieja 1' };

function fillRequired() {
  fireEvent.change(screen.getByLabelText('Calle y número'), { target: { value: 'Calle 5 de Mayo 10' } });
  fireEvent.change(screen.getByLabelText('Ciudad'), { target: { value: 'Puebla' } });
  fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'Puebla' } });
  fireEvent.change(screen.getByLabelText('Código postal'), { target: { value: '72000' } });
  fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '2221234567' } });
}

/** v1.67 (M-52, DESIGN_SYSTEM §33.10a): destinatario en la dirección, «Editar» y la marca de fila vieja. */
describe('AddressManager · recipientName, editar y filas sin destinatario', () => {
  beforeEach(() => {
    listAddresses.mockReset();
    createAddress.mockReset();
    updateAddress.mockReset();
    deleteAddress.mockReset();
  });

  it('addressMissingRecipient: null / vacío ⇒ true', () => {
    expect(addressMissingRecipient({ recipientName: null })).toBe(true);
    expect(addressMissingRecipient({ recipientName: '  ' })).toBe(true);
    expect(addressMissingRecipient({ recipientName: 'Ana' })).toBe(false);
  });

  it('la fila con nombre pinta «Recibe: {name}»; la fila vieja pinta «Falta el nombre de quien recibe» + «Completar»', async () => {
    listAddresses.mockResolvedValue([withName, legacy]);
    renderWithProviders(<AddressManager />, 'es');
    expect(await screen.findByText('Recibe: Ana López')).toBeInTheDocument();
    expect(screen.getByText('Falta el nombre de quien recibe')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completar' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(2);
  });

  it('el alta exige el destinatario (primer campo) y lo manda en el POST', async () => {
    listAddresses.mockResolvedValue([]);
    createAddress.mockResolvedValue({ ...withName, id: 'a-new' });
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Nueva dirección' })).toBeInTheDocument();
    // Orden: el destinatario va antes que «Calle y número» (§33.10a).
    const labels = Array.from(dialog.querySelectorAll('label')).map((l) => l.textContent);
    expect(labels.indexOf('Nombre de quien recibe')).toBeLessThan(labels.indexOf('Calle y número'));
    fillRequired();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findAllByText('Campo requerido')).not.toHaveLength(0);
    expect(createAddress).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nombre de quien recibe'), { target: { value: '  Ana López ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(createAddress).toHaveBeenCalledTimes(1));
    expect(createAddress.mock.calls[0][0]).toMatchObject({ recipientName: 'Ana López', line1: 'Calle 5 de Mayo 10', country: 'MX' });
  });

  it('defaultRecipientName prellena el alta (solo si quien monta lo decide: nameSource !== derived)', async () => {
    listAddresses.mockResolvedValue([]);
    renderWithProviders(<AddressManager defaultRecipientName="Juan Pérez" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    expect(await screen.findByLabelText('Nombre de quien recibe')).toHaveValue('Juan Pérez');
  });

  it('«Completar» abre «Editar dirección» con el foco en el destinatario y guarda con PATCH', async () => {
    listAddresses.mockResolvedValue([legacy]);
    updateAddress.mockResolvedValue({ ...legacy, recipientName: 'Tía Rosa' });
    renderWithProviders(<AddressManager />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Completar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Editar dirección' })).toBeInTheDocument();
    const recipient = within(dialog).getByLabelText('Nombre de quien recibe');
    await waitFor(() => expect(recipient).toHaveFocus());
    // El resto viene prellenado de la fila.
    expect(within(dialog).getByLabelText('Calle y número')).toHaveValue('Calle Vieja 1');
    fireEvent.change(recipient, { target: { value: 'Tía Rosa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(updateAddress).toHaveBeenCalledWith('a-old', expect.objectContaining({ recipientName: 'Tía Rosa' })));
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('con hideTitle no repite el eyebrow «Direcciones de envío»', async () => {
    listAddresses.mockResolvedValue([]);
    renderWithProviders(<AddressManager hideTitle />, 'es');
    await screen.findByRole('button', { name: 'Agregar' });
    expect(screen.queryByText('Direcciones de envío')).not.toBeInTheDocument();
  });
});
