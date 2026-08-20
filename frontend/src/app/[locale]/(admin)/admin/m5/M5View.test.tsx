import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { M5View } from './M5View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { CardDTO } from '@/types/contract';

// Reveal CLABE / pago SPEI exigen super_admin (patrón useRole): se fija para ejercer el flujo.
vi.mock('@/lib/role', () => ({
  useRole: () => ({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true, canSwitchRole: false }),
}));

// El `Link` de next-intl (`@/i18n/navigation`) no resuelve bajo vitest; se stubea a un <a>
// que preserva href/aria-label (enlace del vendedor a M6).
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: unknown; children: ReactNode }) => {
    const to =
      typeof href === 'string'
        ? href
        : `${(href as { pathname?: string })?.pathname ?? '#'}?user=${(href as { query?: { user?: string } })?.query?.user ?? ''}`;
    return (
      <a href={to} {...rest}>
        {children}
      </a>
    );
  },
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('M5View · Buylist admin end-to-end', () => {
  it('renderiza la cola con solicitudes, acabado por ítem y botones de decisión', async () => {
    renderWithProviders(<M5View />, 'es');
    expect(await screen.findByText('sr-3001')).toBeInTheDocument();
    expect(screen.getByText('sr-3002')).toBeInTheDocument();
    // v1.6-finish: el acabado del ítem es visible (sri-1 = holofoil).
    expect(screen.getAllByText('Holofoil').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Aprobar' }).length).toBeGreaterThan(0);
  });

  it('el botón Verificar dispara POST /verify y muestra la confirmación', async () => {
    const spy = vi
      .spyOn(api, 'verifyBuylistRequest')
      .mockResolvedValue({ id: 'sr-3002', userId: 'u-778', status: 'verificacion', quotedTotalCents: 1200, createdAt: '', items: [] });
    renderWithProviders(<M5View />, 'es');
    // sr-3002 está en `recibida` → muestra "Iniciar verificación".
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar verificación' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3002'));
    expect(await screen.findByText('Verificación iniciada.')).toBeInTheDocument();
  });

  it('Aprobar un ítem llama a la decisión approve y confirma', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({
      id: 'sri-1',
      card: { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] },
      productType: 'raw',
      finish: 'holofoil',
      itemStatus: 'aprobada',
    });
    renderWithProviders(<M5View />, 'es');
    const approveButtons = await screen.findAllByRole('button', { name: 'Aprobar' });
    fireEvent.click(approveButtons[0]);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'approve', approvedPriceCents: undefined }),
    );
    expect(await screen.findByText('Ítem aprobado.')).toBeInTheDocument();
  });

  it('Ajustar abre el modal, envía approvedPriceCents y muestra el error real del tope (APPROVED_PRICE_CAP_EXCEEDED)', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(
      new ApiClientError(422, {
        code: 'APPROVED_PRICE_CAP_EXCEEDED',
        message: 'Approved price exceeds the allowed cap for this item',
      }),
    );
    renderWithProviders(<M5View />, 'es');
    const adjustButtons = await screen.findAllByRole('button', { name: 'Ajustar' });
    fireEvent.click(adjustButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Ajustar precio del ítem' });
    fireEvent.change(within(dialog).getByLabelText('Precio aprobado (MXN)'), {
      target: { value: '99999' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar ajuste' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'adjust', approvedPriceCents: 9999900 }),
    );
    // Copy i18n del código del contrato (tope B-4/AML), no un genérico.
    expect(
      await within(dialog).findByText(/excede el tope permitido/),
    ).toBeInTheDocument();
  });

  it('Rechazar abre el diálogo de motivo (obligatorio 3–500), envía reason y confirma (v1.18)', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({
      id: 'sri-1',
      card: { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] },
      productType: 'raw',
      finish: 'holofoil',
      itemStatus: 'rechazada',
      rejectionReason: 'no es NM: esquina doblada',
    });
    renderWithProviders(<M5View />, 'es');
    const rejectButtons = await screen.findAllByRole('button', { name: 'Rechazar' });
    fireEvent.click(rejectButtons[0]);

    // El clic NO envía nada aún: exige el motivo en el mini-diálogo.
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar ítem' });
    const confirm = within(dialog).getByRole('button', { name: 'Rechazar y notificar' });
    expect(confirm).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
    // Se avisa que el vendedor recibirá correo con motivo y plazos.
    expect(within(dialog).getByText(/se notificará al vendedor por correo/)).toBeInTheDocument();

    // Motivo demasiado corto → error de validación en cliente y confirm deshabilitado.
    fireEvent.change(within(dialog).getByLabelText('Motivo del rechazo'), { target: { value: 'ab' } });
    expect(within(dialog).getByText('El motivo debe tener entre 3 y 500 caracteres.')).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Motivo del rechazo'), {
      target: { value: 'no es NM: esquina doblada' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar y notificar' }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'reject', reason: 'no es NM: esquina doblada' }),
    );
    expect(await screen.findByText('Ítem rechazado.')).toBeInTheDocument();
  });

  it('el 400 del server al rechazar se muestra DENTRO del diálogo de motivo', async () => {
    vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(
      new ApiClientError(400, {
        code: 'SOME_UNMAPPED_CODE',
        message: 'reason is required for reject (3-500 chars)',
      }),
    );
    renderWithProviders(<M5View />, 'es');
    const rejectButtons = await screen.findAllByRole('button', { name: 'Rechazar' });
    fireEvent.click(rejectButtons[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar ítem' });
    fireEvent.change(within(dialog).getByLabelText('Motivo del rechazo'), {
      target: { value: 'motivo válido' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar y notificar' }));

    expect(
      await within(dialog).findByText('reason is required for reject (3-500 chars)'),
    ).toBeInTheDocument();
  });

  it('Convertir a inventario está deshabilitado si el ítem no está aprobado', async () => {
    renderWithProviders(<M5View />, 'es');
    const convertButtons = await screen.findAllByRole('button', { name: 'Convertir a inventario' });
    // Fixture: ningún ítem está `aprobada` → todos los convertir están deshabilitados.
    for (const b of convertButtons) expect(b).toBeDisabled();
  });

  it('Revelar CLABE la muestra bajo demanda y Ocultar la retira (no persiste)', async () => {
    const spy = vi
      .spyOn(api, 'revealBuylistClabe')
      .mockResolvedValue({ sellRequestId: 'sr-3001', clabe: '002010077777777771' });
    renderWithProviders(<M5View />, 'es');
    const revealButtons = await screen.findAllByRole('button', { name: 'Revelar CLABE' });
    fireEvent.click(revealButtons[0]);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3001'));
    expect(await screen.findByText('002010077777777771')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar CLABE' }));
    expect(screen.queryByText('002010077777777771')).not.toBeInTheDocument();
  });

  it('Pagar por SPEI pide la referencia, llama al endpoint y confirma', async () => {
    const spy = vi.spyOn(api, 'paySpeiBuylist').mockResolvedValue({
      id: 'sr-3001',
      userId: 'u-777',
      status: 'pagada',
      quotedTotalCents: 50200,
      createdAt: '',
      items: [],
    });
    renderWithProviders(<M5View />, 'es');
    const payButtons = await screen.findAllByRole('button', { name: 'Pagar por SPEI' });
    // sr-3001 (verificacion) es pagable; sr-3002 (recibida) no.
    const enabled = payButtons.find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(enabled);

    const dialog = await screen.findByRole('dialog', { name: 'Registrar pago SPEI' });
    const confirm = within(dialog).getByRole('button', { name: 'Registrar pago' });
    // Referencia obligatoria: sin ella no se puede confirmar.
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Referencia SPEI'), {
      target: { value: 'MBAN-2026-081701' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3001', 'MBAN-2026-081701'));
    expect(await screen.findByText(/Pago SPEI registrado/)).toBeInTheDocument();
  });

  it('las pestañas filtran por etapa: "Verificando" muestra sr-3001/sr-3002 y "Por pagar" muestra sr-3003', async () => {
    renderWithProviders(<M5View />, 'es');
    // Etapa por defecto (primera con solicitudes) = Verificando (sr-3001 verificacion, sr-3002 recibida).
    expect(await screen.findByText('sr-3001')).toBeInTheDocument();
    expect(screen.getByText('sr-3002')).toBeInTheDocument();
    expect(screen.queryByText('sr-3003')).not.toBeInTheDocument();

    // Cambiar a "Por pagar" (aprobada) muestra sr-3003 y oculta las de verificación.
    fireEvent.click(screen.getByRole('tab', { name: /Por pagar/ }));
    expect(await screen.findByText('sr-3003')).toBeInTheDocument();
    expect(screen.queryByText('sr-3001')).not.toBeInTheDocument();
  });

  it('solo muestra las acciones de la etapa: una solicitud aprobada NO ofrece aprobar/rechazar', async () => {
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(screen.getByRole('tab', { name: /Por pagar/ }));
    // sr-3003 (aprobada): decidir carta es de una etapa previa → no hay Aprobar/Rechazar.
    expect(await screen.findByText('sr-3003')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
    // Sí ofrece pago SPEI (etapa por-pagar).
    expect(screen.getAllByRole('button', { name: 'Pagar por SPEI' }).length).toBeGreaterThan(0);
  });

  it('el buscador filtra por folio/usuario', async () => {
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-3001');
    // Buscar el usuario de sr-3003 (u-779) salta a esa solicitud aunque esté en otra etapa.
    fireEvent.change(screen.getByLabelText('Buscar solicitud'), { target: { value: 'u-779' } });
    fireEvent.click(screen.getByRole('tab', { name: /Por pagar/ }));
    expect(await screen.findByText('sr-3003')).toBeInTheDocument();
    // La pestaña Verificando ya no lista sr-3001 (no matchea la búsqueda).
    fireEvent.click(screen.getByRole('tab', { name: /Verificando/ }));
    expect(screen.queryByText('sr-3001')).not.toBeInTheDocument();
  });

  it('el vendedor se muestra con nombre + correo (UUID en tooltip) y enlaza a M6 (?user=)', async () => {
    renderWithProviders(<M5View />, 'es');
    // v1.18: identidad primaria = seller.name + seller.email; el UUID pasa a `title`.
    const link = await screen.findByRole('link', { name: /Ver ficha del vendedor Diana Olvera/ });
    expect(link.textContent).toContain('Diana Olvera');
    expect(link.textContent).toContain('diana.olvera@example.mx');
    expect(link.textContent).not.toContain('u-777');
    expect(link.getAttribute('title')).toBe('u-777');
    expect(link.getAttribute('href')).toContain('user=u-777');
  });

  it('muestra la fecha de creación de cada solicitud (formato del admin)', async () => {
    renderWithProviders(<M5View />, 'es');
    // sr-3001 createdAt=2026-08-12 → formatDate es-MX "12 ago 2026".
    await screen.findByText('sr-3001');
    expect(screen.getByText(/12 ago 2026/)).toBeInTheDocument();
  });

  it('muestra el total aprobado DEL SERVER (approvedTotalCents, sin sumar en la UI)', async () => {
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-3001');
    fireEvent.click(screen.getByRole('tab', { name: /Por pagar/ }));
    // sr-3003: approvedTotalCents=28000 (fixture) → MX$280.00 etiquetado como total aprobado.
    expect(await screen.findByText(/Total aprobado/)).toBeInTheDocument();
    expect(screen.getByText(/Total aprobado/).textContent).toContain('280.00');
  });

  it('pestaña Rechazadas: lista transversal con plazos, fases y SIN convertir a inventario', async () => {
    const DAY = 24 * 3600 * 1000;
    const card: CardDTO = { id: 'c', externalId: 'c', name: 'Umbreon VMAX', number: '215', rarity: 'Rare Rainbow', supertype: 'Pokémon', subtypes: [], setId: 'swsh7', setName: 'Evolving Skies', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
    const spy = vi.spyOn(api, 'getAdminRejectedBuylistItems').mockResolvedValue({
      data: [
        {
          // Rechazada ayer → fase "en plazo de devolución" (now <= returnDeadlineAt).
          id: 'sri-r1',
          sellRequestId: 'sr-3001',
          seller: { id: 'u-777', name: 'Diana Olvera', email: 'diana.olvera@example.mx' },
          card,
          productType: 'raw',
          finish: 'holofoil',
          quotedPriceCents: 45000,
          reason: 'no es NM: borde con desgaste',
          rejectedAt: new Date(Date.now() - 1 * DAY).toISOString(),
          returnDeadlineAt: new Date(Date.now() + 6 * DAY).toISOString(),
          abandonDeadlineAt: new Date(Date.now() + 29 * DAY).toISOString(),
        },
        {
          // Rechazada hace 40 días → ambos plazos vencidos.
          id: 'sri-r2',
          sellRequestId: 'sr-3002',
          seller: { id: 'u-778', name: 'Marco Peña', email: 'marco.pena@example.mx' },
          card,
          productType: 'raw',
          finish: 'normal',
          quotedPriceCents: 1200,
          reason: 'no es NM: doblez central',
          rejectedAt: new Date(Date.now() - 40 * DAY).toISOString(),
          returnDeadlineAt: new Date(Date.now() - 33 * DAY).toISOString(),
          abandonDeadlineAt: new Date(Date.now() - 10 * DAY).toISOString(),
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-3001');
    fireEvent.click(screen.getByRole('tab', { name: /Rechazadas/ }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ page: 1 }));
    // Carta (nombre/set/acabado), vendedor y motivo visibles.
    expect((await screen.findAllByText('Umbreon VMAX')).length).toBe(2);
    expect(screen.getAllByText(/Evolving Skies/).length).toBe(2);
    expect(screen.getByText(/diana\.olvera@example\.mx/)).toBeInTheDocument();
    expect(screen.getByText(/no es NM: borde con desgaste/)).toBeInTheDocument();
    // Fase derivada de now vs los plazos del server.
    expect(screen.getByText('En plazo de devolución')).toBeInTheDocument();
    expect(screen.getByText('Plazos vencidos')).toBeInTheDocument();
    // Plazos visibles: devolución (7d, a costo del vendedor) y abandono (30d).
    expect(screen.getAllByText(/Devolución hasta .+a costo del vendedor/).length).toBe(2);
    expect(screen.getAllByText(/Abandono a partir de/).length).toBe(2);
    // PROJECT criterio 16: una rechazada JAMÁS se convierte a inventario → sin botón.
    expect(screen.queryByRole('button', { name: 'Convertir a inventario' })).not.toBeInTheDocument();
    // Tampoco hay acciones de decisión en esta pestaña.
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('un error del pago SPEI muestra el mensaje real del backend dentro del modal', async () => {
    vi.spyOn(api, 'paySpeiBuylist').mockRejectedValue(
      new ApiClientError(422, {
        code: 'SOME_UNMAPPED_CODE',
        message: 'Payment allowed only after receipt/verification and approval',
      }),
    );
    renderWithProviders(<M5View />, 'es');
    const payButtons = await screen.findAllByRole('button', { name: 'Pagar por SPEI' });
    fireEvent.click(payButtons.find((b) => !(b as HTMLButtonElement).disabled)!);
    const dialog = await screen.findByRole('dialog', { name: 'Registrar pago SPEI' });
    fireEvent.change(within(dialog).getByLabelText('Referencia SPEI'), { target: { value: 'X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));

    // Código sin copy i18n → cae al mensaje real del backend (useErrorMessage).
    expect(
      await within(dialog).findByText('Payment allowed only after receipt/verification and approval'),
    ).toBeInTheDocument();
  });
});

/**
 * P-4 (v1.24-buylist-request-reject) · botón «Rechazar solicitud» (POST /admin/buylist/:id/reject).
 * Cierra la solicitud ATORADA en «Verificando» cuyos ítems ya están todos rechazados.
 */
describe('M5View · cierre explícito «Rechazar solicitud» (v1.24)', () => {
  const card: CardDTO = { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
  const rejectedItem = (id: string) => ({
    id,
    card,
    productType: 'raw' as const,
    finish: 'holofoil' as const,
    itemStatus: 'rechazada' as const,
    rejectionReason: 'no es NM: esquina doblada',
    rejectedAt: '2026-08-18T00:00:00.000Z',
  });

  it('la solicitud atorada (verificacion, todos los ítems rechazados) muestra el botón y dispara el cierre', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        {
          id: 'sr-stuck',
          userId: 'u-900',
          seller: { id: 'u-900', name: 'Ana Ríos', email: 'ana.rios@example.mx' },
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          items: [rejectedItem('sri-a'), rejectedItem('sri-b')],
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const spy = vi.spyOn(api, 'rejectBuylistRequest').mockResolvedValue({
      id: 'sr-stuck',
      userId: 'u-900',
      status: 'rechazada',
      quotedTotalCents: 45000,
      createdAt: '2026-08-12T00:00:00.000Z',
      items: [rejectedItem('sri-a'), rejectedItem('sri-b')],
    });
    renderWithProviders(<M5View />, 'es');

    // El botón a nivel solicitud aparece (etapa por defecto = Verificando).
    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar solicitud' }));

    // Confirmación destructiva en modal; aún no llama al endpoint.
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar solicitud completa' });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar solicitud' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-stuck', { reason: undefined }));
    expect(await screen.findByText('Solicitud rechazada; quedó cerrada.')).toBeInTheDocument();
  });

  it('NO ofrece el botón si queda algún ítem sin rechazar (evita el 422 seguro)', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        {
          id: 'sr-mixed',
          userId: 'u-901',
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          items: [
            rejectedItem('sri-c'),
            { id: 'sri-d', card, productType: 'raw', finish: 'normal', itemStatus: 'aprobada', approvedPriceCents: 30000 },
          ],
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-mixed');
    expect(screen.queryByRole('button', { name: 'Rechazar solicitud' })).not.toBeInTheDocument();
  });

  it('el 422 REQUEST_HAS_NON_REJECTED_ITEMS se muestra DENTRO del modal con copy i18n', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        {
          id: 'sr-stuck',
          userId: 'u-900',
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          items: [rejectedItem('sri-a')],
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    vi.spyOn(api, 'rejectBuylistRequest').mockRejectedValue(
      new ApiClientError(422, {
        code: 'REQUEST_HAS_NON_REJECTED_ITEMS',
        message: 'The sell request still has non-rejected items',
        details: { nonRejectedItemStatuses: ['aprobada'] },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar solicitud' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rechazar solicitud completa' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar solicitud' }));

    // Copy i18n del código del contrato, no el mensaje crudo del backend.
    expect(await within(dialog).findByText(/quedan ítems sin rechazar/)).toBeInTheDocument();
  });
});

/**
 * Bug reportado: al escribir el motivo de rechazo, CADA carácter sacaba el cursor del campo
 * (había que hacer clic de nuevo para seguir escribiendo). Causa raíz: el `useEffect` de foco
 * de `Modal` (components/ui/Modal.tsx) tenía `onClose` en su arreglo de dependencias — como
 * `closeReject` es una función NUEVA en cada render de M5View (no memoizada), cada tecleo
 * (cambio de `rejectReason`) re-disparaba el efecto y volvía a enfocar el wrapper del modal,
 * robándole el foco al input. Fix: el foco inicial de `Modal` solo depende de `open`.
 */
describe('M5View · modal de rechazo (bug de foco al escribir)', () => {
  it('escribir varios caracteres seguidos NO pierde el foco del campo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<M5View />, 'es');
    const rejectButtons = await screen.findAllByRole('button', { name: 'Rechazar' });
    fireEvent.click(rejectButtons[0]);

    const dialog = await screen.findByRole('dialog', { name: 'Rechazar ítem' });
    const input = within(dialog).getByLabelText('Motivo del rechazo');

    await user.type(input, 'no esta en NM');

    expect(input).toHaveValue('no esta en NM');
    expect(input).toHaveFocus();
  });
});

/**
 * P-5 (v1.25-buylist-orders-pagination) · pestaña «Cerradas» server-side. Deja de traer la lista
 * completa y filtrar en memoria: pide `getAdminBuylist({ status: 'pagada,rechazada,abandonada',
 * page, pageSize: 25, q, from, to, minCents, maxCents })` paginado. El buscador global alimenta `q`.
 */
describe('M5View · pestaña «Cerradas» server-side (v1.25)', () => {
  const card: CardDTO = { id: 'c', externalId: 'c', name: 'Blastoise', number: '2', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
  const closedReq = (id: string, status: 'pagada' | 'rechazada' | 'abandonada') => ({
    id,
    userId: 'u-777',
    seller: { id: 'u-777', name: 'Diana Olvera', email: 'diana.olvera@example.mx' },
    status,
    quotedTotalCents: 50200,
    createdAt: '2026-08-01T00:00:00.000Z',
    items: [
      {
        id: `${id}-i`,
        card,
        productType: 'raw' as const,
        finish: 'normal' as const,
        itemStatus: status === 'pagada' ? ('pagada' as const) : ('rechazada' as const),
        quotedPriceCents: 50200,
      },
    ],
  });

  it('al abrir «Cerradas» dispara la query server-side con status CSV y pageSize 25', async () => {
    const spy = vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [closedReq('sr-c1', 'pagada')],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');

    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pagada,rechazada,abandonada', page: 1, pageSize: 25 }),
      ),
    );
    expect(await screen.findByText('sr-c1')).toBeInTheDocument();
  });

  it('el buscador global alimenta `q` server-side en «Cerradas»', async () => {
    const spy = vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [closedReq('sr-c1', 'pagada')],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));
    await screen.findByText('sr-c1');

    fireEvent.change(screen.getByLabelText('Buscar solicitud'), { target: { value: 'Diana' } });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ q: 'Diana', page: 1 })),
    );
  });

  it('los filtros de fecha y monto se reflejan en los params server-side', async () => {
    const spy = vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [closedReq('sr-c1', 'pagada')],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));
    await screen.findByText('sr-c1');

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-01' } });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-08-01' })),
    );

    // Monto en pesos → centavos (helper pesosToCents): 100 → 10000, 900 → 90000.
    fireEvent.change(screen.getByLabelText('Monto mín.'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Monto máx.'), { target: { value: '900' } });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ minCents: 10000, maxCents: 90000 }),
      ),
    );
  });

  it('la paginación cambia de página (page en los params)', async () => {
    // total 60 con pageSize 25 → 3 páginas: se muestran los controles de paginación.
    const spy = vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [closedReq('sr-c1', 'pagada')],
      page: 1,
      pageSize: 25,
      total: 60,
    });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));
    await screen.findByText('sr-c1');

    fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });
});
