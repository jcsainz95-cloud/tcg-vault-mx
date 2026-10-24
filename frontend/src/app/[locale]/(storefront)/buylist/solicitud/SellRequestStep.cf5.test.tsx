import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { setStoredUser } from '@/lib/session';
import { isMeasuredPath } from '@/lib/measurement/routes';
import type { KycInfoDTO } from '@/types/contract';
import { BuylistView } from '../BuylistView';
import { SellRequestStepView } from './SellRequestStepView';
import { SELL_REQUEST_STEP_PATH, goToSellRequestStep, sellRequestStepHref } from '../request-step';

/**
 * C-F5 ampliado (API_CONTRACT §MKT.H.11, v1.109) · ARCHITECTURE §14.4 D-MKT2-8 — mitad de UNIDAD.
 * «La medición nunca se carga donde haya CLABE/INE»: `/buylist` se mide, así que su documento no puede pintar
 * `BuylistKycForm`; el paso de crear vive en `/buylist/solicitud` (excluida) y se llega con navegación DURA.
 * La mitad de navegador (con la medición encendida) es `e2e/measurement-on.spec.ts` («C-F5 · /buylist → paso»).
 *
 * Canarios: pintar `BuylistKycForm` dentro de `BuylistView` ⇒ rojo («el documento del cotizador…»);
 * navegar con el router en vez de `location.assign` ⇒ rojo («navegación dura»); añadir `/buylist/:seg` a la
 * lista blanca ⇒ rojo («la ruta del paso está excluida»).
 */

const nav = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../request-step', async (importOriginal) => {
  const real = await importOriginal<typeof import('../request-step')>();
  return { ...real, goToSellRequestStep: (locale: string) => nav.calls.push(real.sellRequestStepHref(locale)) };
});

const routerPush = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/buylist',
  useRouter: () => ({ push: routerPush, replace: routerPush }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}));

const KYC: KycInfoDTO = { kycStatus: 'none', clabeMasked: undefined, clabeOnFile: false, ineOnFile: false, clabeUpdatedAt: null };

function asVerifiedCustomer() {
  setStoredUser({ id: 'u-777', email: 'ash@example.com', name: 'Ash', role: 'customer', locale: 'es', emailVerified: true });
  vi.spyOn(api, 'getKyc').mockResolvedValue(KYC);
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  nav.calls.length = 0;
  routerPush.mockClear();
});

async function addCharizardAndSubmit() {
  fireEvent.change(screen.getByLabelText('Buscar set'), { target: { value: 'Base' } });
  fireEvent.click(await screen.findByRole('button', { name: /Base Set/ }));
  const add = await screen.findByRole('button', { name: /^Agregar Charizard \(Normal\) a la venta/ });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  fireEvent.click(screen.getByTestId('sell-cart-fab'));
  const cta = screen.getByRole('button', { name: 'Enviar solicitud (1)' });
  await waitFor(() => expect(cta).toBeEnabled());
  fireEvent.click(cta);
}

describe('C-F5 (unidad) · el cotizador medido nunca pinta CLABE ni INE', () => {
  it('la ruta del paso está excluida de la medición y el cotizador está dentro', () => {
    expect(SELL_REQUEST_STEP_PATH).toBe('/buylist/solicitud');
    expect(isMeasuredPath(sellRequestStepHref('es'))).toBe(false);
    expect(isMeasuredPath(sellRequestStepHref('en'))).toBe(false);
    expect(isMeasuredPath('/es/buylist')).toBe(true);
  });

  it('«Enviar solicitud» hace navegación DURA al paso y el documento del cotizador no pinta CLABE/INE', async () => {
    asVerifiedCustomer();
    renderWithProviders(<BuylistView />, 'es');
    await addCharizardAndSubmit();
    expect(nav.calls).toEqual(['/es/buylist/solicitud']);
    expect(routerPush).not.toHaveBeenCalled();
    // El documento de /buylist sigue sin un solo campo de CLABE ni de INE (antes aquí se abría el modal).
    expect(screen.queryByLabelText(/CLABE/)).not.toBeInTheDocument();
    expect(screen.queryByText('INE (anverso)')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Crear solicitud de venta' })).not.toBeInTheDocument();
  });

  it('el código de BuylistView no importa ni monta BuylistKycForm (fuente)', () => {
    const src = readFileSync(join(__dirname, '..', 'BuylistView.tsx'), 'utf8');
    expect(src).not.toMatch(/import[^;]*BuylistKycForm/);
    expect(src).not.toMatch(/<BuylistKycForm\b/);
  });

  it('`goToSellRequestStep` usa `location.assign` con la URL con idioma (no el router)', () => {
    const assign = vi.fn();
    // La real (sin el mock de arriba): se importa del módulo verdadero.
    return vi.importActual<typeof import('../request-step')>('../request-step').then((real) => {
      real.goToSellRequestStep('en', assign);
      expect(assign).toHaveBeenCalledWith('/en/buylist/solicitud');
      expect(goToSellRequestStep).not.toBe(real.goToSellRequestStep); // el de arriba es el sustituto
    });
  });
});

describe('/buylist/solicitud · estados del paso de crear', () => {
  it('con la lista guardada: rehidrata, recotiza y pinta resumen + CLABE + INE', async () => {
    asVerifiedCustomer();
    // El cotizador deja la lista en `localStorage` (único estado que cruza documentos).
    const view = renderWithProviders(<BuylistView />, 'es');
    await addCharizardAndSubmit();
    view.unmount();

    const batch = vi.spyOn(api, 'batchQuote');
    renderWithProviders(<SellRequestStepView />, 'es');
    const step = await screen.findByRole('region', { name: 'Crear solicitud de venta' });
    await within(step).findByText('Resumen de tu venta');
    expect(batch).toHaveBeenCalledTimes(1); // §33.11: nada se envía con el precio guardado
    expect(within(step).getByLabelText(/CLABE/)).toBeInTheDocument();
    expect(within(step).getByText('Charizard')).toBeInTheDocument();
  });

  it('sin lista: lo dice y ofrece volver al cotizador (sin formulario)', async () => {
    asVerifiedCustomer();
    renderWithProviders(<SellRequestStepView />, 'es');
    expect(await screen.findByText('Tu carrito está vacío. Elige una carta del catálogo para agregarla.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute('href', '/buylist');
    expect(screen.queryByLabelText(/CLABE/)).not.toBeInTheDocument();
  });

  it('sin sesión: el panel de requisitos de siempre (entrar / crear cuenta), sin formulario', async () => {
    renderWithProviders(<SellRequestStepView />, 'es');
    expect(await screen.findByText('Iniciar sesión')).toBeInTheDocument();
    expect(screen.queryByLabelText(/CLABE/)).not.toBeInTheDocument();
  });

  it('si la recotización falla: no hay formulario y se puede reintentar', async () => {
    asVerifiedCustomer();
    const view = renderWithProviders(<BuylistView />, 'es');
    await addCharizardAndSubmit();
    view.unmount();
    vi.spyOn(api, 'batchQuote').mockRejectedValue(new Error('red'));
    renderWithProviders(<SellRequestStepView />, 'es');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/CLABE/)).not.toBeInTheDocument();
  });
});
