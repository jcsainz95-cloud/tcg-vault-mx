import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M5View, M5_STATUS_TAB } from './M5View';
import es from '../../../../../../messages/es.json';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { SellRequestStatus } from '@/types/contract';
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';

/**
 * ⚠️⚠️ **Candado S-3 del contrato (§M5-S, v1.68 — cierre de P-58): «Marcar recibida» se renderiza
 * SOLO con `status === 'en_transito'`; «Verificar» SOLO con `recibida`.** Test de render por
 * estado, **los 11**, derivados del enum del contrato (`M5_STATUS_TAB` es `Record<SellRequestStatus,
 * …>`, así que un estado nuevo entra solo en la matriz y hay que decidir su fila).
 *
 * Por qué importa: `receive` desde `cotizada` saltaba al paso 5 sin precio pactado ni aceptación;
 * desde `verificacion`/`aprobada` retrocedía un veredicto. El botón colgaba de `cotizada`
 * (`M5View.tsx:991-1001` antes de este pase): el paso equivocado. El backend ahora rechaza con
 * `409 INVALID_TRANSITION`; este candado vigila que la UI no vuelva a ofrecer el clic.
 *
 * Mutación que lo pone en rojo (medida sobre copia, O-9): quitar la condición
 * `req.status === 'en_transito'` del botón ⇒ el botón aparece en los otros 10 estados ⇒ 10 filas
 * rojas de esta matriz.
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

const ALL_STATUSES = Object.keys(M5_STATUS_TAB) as SellRequestStatus[];
const RECEIVE_LABEL = es.admin.m5.receive;
const VERIFY_LABEL = es.admin.m5.verify;
const TAB_LABELS = es.admin.m5.tabs as Record<string, string>;

/** Una solicitud en `status`, proyectada por el mismo servidor falso que sirve `isTerminal`. */
function rowIn(status: SellRequestStatus) {
  const reached = (s: SellRequestStatus[]) => s.includes(status);
  return srv({
    id: `sr-${status}`,
    userId: 'u-matrix',
    seller: { id: 'u-matrix', name: 'Matriz S', email: 'matriz@example.com' },
    status,
    quotedTotalCents: 1000,
    createdAt: '2026-09-01T00:00:00.000Z',
    // Las marcas se sellan en el paso que las escribe; nunca antes (§M5-P).
    receivedAt: reached(['recibida', 'verificacion', 'aprobada', 'pagada']) ? '2026-09-02T00:00:00.000Z' : null,
    verifiedAt: reached(['verificacion', 'aprobada', 'pagada']) ? '2026-09-03T00:00:00.000Z' : null,
    approvedTotalCents: reached(['aprobada', 'pagada']) ? 1000 : null,
    offerSentAt: null,
    items: [],
  });
}

async function openTabFor(status: SellRequestStatus) {
  const tab = TAB_LABELS[M5_STATUS_TAB[status]];
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${tab}`) }));
  // La fila está pintada cuando su id es visible: a partir de aquí el render es estable.
  await screen.findByText(`sr-${status}`);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M5View · §M5-S candado S-3: matriz de render por estado (11 × {receive, verify})', () => {
  it.each(ALL_STATUSES)('%s: «Marcar recibida» ⇔ en_transito · «Verificar» ⇔ recibida', async (status) => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn(status)], page: 1, pageSize: 25, total: 1 });
    renderWithProviders(<M5View />, 'es');
    await openTabFor(status);

    const receive = screen.queryByRole('button', { name: RECEIVE_LABEL });
    const verify = screen.queryByRole('button', { name: VERIFY_LABEL });
    if (status === 'en_transito') expect(receive).toBeInTheDocument();
    else expect(receive).toBeNull();
    if (status === 'recibida') expect(verify).toBeInTheDocument();
    else expect(verify).toBeNull();
  });

  it('en_transito: «Marcar recibida» dispara POST /receive y confirma', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn('en_transito')], page: 1, pageSize: 25, total: 1 });
    const spy = vi.spyOn(api, 'receiveBuylistRequest').mockResolvedValue(rowIn('recibida'));
    renderWithProviders(<M5View />, 'es');
    await openTabFor('en_transito');

    fireEvent.click(screen.getByRole('button', { name: RECEIVE_LABEL }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-en_transito'));
    expect(await screen.findByText(es.admin.m5.feedback.received)).toBeInTheDocument();
  });
});

describe('M5View · §M5-S: 409 INVALID_TRANSITION dice DESDE QUÉ ESTADO se permite, no el genérico', () => {
  /**
   * La fila que la pantalla pintó como `en_transito` ya se movió en el servidor (otro operador la
   * verificó, por ejemplo): el clic llega a `receive` desde `verificacion`. El contrato manda
   * `{ verb, from, allowedFrom, idempotentOn }` y el operador tiene que leer el estado REAL y el
   * paso desde el que sí aplica — con los rótulos del sistema, no el enum.
   */
  it('receive desde verificacion: rótulos de estado, verbo con nombre y sin el genérico', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn('en_transito')], page: 1, pageSize: 25, total: 1 });
    vi.spyOn(api, 'receiveBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'INVALID_TRANSITION',
        message: 'receive is not allowed from verificacion',
        details: { verb: 'receive', from: 'verificacion', allowedFrom: ['en_transito'], idempotentOn: 'recibida' },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openTabFor('en_transito');
    fireEvent.click(screen.getByRole('button', { name: RECEIVE_LABEL }));

    const msg = await screen.findByText(/solo aplica cuando está en/);
    expect(msg.textContent).toContain('En verificación');
    expect(msg.textContent).toContain('En tránsito');
    expect(msg.textContent).toContain('«Marcar recibida»');
    // Ni el enum crudo ni el inglés del servidor.
    expect(msg.textContent).not.toMatch(/verificacion|en_transito|not allowed/);
    expect(screen.queryByText('Hubo un conflicto con el estado actual.')).toBeNull();
  });

  it('verify desde aceptada: el mensaje nombra «Recibida» como el único paso permitido', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn('recibida')], page: 1, pageSize: 25, total: 1 });
    vi.spyOn(api, 'verifyBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'INVALID_TRANSITION',
        message: 'verify is not allowed from aceptada',
        details: { verb: 'verify', from: 'aceptada', allowedFrom: ['recibida'], idempotentOn: 'verificacion' },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openTabFor('recibida');
    fireEvent.click(screen.getByRole('button', { name: VERIFY_LABEL }));

    const msg = await screen.findByText(/solo aplica cuando está en/);
    expect(msg.textContent).toContain('Aceptada');
    expect(msg.textContent).toContain('Recibida');
    expect(msg.textContent).toContain('«Iniciar verificación»');
  });

  it('sin `details` utilizables cae a la base en español (nunca el inglés del servidor)', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn('en_transito')], page: 1, pageSize: 25, total: 1 });
    vi.spyOn(api, 'receiveBuylistRequest').mockRejectedValue(
      new ApiClientError(409, { code: 'INVALID_TRANSITION', message: 'receive is not allowed' }),
    );
    renderWithProviders(<M5View />, 'es');
    await openTabFor('en_transito');
    fireEvent.click(screen.getByRole('button', { name: RECEIVE_LABEL }));

    expect(await screen.findByText(es.admin.m5.transition.invalidGeneric)).toBeInTheDocument();
    expect(screen.queryByText('receive is not allowed')).toBeNull();
  });

  it('EN: misma frase enriquecida (paridad del copy nuevo)', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [rowIn('en_transito')], page: 1, pageSize: 25, total: 1 });
    vi.spyOn(api, 'receiveBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'INVALID_TRANSITION',
        message: 'receive is not allowed from cotizada',
        details: { verb: 'receive', from: 'cotizada', allowedFrom: ['en_transito'], idempotentOn: 'recibida' },
      }),
    );
    renderWithProviders(<M5View />, 'en');
    fireEvent.click(await screen.findByRole('tab', { name: /^With the seller|^Con el vendedor/ }));
    await screen.findByText('sr-en_transito');
    fireEvent.click(screen.getByRole('button', { name: /Mark received/ }));

    const msg = await screen.findByText(/only applies when it is in/);
    expect(msg.textContent).toContain('In transit');
  });
});
