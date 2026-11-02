import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import type { UserDTO } from '@/types/contract';
import { AddressManager, accountAddressDefaults, type AddressManagerProps } from './AddressManager';

/** Monta el gestor y deja cambiar sus props después (como cuando `GET /users/me` responde tarde). */
let setHostProps: (p: AddressManagerProps) => void = () => {};
function Host() {
  const [props, setProps] = useState<AddressManagerProps>({});
  setHostProps = setProps;
  return <AddressManager {...props} />;
}

const listAddresses = vi.fn();
const getPostalCode = vi.fn();
vi.mock('@/lib/api', () => ({
  getPostalCode: (cp: string) => getPostalCode(cp),
  listAddresses: () => listAddresses(),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
}));

/**
 * Paquete A (dueño, `HECHOS.md` 2026-11-02 «Checkout con menos captura: paquete A…» punto (2)): al dar de alta
 * una dirección, el nombre de quien recibe y el teléfono salen de la cuenta, editables. Nombre solo si
 * `nameSource !== 'derived'` (contrato v1.67); teléfono, el de la cuenta si existe.
 */
const base: UserDTO = { id: 'u-1', email: 'ana@example.com', name: 'Ana López', role: 'customer', locale: 'es', nameSource: 'user', phone: '5512345678' };

describe('accountAddressDefaults · qué se prellena desde la cuenta', () => {
  it('nombre escrito por el cliente (user/google) y teléfono de la cuenta', () => {
    expect(accountAddressDefaults(base)).toEqual({ defaultRecipientName: 'Ana López', defaultPhone: '5512345678' });
    expect(accountAddressDefaults({ ...base, nameSource: 'google' }).defaultRecipientName).toBe('Ana López');
  });
  it('⛔ nombre derivado del correo ⇒ sin nombre; sin teléfono ⇒ sin teléfono; sin usuario ⇒ nada', () => {
    expect(accountAddressDefaults({ ...base, nameSource: 'derived', phone: undefined })).toEqual({
      defaultRecipientName: undefined,
      defaultPhone: undefined,
    });
    expect(accountAddressDefaults({ ...base, name: '   ' }).defaultRecipientName).toBeUndefined();
    expect(accountAddressDefaults(null)).toEqual({ defaultRecipientName: undefined, defaultPhone: undefined });
  });
});

describe('AddressManager · prellenado del alta desde la cuenta', () => {
  beforeEach(() => {
    listAddresses.mockReset();
    listAddresses.mockResolvedValue([]);
    getPostalCode.mockReset();
    getPostalCode.mockRejectedValue(new ApiClientError(404, { code: 'POSTAL_CODE_UNKNOWN', message: 'x' }));
  });

  it('defaultPhone prellena el teléfono del alta, y se puede editar', async () => {
    renderWithProviders(<AddressManager defaultRecipientName="Ana López" defaultPhone="5512345678" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Nombre de quien recibe')).toHaveValue('Ana López');
    const phone = within(dialog).getByLabelText('Teléfono');
    expect(phone).toHaveValue('5512345678');
    fireEvent.change(phone, { target: { value: '3331234567' } });
    expect(phone).toHaveValue('3331234567');
  });

  it('los datos de la cuenta que llegan DESPUÉS de montar (GET /users/me) también prellenan, sin pisar lo escrito', async () => {
    renderWithProviders(<Host />, 'es');
    await screen.findByRole('button', { name: 'Agregar' });
    act(() => setHostProps({ defaultRecipientName: 'Ana López', defaultPhone: '5512345678' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Nombre de quien recibe')).toHaveValue('Ana López');
    expect(within(dialog).getByLabelText('Teléfono')).toHaveValue('5512345678');

    // Lo que el cliente ya escribió no se pisa si la cuenta cambia después.
    fireEvent.change(within(dialog).getByLabelText('Teléfono'), { target: { value: '3331234567' } });
    act(() => setHostProps({ defaultRecipientName: 'Ana María López', defaultPhone: '5599999999' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('Teléfono')).toHaveValue('3331234567');
    expect(within(screen.getByRole('dialog')).getByLabelText('Nombre de quien recibe')).toHaveValue('Ana López');
  });
});
