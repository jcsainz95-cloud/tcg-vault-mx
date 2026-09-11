import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setStoredUser } from '@/lib/session';
import type { UserDTO } from '@/types/contract';
import { AccountView, sectionsForRole } from './AccountView';

const push = vi.fn();
const replace = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/account',
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// La vista habla con `getMe`/`updateMe` (y las secciones del cliente con libreta/facturación/KYC).
const getMe = vi.fn();
const updateMe = vi.fn();
vi.mock('@/lib/api', () => ({
  getMe: () => getMe(),
  updateMe: (...a: unknown[]) => updateMe(...a),
  logout: vi.fn().mockResolvedValue(undefined),
  listAddresses: vi.fn().mockResolvedValue([]),
  createAddress: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  getBillingProfile: vi.fn().mockResolvedValue(null),
  putBillingProfile: vi.fn(),
  getKyc: vi.fn().mockResolvedValue({ kycStatus: 'none', clabeOnFile: false, ineOnFile: false, capPerRequestCents: 300000, capPerMonthCents: 1000000, monthUsedCents: 0 }),
  updateKyc: vi.fn(),
  resendVerificationEmail: vi.fn(),
  forgotPassword: vi.fn(),
  changePassword: vi.fn(),
}));

const customer: UserDTO = {
  id: 'u-1',
  email: 'jcsainz95@gmail.com',
  name: 'jcsainz95',
  role: 'customer',
  locale: 'es',
  authProvider: 'google',
  emailVerified: true,
  hasPassword: false,
  mustChangePassword: false,
  nameSource: 'derived',
};
const operator: UserDTO = {
  id: 'u-2',
  email: 'op@tcghunt.mx',
  name: 'Operador',
  role: 'vault_operator',
  locale: 'es',
  authProvider: 'local',
  emailVerified: true,
  hasPassword: true,
  mustChangePassword: false,
  nameSource: 'user',
};

function sectionIds() {
  return Array.from(document.querySelectorAll('section[data-account-section]')).map((s) => s.id);
}

describe('AccountView · un componente, dos puertas (DESIGN_SYSTEM §33.5/§33.6)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getMe.mockReset();
    updateMe.mockReset();
    push.mockClear();
    replace.mockClear();
  });

  it('sectionsForRole: el staff ve a, b, f, g y NO c, d, e (CA-10)', () => {
    expect(sectionsForRole(true)).toEqual(['profile', 'email', 'password', 'session']);
    expect(sectionsForRole(false)).toEqual(['profile', 'email', 'addresses', 'billing', 'kyc', 'password', 'session']);
  });

  it('CA-10: vault_operator en /admin/account ve perfil, correo, contraseña y sesión, sin libreta, CFDI ni KYC', async () => {
    setStoredUser(operator);
    getMe.mockResolvedValue(operator);
    renderWithProviders(<AccountView surface="admin" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' });
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(sectionIds()).toEqual(['profile', 'email', 'password', 'session']);
    expect(screen.queryByText('Direcciones de envío')).not.toBeInTheDocument();
    expect(screen.queryByText('Facturación (CFDI)')).not.toBeInTheDocument();
    expect(screen.queryByText('Verificación de identidad')).not.toBeInTheDocument();
    // El staff no reenvía verificación (su cuenta la dio de alta el admin).
    expect(screen.queryByRole('button', { name: /Reenviar correo/ })).not.toBeInTheDocument();
  });

  it('customer ve las siete secciones en orden y el correo (no el nombre) bajo el título', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' });
    await waitFor(() => expect(sectionIds()).toEqual(['profile', 'email', 'addresses', 'billing', 'kyc', 'password', 'session']));
    // El índice pegajoso es un <nav aria-label="Secciones"> con un enlace por sección.
    const index = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(index).getAllByRole('link')).toHaveLength(7);
    // h1 → h2 sin saltos.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(7);
    // El correo se pinta como subtítulo (regla 2: no el nombre).
    expect(screen.getAllByText('jcsainz95@gmail.com').length).toBeGreaterThan(0);
  });

  it('CA-9: nameSource=derived ⇒ aviso enlazado por aria-describedby y «Guardar» habilitado sin cambios; tras PATCH ⇒ ausente', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    updateMe.mockImplementation(async () => {
      // Como el servidor: tras el PATCH, el siguiente GET /users/me ya trae `nameSource='user'`.
      const patched = { ...customer, name: 'Juan Carlos Sainz', nameSource: 'user' as const };
      getMe.mockResolvedValue(patched);
      return patched;
    });
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    const name = await screen.findByLabelText('Nombre');
    await waitFor(() => expect(screen.getByTestId('name-derived-note')).toBeInTheDocument());
    expect(name).toHaveAccessibleDescription(
      /Así te llamamos en los correos y en tus envíos\. Este nombre lo tomamos de tu correo porque Google no nos dio tu nombre\./,
    );
    const save = screen.getAllByRole('button', { name: 'Guardar' })[0];
    expect(save).toBeEnabled();

    fireEvent.change(name, { target: { value: 'Juan Carlos Sainz' } });
    fireEvent.click(save);
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith({ name: 'Juan Carlos Sainz' }));
    await waitFor(() => expect(screen.queryByTestId('name-derived-note')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('GUARDADO');
  });

  it('nameSource=user ⇒ sin aviso y «Guardar» deshabilitado hasta que haya cambios', async () => {
    const u = { ...customer, name: 'Ana', nameSource: 'user' as const };
    setStoredUser(u);
    getMe.mockResolvedValue(u);
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    const name = await screen.findByLabelText('Nombre');
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.queryByTestId('name-derived-note')).not.toBeInTheDocument();
    const save = screen.getAllByRole('button', { name: 'Guardar' })[0];
    expect(save).toBeDisabled();
    fireEvent.change(name, { target: { value: 'Ana López' } });
    expect(save).toBeEnabled();
  });

  it('nombre vacío ⇒ «Escribe tu nombre.» sin llamar a la API', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    const name = await screen.findByLabelText('Nombre');
    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Guardar' })[0]);
    expect(await screen.findByText('Escribe tu nombre.')).toBeInTheDocument();
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('cuenta solo-Google (hasPassword=false): la sección de contraseña NO tiene formulario; ofrece «Crear contraseña» hacia /account/password', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' });
    await waitFor(() => expect(screen.getByText('Entras con Google y tu cuenta no tiene contraseña.')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Crear contraseña' })).toHaveAttribute('href', '/account/password');
    expect(screen.queryByLabelText('Contraseña actual')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña nueva')).not.toBeInTheDocument();
  });

  it('cuenta con contraseña: «Cambiar contraseña» hacia la página de contraseña del rol', async () => {
    setStoredUser(operator);
    getMe.mockResolvedValue(operator);
    renderWithProviders(<AccountView surface="admin" />, 'es');
    expect(await screen.findByRole('link', { name: 'Cambiar contraseña' })).toHaveAttribute('href', '/admin/account/password');
  });

  it('correo sin verificar (customer): pill SIN VERIFICAR + reenvío; el correo no es editable y la nota lleva mailto', async () => {
    const u = { ...customer, emailVerified: false };
    setStoredUser(u);
    getMe.mockResolvedValue(u);
    renderWithProviders(<AccountView surface="storefront" />, 'es');
    expect(await screen.findByText('SIN VERIFICAR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reenviar correo de verificación' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Correo' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'soporte@tcghunt.mx' })).toHaveAttribute('href', 'mailto:soporte@tcghunt.mx');
  });

  it('«Cerrar sesión» vive en la sección Sesión: cliente → push("/"), panel → replace("/login")', async () => {
    setStoredUser(customer);
    getMe.mockResolvedValue(customer);
    const { unmount } = renderWithProviders(<AccountView surface="storefront" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    unmount();

    setStoredUser(operator);
    getMe.mockResolvedValue(operator);
    renderWithProviders(<AccountView surface="admin" />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
