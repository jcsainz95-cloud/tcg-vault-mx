import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/render';
import { M6View } from './M6View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { formatTimeMx } from '@/lib/format';
import type { AdminUserDetailDTO, AdminUserSummaryDTO, AdminUsersListResponse } from '@/types/contract';

/**
 * **Usuarios · equipo sin correo** (`PROJECT §U`, criterios 256/257/260/261/265/268; `API_CONTRACT §M6-U.6–U.7`;
 * `DESIGN_SYSTEM §42.3–42.5`). Candados UX-6 (cuerpo por tipo), UX-7 (errores del usuario bajo el campo),
 * UX-8 = STF-27 front (identificador `email ?? username`), UX-9 (marca de candado) y UX-10 (el reset refresca).
 */

vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
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

beforeEach(() => {
  vi.restoreAllMocks();
});

const IN_30_MIN = () => new Date(Date.now() + 30 * 60_000).toISOString();
const TEN_MIN_AGO = () => new Date(Date.now() - 10 * 60_000).toISOString();

function row(over: Partial<AdminUserSummaryDTO>): AdminUserSummaryDTO {
  return {
    id: 'u-x',
    email: 'x@example.com',
    username: null,
    lockedUntil: null,
    name: 'X',
    role: 'customer',
    status: 'active',
    createdAt: '2026-10-01T10:00:00Z',
    ...over,
  };
}

function listing(rows: AdminUserSummaryDTO[], lockState: 'ok' | 'unavailable' = 'ok'): AdminUsersListResponse {
  return { data: rows, page: 1, pageSize: 20, total: rows.length, lockState };
}

const ANA = row({ id: 'u-ana', email: null, username: 'ana', name: 'Ana Operadora', role: 'vault_operator' });

async function openCreate() {
  fireEvent.click(await screen.findByRole('button', { name: 'Crear usuario' }));
  return screen.findByRole('dialog', { name: 'Crear usuario' });
}

function chooseKind(dialog: HTMLElement, name: 'Cliente' | 'Equipo') {
  fireEvent.click(within(dialog).getByRole('radio', { name }));
}

describe('UX-6 · alta Cliente/Equipo: el cuerpo se arma por tipo', () => {
  it('por defecto Cliente (el alta de hoy); Equipo quita el correo y el rol de cliente', async () => {
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    expect(within(dialog).getByRole('group', { name: 'Tipo de cuenta' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Cliente' })).toBeChecked();
    expect(within(dialog).getByLabelText('Correo')).toHaveAttribute('type', 'email');
    // Cliente: rol fijo `customer`, sin selector de rol.
    expect(within(dialog).queryByLabelText('Rol')).not.toBeInTheDocument();

    chooseKind(dialog, 'Equipo');
    expect(within(dialog).getByRole('radio', { name: 'Equipo' })).toBeChecked();
    // ⛔ El DOM de Equipo no tiene campo de correo.
    expect(within(dialog).queryByLabelText('Correo')).not.toBeInTheDocument();
    expect(dialog.querySelector('input[type="email"]')).toBeNull();
    expect(within(dialog).getByText(/Las cuentas del equipo no llevan correo/)).toBeInTheDocument();
    const roleSelect = within(dialog).getByLabelText('Rol') as HTMLSelectElement;
    expect(Array.from(roleSelect.options).map((o) => o.value)).toEqual(['vault_operator', 'super_admin']);
    expect(roleSelect.value).toBe('vault_operator');
  });

  it('Equipo manda `username` y ⛔ NUNCA la clave `email`', async () => {
    const spy = vi.spyOn(api, 'createAdminUser').mockResolvedValue({
      user: {
        id: 'u-new', email: null, username: 'luis.p', name: 'Luis', role: 'vault_operator', locale: 'es',
        status: 'active', emailVerified: false, authProvider: 'local', createdAt: '2026-10-04T10:00:00Z',
      },
      tempPassword: 'Temp-Abc-123',
      mustChangePassword: true,
    });
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    chooseKind(dialog, 'Equipo');
    fireEvent.change(within(dialog).getByLabelText('Nombre de usuario'), { target: { value: 'luis.p' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Luis' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect('email' in body).toBe(false);
    expect(body).toEqual({ username: 'luis.p', name: 'Luis', role: 'vault_operator', password: undefined });

    // §42.3.5: el resultado dice el usuario y por dónde entra; la temporal UNA sola vez.
    expect(
      await screen.findByText(
        'Cuenta de equipo creada: usuario luis.p, rol Operador de bóveda. Entra por la pantalla de «Iniciar sesión» de siempre, con su usuario y su contraseña.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Temp-Abc-123')).toBeInTheDocument();
  });

  it('Equipo con contraseña tecleada ⇒ nota de equipo (tendrá que cambiarla)', async () => {
    vi.spyOn(api, 'createAdminUser').mockResolvedValue({
      user: {
        id: 'u-new', email: null, username: 'op_2', name: 'Op', role: 'super_admin', locale: 'es',
        status: 'active', emailVerified: false, authProvider: 'local', createdAt: '2026-10-04T10:00:00Z',
      },
      mustChangePassword: true,
    });
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    chooseKind(dialog, 'Equipo');
    fireEvent.change(within(dialog).getByLabelText('Nombre de usuario'), { target: { value: 'op_2' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Op' } });
    fireEvent.change(within(dialog).getByLabelText('Rol'), { target: { value: 'super_admin' } });
    expect(within(dialog).getByText(/Sea cual sea, la tendrá que cambiar/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Contraseña'), { target: { value: 'una-larga-123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(
      await screen.findByText('Dale la contraseña que definiste por un canal seguro. Al entrar por primera vez tendrá que cambiarla.'),
    ).toBeInTheDocument();
  });

  it('Cliente manda `email` y ⛔ NUNCA la clave `username`', async () => {
    const spy = vi.spyOn(api, 'createAdminUser');
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('Correo'), { target: { value: 'nuevo@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Nuevo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect('username' in body).toBe(false);
    expect(body).toMatchObject({ email: 'nuevo@example.com', role: 'customer' });
  });

  it('cambiar de tipo vacía el identificador del otro tipo', async () => {
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    fireEvent.change(within(dialog).getByLabelText('Correo'), { target: { value: 'a@b.com' } });
    chooseKind(dialog, 'Equipo');
    expect(within(dialog).getByLabelText('Nombre de usuario')).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText('Nombre de usuario'), { target: { value: 'ana' } });
    chooseKind(dialog, 'Cliente');
    expect(within(dialog).getByLabelText('Correo')).toHaveValue('');
    chooseKind(dialog, 'Equipo');
    expect(within(dialog).getByLabelText('Nombre de usuario')).toHaveValue('');
  });

  it('«Crear» se apaga sin usuario o sin nombre; la regla siempre visible y la vista previa en minúsculas', async () => {
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    chooseKind(dialog, 'Equipo');
    const create = within(dialog).getByRole('button', { name: 'Crear' });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Luis' } });
    expect(create).toBeDisabled();
    const input = within(dialog).getByLabelText('Nombre de usuario');
    expect(within(dialog).getByText(/De 3 a 30 caracteres/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Luis.P' } });
    expect(create).toBeEnabled();
    expect(within(dialog).getByText(/Se guardará como «luis\.p»\./)).toBeInTheDocument();
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });
});

describe('UX-7 · errores del usuario: cinco textos distintos bajo el campo', () => {
  const cases: [string, ApiClientError, string][] = [
    ['required', new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'username', rule: 'required' } }), 'Escribe un nombre de usuario.'],
    ['length', new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'username', rule: 'length' } }), 'Debe tener de 3 a 30 caracteres.'],
    ['charset', new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'username', rule: 'charset' } }), 'Solo letras a–z sin acentos ni ñ, números, punto (.), guion (-) y guion bajo (_). Sin espacios ni @.'],
    ['start', new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'username', rule: 'start' } }), 'Tiene que empezar con una letra.'],
    ['USERNAME_TAKEN', new ApiClientError(409, { code: 'USERNAME_TAKEN', message: 'x' }), 'Ese nombre de usuario ya existe (sin importar mayúsculas). Elige otro.'],
  ];

  it.each(cases)('%s ⇒ su texto bajo el campo, `aria-invalid` y foco', async (_rule, err, text) => {
    vi.spyOn(api, 'createAdminUser').mockRejectedValue(err);
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    chooseKind(dialog, 'Equipo');
    const input = within(dialog).getByLabelText('Nombre de usuario');
    fireEvent.change(input, { target: { value: '1ab' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Luis' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));

    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(text);
    expect(input).toHaveFocus();
    // ⛔ No se manda además al banner genérico.
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('los cinco textos son distintos entre sí', () => {
    expect(new Set(cases.map((c) => c[2])).size).toBe(5);
  });

  it('otro 422 del equipo (contraseña) ⇒ banner `errorValidationStaff`, el campo de usuario sin error', async () => {
    vi.spyOn(api, 'createAdminUser').mockRejectedValue(
      new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'password' } }),
    );
    renderWithProviders(<M6View />, 'es');
    const dialog = await openCreate();
    chooseKind(dialog, 'Equipo');
    fireEvent.change(within(dialog).getByLabelText('Nombre de usuario'), { target: { value: 'luis' } });
    fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'Luis' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Revisa los datos: nombre, rol de equipo y contraseña de al menos 8 caracteres.',
    );
    expect(within(dialog).getByLabelText('Nombre de usuario')).not.toHaveAttribute('aria-invalid');
  });
});

describe('UX-8 = STF-27 (front) · el identificador es `email ?? username`', () => {
  it('fila con `email: null, username: "ana"` pinta «ana»; ni `null`, ni `undefined`, ni celda vacía', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue(listing([ANA, row({ id: 'u-c', email: 'c@example.com', name: 'Cliente C' })]));
    const { container } = renderWithProviders(<M6View />, 'es');
    await screen.findAllByText('Ana Operadora');
    expect(screen.getAllByRole('columnheader', { name: 'Correo o usuario' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ana').length).toBeGreaterThan(0);
    expect(screen.getAllByText('c@example.com').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bnull\b|\bundefined\b/);
    // La columna del identificador no tiene ninguna celda vacía.
    const table = container.querySelector('table')!;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent);
    const col = headers.indexOf('Correo o usuario');
    expect(col).toBeGreaterThanOrEqual(0);
    for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
      expect(tr.querySelectorAll('td')[col].textContent?.trim()).not.toBe('');
    }
  });

  it('la ficha de una cuenta sin correo dice «Usuario: ana»', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue(listing([ANA]));
    vi.spyOn(api, 'getAdminUser').mockResolvedValue({ ...ANA, ownedItems: [] } as AdminUserDetailDTO);
    renderWithProviders(<M6View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    expect(await within(dialog).findByText('Usuario: ana')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/\bnull\b|\bundefined\b/);
  });

  it('la búsqueda se rotula con «usuario»', async () => {
    renderWithProviders(<M6View />, 'es');
    expect(screen.getByLabelText('Buscar (correo, usuario o nombre)')).toBeInTheDocument();
  });
});

describe('UX-9 · marca «Bloqueado por intentos hasta HH:MM»', () => {
  it('`lockedUntil` en el futuro ⇒ marca con la hora de CDMX; en el pasado o `null` ⇒ sin marca', async () => {
    const future = IN_30_MIN();
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue(
      listing([
        { ...ANA, lockedUntil: future },
        row({ id: 'u-past', name: 'Pasado', email: 'p@example.com', lockedUntil: TEN_MIN_AGO() }),
        row({ id: 'u-none', name: 'Nadie', email: 'n@example.com' }),
      ]),
    );
    renderWithProviders(<M6View />, 'es');
    await screen.findAllByText('Ana Operadora');
    const expected = `Bloqueado por intentos hasta ${formatTimeMx(future, 'es')}`;
    const marks = screen.getAllByTestId('lock-mark');
    // DataTable pinta tabla + tarjeta móvil: la marca de Ana sale en las dos, y SOLO la de Ana.
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m).toHaveTextContent(expected);
    const table = document.querySelector('table')!;
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows.filter((tr) => tr.querySelector('[data-testid="lock-mark"]')).map((tr) => tr.textContent)).toEqual([
      expect.stringContaining('Ana Operadora'),
    ]);
    // Es un estado distinto de «Bloqueada»: la marca no la pinta.
    expect(within(table).queryByText('Bloqueada')).not.toBeInTheDocument();
    expect(screen.queryByText(/no pudimos consultar/)).not.toBeInTheDocument();
  });

  it('`lockState: "unavailable"` ⇒ aviso informativo y CERO marcas (aunque una fila trajera hora)', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue(listing([{ ...ANA, lockedUntil: IN_30_MIN() }], 'unavailable'));
    renderWithProviders(<M6View />, 'es');
    await screen.findAllByText('Ana Operadora');
    expect(
      screen.getByText(
        'Ahora no pudimos consultar quién está bloqueado por intentos, así que esta lista no lo marca. Vuelve a cargarla en un momento.',
      ).closest('[role="status"]'),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('lock-mark')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/sin candado/i);
  });

  it('la ficha con candado vigente lleva la marca y la pista de cómo quitarlo', async () => {
    const until = IN_30_MIN();
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue(listing([{ ...ANA, lockedUntil: until }]));
    vi.spyOn(api, 'getAdminUser').mockResolvedValue({ ...ANA, lockedUntil: until, ownedItems: [] } as AdminUserDetailDTO);
    renderWithProviders(<M6View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    expect(await within(dialog).findByTestId('lock-mark')).toHaveTextContent(formatTimeMx(until, 'es'));
    expect(within(dialog).getByText('Se quita solo a esa hora. Para quitarlo antes, restablece la contraseña.')).toBeInTheDocument();
  });
});

describe('UX-10 · el restablecimiento refresca la marca', () => {
  it('tras el reset se invalidan `["admin-users"]` y `["admin-user", id]`; el texto dice que no va correo', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue(listing([{ ...ANA, lockedUntil: IN_30_MIN() }]));
    vi.spyOn(api, 'getAdminUser').mockResolvedValue({ ...ANA, ownedItems: [] } as AdminUserDetailDTO);
    vi.spyOn(api, 'resetUserPassword').mockResolvedValue({ userId: 'u-ana', tempPassword: 'T-1', mustChangePassword: true });
    renderWithProviders(<M6View />, 'es');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver ficha' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: /Ficha 360/ });
    expect(await within(dialog).findByText(/No se manda ningún correo\./)).toBeInTheDocument();
    invalidate.mockClear();
    fireEvent.click(within(dialog).getByRole('button', { name: /Restablecer contraseña/ }));
    await screen.findByText('T-1');
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey);
    expect(keys).toContainEqual(['admin-users']);
    expect(keys).toContainEqual(['admin-user', 'u-ana']);
  });
});
