import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M6View } from './M6View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

// El alta de usuario y varias acciones exigen super_admin (patrón useRole). Sin RoleProvider
// el contexto por defecto es isSuperAdmin=false; lo fijamos a true para ejercer el flujo.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M6View · Usuarios / KYC', () => {
  it('renderiza la tabla de usuarios desde la API', async () => {
    renderWithProviders(<M6View />, 'es');
    expect(screen.getByRole('heading', { level: 1, name: /Usuarios/ })).toBeInTheDocument();
    expect((await screen.findAllByText('Ana López')).length).toBeGreaterThan(0);
  });

  it('filtra por búsqueda (q) sobre correo/nombre', async () => {
    renderWithProviders(<M6View />, 'es');
    await screen.findAllByText('Ana López');
    fireEvent.change(screen.getByLabelText('Buscar (correo o nombre)'), { target: { value: 'bruno' } });
    await waitForRemoved();
    expect((await screen.findAllByText('Bruno Díaz')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Ana López')).not.toBeInTheDocument();
  });

  it('abre la ficha 360° con CLABE enmascarada', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[0]);
    expect(await screen.findByRole('dialog', { name: /Ficha 360/ })).toBeInTheDocument();
    // CLABE enmascarada del usuario u-777 (contrato §3.4).
    expect(await screen.findByText('****1234')).toBeInTheDocument();
  });

  it('el form de KYC refleja el usuario cargado y no arrastra estado al cambiar de usuario', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });

    // Ana (u-777) está 'verified': el Select debe reflejarlo tras cargar el detalle.
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    const statusSelect = () => screen.getByLabelText('Estado KYC') as HTMLSelectElement;
    await waitFor(() => expect(statusSelect().value).toBe('verified'));

    // El admin teclea un borrador de tope para Ana pero NO guarda.
    fireEvent.change(screen.getByLabelText('Tope por solicitud'), { target: { value: '4500' } });
    expect((screen.getByLabelText('Tope por solicitud') as HTMLInputElement).value).toBe('4500');

    // Abre Bruno (u-778, 'none'): el form debe reflejar a Bruno, sin arrastrar el borrador de Ana.
    fireEvent.click(viewButtons[1]);
    await waitFor(() => expect(statusSelect().value).toBe('none'));
    expect((screen.getByLabelText('Tope por solicitud') as HTMLInputElement).value).toBe('');
  });

  it('guardar sin tocar el estado NO degrada el kycStatus cargado', async () => {
    const spy = vi.spyOn(api, 'updateUserKyc');
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });

    // Abre Ana (verified) y ajusta SOLO un tope, sin tocar el estado KYC.
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    await waitFor(() =>
      expect((screen.getByLabelText('Estado KYC') as HTMLSelectElement).value).toBe('verified'),
    );
    fireEvent.change(screen.getByLabelText('Tope por solicitud'), { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar KYC' }));

    // El payload debe conservar el kycStatus del servidor ('verified'), nunca 'none'.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('u-777', {
      kycStatus: 'verified',
      capPerRequestCents: 450000,
      capPerMonthCents: undefined,
    });
  });

  // ---- Reset de contraseña (v1.3.1): temp password una sola vez ----
  it('el reset de contraseña muestra la temporal UNA sola vez y desaparece al cerrar', async () => {
    vi.spyOn(api, 'resetUserPassword').mockResolvedValue({
      userId: 'u-777',
      tempPassword: 'Tmp-FIXED-9x',
      mustChangePassword: true,
    });
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });

    fireEvent.click(await screen.findByRole('button', { name: 'Restablecer contraseña' }));

    // Se muestra la temporal en claro + aviso de "una sola vez".
    expect(await screen.findByText('Tmp-FIXED-9x')).toBeInTheDocument();
    expect(screen.getByText(/UNA sola vez/)).toBeInTheDocument();

    // Al cerrar el modal, la temporal ya NO se re-muestra.
    const resetDialog = screen.getByRole('dialog', { name: 'Contraseña temporal' });
    fireEvent.click(within(resetDialog).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByText('Tmp-FIXED-9x')).not.toBeInTheDocument());
  });

  // ---- Eliminar usuario (v1.3.1): confirmación + mode + 409 self ----
  it('eliminar un usuario sin historial pide confirmación y muestra el mode hard (borrado total)', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    // Bruno (u-778) no tiene historial económico en el mock → hard.
    fireEvent.click(viewButtons[1]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar usuario' }));
    // Confirmación clara antes de borrar.
    expect(await screen.findByText(/¿Seguro que deseas eliminar/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText(/borrado total/)).toBeInTheDocument();
  });

  it('maneja 409 CANNOT_DELETE_SELF mostrando el error de auto-eliminación', async () => {
    vi.spyOn(api, 'deleteUser').mockRejectedValue(
      new ApiClientError(409, { code: 'CANNOT_DELETE_SELF', message: 'cannot delete self' }),
    );
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[1]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });

    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar usuario' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText('No puedes eliminar tu propia cuenta.')).toBeInTheDocument();
  });

  // ---- E3 · Crear usuario (POST /admin/users, super_admin) ----
  it('el super_admin ve "Crear usuario" y al autogenerar muestra la temporal UNA sola vez', async () => {
    renderWithProviders(<M6View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Crear usuario' }));

    const dialog = await screen.findByRole('dialog', { name: 'Crear usuario' });
    fireEvent.change(within(dialog).getByLabelText('Correo'), { target: { value: 'nuevo@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Nuevo Usuario' } });
    // Contraseña vacía → el backend la autogenera y la devuelve una vez.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText(/Cuenta creada para nuevo@example.com/)).toBeInTheDocument();
    // Reusa el panel de temp-password de M-15 (aviso "UNA sola vez").
    expect(screen.getByText(/UNA sola vez/)).toBeInTheDocument();
  });

  it('maneja 409 EMAIL_TAKEN con un mensaje claro', async () => {
    vi.spyOn(api, 'createAdminUser').mockRejectedValue(
      new ApiClientError(409, { code: 'EMAIL_TAKEN', message: 'email taken' }),
    );
    renderWithProviders(<M6View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Crear usuario' }));
    const dialog = await screen.findByRole('dialog', { name: 'Crear usuario' });
    fireEvent.change(within(dialog).getByLabelText('Correo'), { target: { value: 'ana@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Ya existe una cuenta con ese correo.')).toBeInTheDocument();
  });

  // ---- F3 · Pestañas de historial 360° filtradas por userId (lazy-load) ----
  it('las pestañas cargan filtradas por userId: Compras al abrir y Envíos al hacer clic', async () => {
    const ordersSpy = vi.spyOn(api, 'getAdminUserOrders');
    const shipmentsSpy = vi.spyOn(api, 'getAdminUserShipments');
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });

    // Ana (u-777): la pestaña Compras es la activa por defecto → llama al endpoint por userId.
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    await waitFor(() =>
      expect(ordersSpy).toHaveBeenCalledWith('u-777', expect.objectContaining({ page: 1 })),
    );

    // Envíos es el endpoint NUEVO (GET /admin/shipments?userId=): se carga al abrir la pestaña.
    fireEvent.click(screen.getByRole('tab', { name: 'Envíos' }));
    await waitFor(() =>
      expect(shipmentsSpy).toHaveBeenCalledWith('u-777', expect.objectContaining({ page: 1 })),
    );
  });

  // ---- BE-10 · Pestaña Bóveda enriquecida (finish + referenceValue, priced vs pending) ----
  it('la pestaña Bóveda muestra acabado + valor (priced), estado pendiente honesto y el total sin pendientes', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    // Ana (u-777): el fixture trae un item con precio (Blastoise holofoil) y otro pendiente (Pikachu reverse holo).
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });

    fireEvent.click(await screen.findByRole('tab', { name: 'Bóveda' }));

    // Acabado legible (reusa el mapeo `finish`): Holofoil del priced, Reverse Holo del pendiente.
    // (DataTable pinta tabla desktop + card mobile, de ahí findAll.)
    expect((await screen.findAllByText('Holofoil')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reverse Holo').length).toBeGreaterThan(0);

    // Valor priced formateado (Blastoise = 128000 centavos → $1,280.00); pendiente honesto, NO $0.
    expect(screen.getAllByText(/\$\s?1,280\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Precio pendiente').length).toBeGreaterThan(0);

    // Total de la bóveda = solo el priced ($1,280.00); el pendiente se excluye y se indica aparte.
    expect(screen.getByText('Valor total (con precio)')).toBeInTheDocument();
    expect(screen.getByText(/1 carta con precio pendiente/)).toBeInTheDocument();
  });

  it('la pestaña Actividad muestra el ip cuando el backend lo envía (proyección super_admin)', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });

    fireEvent.click(await screen.findByRole('tab', { name: 'Actividad' }));
    // El fixture puebla ip (proyección super_admin) → la columna IP aparece.
    // (DataTable pinta tabla desktop + card mobile, de ahí findAll.)
    expect((await screen.findAllByText('187.190.10.4')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('user.create').length).toBeGreaterThan(0);
  });
});

// Pequeña espera para que el debounce/refetch del filtro asiente.
async function waitForRemoved() {
  await new Promise((r) => setTimeout(r, 200));
}
