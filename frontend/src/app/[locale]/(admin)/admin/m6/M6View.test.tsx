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

// P-78: la ficha estrena el enlace a la pantalla de revisión (`Link` de next-intl), que en jsdom
// no resuelve `next/navigation`. Mismo mock que el resto de la suite.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin/m6',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

  /**
   * ⭐ **P-78 · candado KY-9 (DESIGN_SYSTEM §34.10.3, regla 1).** La ficha 360° **no puede tener
   * ningún control que fije `kycStatus`**. Antes tenía un `Select` con las cuatro opciones +
   * «Guardar KYC», o sea **un camino de dos clics para marcar `verified` sin haber visto un
   * documento** — y mientras ese camino exista, la pantalla de revisión es decorativa.
   *
   * Se comprueba por AUSENCIA y por PRESENCIA: ni selector de estado, ni la opción «Verificada»
   * en ningún combo de la ficha; y sí la puerta única, «Revisar identidad», apuntando a su ruta.
   */
  it('la ficha 360° NO tiene ningún control que fije el estado KYC, y sí el paso a la revisión', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    // La única puerta a la decisión de identidad, y lleva a la pantalla que enseña el documento.
    const review = await within(dialog).findByRole('button', { name: 'Revisar identidad' });

    expect(within(dialog).queryByLabelText('Estado KYC')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: 'Verificado' })).not.toBeInTheDocument();

    expect(review).toBeEnabled();
    expect(review.closest('a')).toHaveAttribute('href', '/admin/m6/kyc/u-777');
  });

  it('sin INE en el expediente, «Revisar identidad» se apaga CON el motivo a la vista', async () => {
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    // Bruno (u-778) no tiene INE en archivo en el fixture.
    fireEvent.click(viewButtons[1]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Revisar identidad' })).toBeDisabled(),
    );
    // Un botón apagado sin motivo visible es otro callejón (§27.1.4).
    expect(within(dialog).getByText('Sin INE en el expediente.')).toBeInTheDocument();
  });

  it('guardar el tope mensual NO degrada el kycStatus cargado', async () => {
    const spy = vi.spyOn(api, 'updateUserKyc');
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });

    // Abre Ana (verified) y ajusta el tope mensual, que es lo único editable aquí.
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    fireEvent.change(await screen.findByLabelText('Tope mensual'), { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar KYC' }));

    // El payload conserva el kycStatus del servidor ('verified'), nunca 'none'.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith('u-777', {
      kycStatus: 'verified',
      capPerMonthCents: 450000,
    });
  });

  /**
   * §34.10.1-2 · la COLA de revisión. Sin la columna y el filtro, nadie se entera de que hay una
   * INE esperando salvo que abra la ficha por otro motivo.
   * ⚠️ MOCK: `kycStatus` en el listado es la petición **A5** al arquitecto; el mock lo sirve.
   */
  it('el listado pinta el estado de identidad y el filtro deja llegar a la cola', async () => {
    renderWithProviders(<M6View />, 'es');
    await screen.findAllByText('Ana López');
    expect(screen.getByRole('columnheader', { name: 'Identidad' })).toBeInTheDocument();
    // u-780 espera revisión: es EL caso que motiva la columna.
    expect((await screen.findAllByText('KYC pendiente')).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Identidad'), { target: { value: 'pending' } });
    await waitFor(() => expect(screen.queryByText('Ana López')).not.toBeInTheDocument());
    expect((await screen.findAllByText('jcsainz95')).length).toBeGreaterThan(0);
  });

  /** §34.10.4 · la bitácora contesta «¿quién ha mirado la identidad de esta persona?». */
  it('la pestaña Actividad rotula los dos eventos de identidad (y deja crudo el resto)', async () => {
    vi.spyOn(api, 'getAdminUserAudit').mockResolvedValue({
      data: [
        { id: 'a1', action: 'user.kyc.reveal_ine', actorRole: 'super_admin', createdAt: '2026-09-10T10:00:00Z' },
        { id: 'a2', action: 'user.kyc.update', actorRole: 'super_admin', createdAt: '2026-09-10T10:01:00Z' },
        { id: 'a3', action: 'user.status.update', actorRole: 'super_admin', createdAt: '2026-09-10T10:02:00Z' },
      ],
      page: 1,
      pageSize: 10,
      total: 3,
    } as Awaited<ReturnType<typeof api.getAdminUserAudit>>);
    renderWithProviders(<M6View />, 'es');
    const viewButtons = await screen.findAllByRole('button', { name: 'Ver ficha' });
    fireEvent.click(viewButtons[0]);
    await screen.findByRole('dialog', { name: /Ficha 360/ });
    fireEvent.click(await screen.findByRole('tab', { name: 'Actividad' }));

    expect((await screen.findAllByText('Miró la INE')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Decidió sobre la identidad').length).toBeGreaterThan(0);
    // El resto sigue crudo: no se inventa un diccionario entero (§34.10.4).
    expect(screen.getAllByText('user.status.update').length).toBeGreaterThan(0);
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
