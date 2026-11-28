import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';

/**
 * §BUYLIST-ES F3 (§4.1) · «Idioma recibido» por línea en la recepción: default = declarado, un toque, y los 422 nuevos con
 * texto claro (VERSION_PRICE_UNAVAILABLE ⇒ «Carta distinta»). El spy HACE DE SERVIDOR sobre el servidor falso.
 */
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

async function openVerifying(locale: 'es' | 'en') {
  renderWithProviders(<M5View />, locale);
  fireEvent.click(await screen.findByRole('tab', { name: locale === 'es' ? /^Verificando/ : /^Verifying/ }));
}

describe('M5 recepción · idioma recibido (§BUYLIST-ES F3)', () => {
  it('cada línea por decidir trae el selector con el idioma declarado marcado; sin tocar, aprobar manda el declarado', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({} as never);
    await openVerifying('es');
    const group = (await screen.findAllByRole('group', { name: /Idioma recibido de/ }))[0];
    const [en, es] = Array.from(group.querySelectorAll('button'));
    expect(en).toHaveAttribute('aria-pressed', 'true'); // la línea del servidor falso se declaró en inglés
    expect(es).toHaveAttribute('aria-pressed', 'false');
    expect(en.textContent).toContain('declarado');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Aprobar al pactado' }))[0]);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toMatchObject({ decision: 'approve', receivedLanguage: 'en' });
  });

  it('un toque en «Español» cambia lo recibido, avisa que difiere y se envía con la aprobación', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({} as never);
    await openVerifying('es');
    const group = (await screen.findAllByRole('group', { name: /Idioma recibido de/ }))[0];
    fireEvent.click(group.querySelector('button[data-lang="es"]')!);
    expect(group.querySelector('button[data-lang="es"]')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId(/^received-version-mismatch-/)[0].textContent).toContain('Distinto de lo declarado (Inglés)');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Aprobar al pactado' }))[0]);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][1]).toMatchObject({ decision: 'approve', receivedLanguage: 'es' });
  });

  it('422 VERSION_PRICE_UNAVAILABLE: texto claro y «Carta distinta» abre el rechazo «no es la carta que declaró»', async () => {
    vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(
      new ApiClientError(422, { code: 'VERSION_PRICE_UNAVAILABLE', message: 'x' }),
    );
    await openVerifying('es');
    const group = (await screen.findAllByRole('group', { name: /Idioma recibido de/ }))[0];
    fireEvent.click(group.querySelector('button[data-lang="es"]')!);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Aprobar al pactado' }))[0]);
    const alert = await screen.findByText(/No hay precio para la versión que llegó/);
    expect(alert).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Carta distinta' })[0]);
    expect(await screen.findByRole('radio', { name: 'No es la carta que declaró' })).toBeChecked();
  });

  it('422 ES_OVER_CAP en el ajuste del staff: tope duro con su monto, en inglés también', async () => {
    vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(
      new ApiClientError(422, { code: 'ES_OVER_CAP', message: 'x', details: { capCents: 42500 } }),
    );
    await openVerifying('en');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Approve at agreed price' }))[0]);
    expect(await screen.findByText(/cannot exceed the English offer or the reference \(MX\$425\.00\)/)).toBeInTheDocument();
  });
});
