/**
 * UX-MKT-16 (`DESIGN_SYSTEM §MKT-UX.10`; contrato §MKT.G.6): el CLARO de la llave del analista se ve UNA vez, solo en el
 * estado del diálogo: ⛔ ni `localStorage`/`sessionStorage`, ni URL, ni caché de consultas, ni `data-*`; ⛔ no se vuelve a
 * pedir. «Listo» deshabilitado hasta la casilla; `Esc` y clic fuera no cierran antes. Más listar y revocar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../../messages/es.json';
import type { MarketingApiTokenView } from '@/types/contract';

const api = vi.hoisted(() => ({
  listMarketingTokens: vi.fn(),
  issueMarketingToken: vi.fn(),
  revokeMarketingToken: vi.fn(),
}));
vi.mock('@/lib/marketing-api', () => api);

// eslint-disable-next-line import/first
import { AnalystAccessPanel } from './AnalystAccessPanel';

const SECRET = 'mkt_SECRETO_de_prueba_0123456789abcdef';
const ACTIVE: MarketingApiTokenView = {
  id: 't1',
  label: 'Analista',
  status: 'active',
  createdAt: '2026-10-01T12:00:00Z',
  createdByUserId: 'u1',
  expiresAt: '2027-10-01T12:00:00Z',
  revokedAt: null,
  revokedByUserId: null,
  lastUsedAt: null,
};

let client: QueryClient;
function renderPanel() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="es" messages={es}>
        <AnalystAccessPanel />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  api.listMarketingTokens.mockResolvedValue({ items: [] });
  api.issueMarketingToken.mockResolvedValue({ id: 't9', label: 'Analista', token: SECRET, createdAt: 'x', expiresAt: '2027-10-18T00:00:00Z' });
  api.revokeMarketingToken.mockResolvedValue({ ...ACTIVE, status: 'revoked', revokedAt: '2026-10-18T00:00:00Z' });
});
afterEach(() => vi.clearAllMocks());

/** Todo lo que podría retener el claro fuera del estado del componente. */
function leaks(): string[] {
  const places: Record<string, string> = {
    localStorage: JSON.stringify({ ...window.localStorage }),
    sessionStorage: JSON.stringify({ ...window.sessionStorage }),
    url: window.location.href,
    queryCache: JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data)),
    mutationCache: JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data)),
    dataAttrs: Array.from(document.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.attributes).filter((a) => a.name.startsWith('data-')).map((a) => a.value))
      .join('|'),
  };
  return Object.entries(places)
    .filter(([, v]) => v.includes(SECRET))
    .map(([k]) => k);
}

describe('UX-MKT-16 · la llave se ve una vez y no se guarda', () => {
  it('crear ⇒ el claro solo en el campo; «Listo» espera la casilla; Esc no cierra; al cerrar no queda en ningún sitio', async () => {
    const u = userEvent.setup();
    renderPanel();
    await screen.findByText('Nadie tiene acceso ahora.');
    await u.click(screen.getByTestId('mkt-access-create'));
    await u.type(within(screen.getByTestId('mkt-createkey-dialog')).getByLabelText('Nombre de la llave'), 'Analista');
    await u.click(screen.getByTestId('mkt-createkey-submit'));

    const dlg = await screen.findByTestId('mkt-newkey-dialog');
    const field = within(dlg).getByLabelText('Tu llave (se muestra una sola vez)') as HTMLInputElement;
    expect(field.value).toBe(SECRET);
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('spellcheck', 'false');
    expect(dlg).toHaveTextContent('TIENDA_PANEL_TOKEN');
    expect(leaks()).toEqual([]);

    const done = screen.getByTestId('mkt-newkey-done');
    expect(done).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dlg.parentElement as HTMLElement); // clic fuera
    expect(screen.getByTestId('mkt-newkey-dialog')).toBeInTheDocument();

    await u.click(within(dlg).getByLabelText('Ya la copié y la guardé'));
    expect(done).toBeEnabled();
    await u.click(done);
    await waitFor(() => expect(screen.queryByTestId('mkt-newkey-dialog')).toBeNull());
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(leaks()).toEqual([]);
    expect(api.issueMarketingToken).toHaveBeenCalledTimes(1);
    // La lista se relee (`GET …/tokens`, que ⛔ nunca trae el claro), pero la llave no se vuelve a pedir.
    await waitFor(() => expect(api.listMarketingTokens).toHaveBeenCalledTimes(2));
  });

  it('D6: mientras se emite la llave, «Cancelar», `Esc`, clic fuera y la X no cierran; al terminar, sí', async () => {
    let resolveIssue!: (v: unknown) => void;
    api.issueMarketingToken.mockImplementationOnce(() => new Promise((r) => (resolveIssue = r)));
    const u = userEvent.setup();
    renderPanel();
    await screen.findByText('Nadie tiene acceso ahora.');
    await u.click(screen.getByTestId('mkt-access-create'));
    const dlg = screen.getByTestId('mkt-createkey-dialog');
    await u.type(within(dlg).getByLabelText('Nombre de la llave'), 'Analista');
    await u.click(screen.getByTestId('mkt-createkey-submit'));

    const cancel = screen.getByTestId('mkt-createkey-cancel');
    await waitFor(() => expect(cancel).toBeDisabled());
    fireEvent.click(cancel);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dlg.parentElement as HTMLElement); // clic fuera
    expect(within(dlg).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByTestId('mkt-createkey-dialog')).toBeInTheDocument();

    resolveIssue({ id: 't9', label: 'Analista', token: SECRET, createdAt: 'x', expiresAt: '2027-10-18T00:00:00Z' });
    expect(await screen.findByTestId('mkt-newkey-dialog')).toBeInTheDocument();
    expect(api.issueMarketingToken).toHaveBeenCalledTimes(1);
  });

  it('D6: sin petición en curso, «Cancelar» y `Esc` sí cierran el diálogo de crear', async () => {
    const u = userEvent.setup();
    renderPanel();
    await screen.findByText('Nadie tiene acceso ahora.');
    await u.click(screen.getByTestId('mkt-access-create'));
    expect(screen.getByTestId('mkt-createkey-cancel')).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('mkt-createkey-dialog')).toBeNull());
    await u.click(screen.getByTestId('mkt-access-create'));
    await u.click(screen.getByTestId('mkt-createkey-cancel'));
    await waitFor(() => expect(screen.queryByTestId('mkt-createkey-dialog')).toBeNull());
  });

  it('«Copiar» usa el portapapeles y lo anuncia; si falla, lo dice', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const u = userEvent.setup();
    renderPanel();
    await screen.findByText('Nadie tiene acceso ahora.');
    await u.click(screen.getByTestId('mkt-access-create'));
    await u.type(screen.getByLabelText('Nombre de la llave'), 'Analista');
    await u.click(screen.getByTestId('mkt-createkey-submit'));
    await screen.findByTestId('mkt-newkey-dialog');
    // `userEvent.setup()` instala su propio portapapeles: se restituye el espía antes de copiar.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByTestId('mkt-newkey-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET));
    expect(await screen.findByText('Llave copiada al portapapeles.')).toBeInTheDocument();
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByTestId('mkt-newkey-copy'));
    expect(await screen.findByText('No se pudo copiar. Selecciónala y cópiala a mano.')).toBeInTheDocument();
  });
});

describe('llave activa y revocar', () => {
  it('muestra la ficha y revocar pasa por confirmación destructiva y anuncia «Llave revocada.»', async () => {
    api.listMarketingTokens.mockResolvedValueOnce({ items: [ACTIVE] });
    const u = userEvent.setup();
    renderPanel();
    const card = await screen.findByTestId('mkt-access-key');
    expect(card).toHaveTextContent('Analista');
    expect(card).toHaveTextContent('Activa');
    expect(card).toHaveTextContent('Último uso: nunca');
    await u.click(screen.getByTestId('mkt-access-revoke'));
    expect(within(screen.getByTestId('mkt-revoke-dialog')).getByRole('heading')).toHaveTextContent('¿Revocar la llave del analista?');
    await u.click(screen.getByTestId('mkt-revoke-confirm'));
    await waitFor(() => expect(api.revokeMarketingToken).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.getByTestId('mkt-access-status')).toHaveTextContent('Llave revocada.'));
  });
});
