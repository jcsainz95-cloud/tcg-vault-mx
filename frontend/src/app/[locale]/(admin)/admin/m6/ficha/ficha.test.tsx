import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M6View } from '../M6View';
import * as notesApi from '@/lib/api/customer-file';

const roleState = { isSuperAdmin: false };
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: roleState.isSuperAdmin ? 'super_admin' : 'vault_operator', setRole: () => {}, isSuperAdmin: roleState.isSuperAdmin, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m6',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

async function openFicha() {
  renderWithProviders(<M6View />, 'es');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
  return screen.findByRole('dialog', { name: /Ficha 360/ });
}

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.isSuperAdmin = false;
});

describe('Ficha A · totales para el operador', () => {
  it('vault_operator ve Compras y Ventas con importes (HECHOS 2026-11-22)', async () => {
    const dialog = await openFicha();
    expect(await within(dialog).findByTestId('strip-purchases')).toHaveTextContent(/\$\s?3,630\.00/);
    expect(within(dialog).getByTestId('strip-sales')).toHaveTextContent(/\$\s?4,200\.00/);
  });
});

describe('Ficha A · NotesPanel', () => {
  it('sin canEdit no hay Editar/Borrar; con canEdit sí; fijar lo ve cualquiera', async () => {
    const dialog = await openFicha();
    const items = await within(dialog).findAllByTestId('note-item');
    expect(items).toHaveLength(2);
    const [mine, other] = items;
    expect(within(mine).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: 'Borrar' })).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();
    expect(within(other).getByRole('button', { name: /Fijar/ })).toBeInTheDocument();
  });

  it('crea con clientRequestId, y el contador/tope es de 1000 caracteres', async () => {
    const spy = vi.spyOn(notesApi, 'createAdminUserNote');
    const dialog = await openFicha();
    const box = await within(dialog).findByLabelText('Nueva nota');
    fireEvent.change(box, { target: { value: 'x'.repeat(1001) } });
    expect(within(dialog).getByText('Máximo 1000 caracteres.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Agregar nota' })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'Llamar el lunes' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar nota' }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const arg = spy.mock.calls[0][1];
    expect(arg.body).toBe('Llamar el lunes');
    expect(arg.clientRequestId).toMatch(/^[0-9a-f-]{20,}$/i);
  });

  it('una nota con <script> se pinta como texto, no como HTML', async () => {
    const dialog = await openFicha();
    const box = await within(dialog).findByLabelText('Nueva nota');
    fireEvent.change(box, { target: { value: '<script>alert(1)</script><b>hola</b>' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Agregar nota' }));
    const body = await within(dialog).findByText('<script>alert(1)</script><b>hola</b>');
    expect(body.querySelector('script, b')).toBeNull();
    expect(dialog.querySelector('[data-testid="note-body"] script')).toBeNull();
  });

  it('borrar pide confirmación y llama al servidor', async () => {
    const spy = vi.spyOn(notesApi, 'deleteAdminUserNote');
    const dialog = await openFicha();
    const mine = (await within(dialog).findAllByTestId('note-item'))[0];
    fireEvent.click(within(mine).getByRole('button', { name: 'Borrar' }));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(mine).getByRole('button', { name: 'Sí, borrar' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u-777', 'note-1'));
  });
});

describe('Ficha A · celular en M6', () => {
  it('el operador ve el celular pero no puede editarlo', async () => {
    const dialog = await openFicha();
    const field = await within(dialog).findByTestId('phone-field');
    expect(field).toHaveTextContent(/55.*4821.*4739/);
    expect(within(field).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('el súper-admin edita: rechaza menos de 10 dígitos y guarda uno válido normalizado', async () => {
    roleState.isSuperAdmin = true;
    const spy = vi.spyOn(notesApi, 'updateAdminUserPhone');
    const dialog = await openFicha();
    const field = await within(dialog).findByTestId('phone-field');
    fireEvent.click(within(field).getByRole('button', { name: 'Editar' }));
    const input = await within(dialog).findByLabelText(/Celular de/);
    fireEvent.change(input, { target: { value: '55 1234' } });
    expect(within(dialog).getByText('Escribe un celular de 10 dígitos')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '+52 55-1234-5678' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('u-777', '5512345678'));
  });
});
