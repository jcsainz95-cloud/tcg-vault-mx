import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { M5View, M5_STATUS_TAB, M5_OP_TAB_ORDER } from './M5View';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AdminBuylistDTO, CardDTO } from '@/types/contract';
// ⚠️ En estas pruebas el spy HACE DE SERVIDOR, y `isTerminal` es **server-derived** (v1.51).
// Se proyecta con la MISMA función que usa el mock en vez de escribir el booleano a mano en
// cada fixture: escribirlo a mano sería devolver al frontend la copia del set terminal que
// este cambio vino a borrar, disfrazada de dato de prueba.
import { mockAdminBuylistDTO as srv } from '@/lib/mock/fixtures';

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

/**
 * Selecciona una PESTAÑA DE ETAPA por su rótulo.
 *
 * ⚠️ **Por qué existe ahora y no antes.** La pestaña activa por defecto es *la primera con
 * solicitudes* (`firstNonEmpty`), así que estos tests estaban leyendo «Verificando» **por
 * accidente**: era la primera no vacía porque el servidor falso **no tenía ninguna solicitud
 * `cotizada`**. Al sembrar una —la que necesita la mesa de decisión— el default se movió a «Por
 * ofertar» y quince tests se cayeron a la vez **sin que el producto cambiara**.
 *
 * La lección es del arnés: *un test que no dice en qué pestaña está, está midiendo el orden de
 * los datos.* Ahora cada uno declara su etapa, y sembrar una fila nueva no puede volver a
 * tumbarlos.
 */
async function openStage(label: string) {
  fireEvent.click(await screen.findByRole('tab', { name: new RegExp(`^${label}`) }));
}

describe('M5View · Buylist admin end-to-end', () => {
  it('renderiza la cola con solicitudes, acabado por ítem y botones de decisión', async () => {
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    expect(await screen.findByText('sr-3001')).toBeInTheDocument();
    expect(screen.getByText('sr-3002')).toBeInTheDocument();
    // v1.6-finish: el acabado del ítem es visible (sri-1 = holofoil).
    expect(screen.getAllByText('Holofoil').length).toBeGreaterThan(0);
    // §BUYLIST-FLUJO F2 (diseño A): las cuatro acciones por carta en la fila.
    expect(screen.getAllByRole('button', { name: 'Aprobar al pactado' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^No aceptar/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'No llegó' }).length).toBeGreaterThan(0);
  });

  it('el botón Verificar dispara POST /verify y muestra la confirmación', async () => {
    const spy = vi
      .spyOn(api, 'verifyBuylistRequest')
      // ⚠️ §M5-P: la respuesta de `verify` sobre una fila RECIBIDA lleva las dos marcas. Escribirla
      // sin `receivedAt` sería fabricar la fila del PoC del eje 2 y llamarla camino feliz.
      .mockResolvedValue(srv({ id: 'sr-3002', userId: 'u-778', status: 'verificacion', quotedTotalCents: 1200, createdAt: '', receivedAt: '2026-08-13T09:00:00Z', verifiedAt: '2026-08-13T10:00:00Z', approvedTotalCents: null, offerSentAt: null, items: [] }));
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    // sr-3002 está en `recibida` → muestra "Iniciar verificación".
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar verificación' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3002'));
    expect(await screen.findByText('Verificación iniciada.')).toBeInTheDocument();
  });

  /*
   * ⚠️ v1.56 · §M5-T (MENOR-2 de QA) — `receive`/`verify` ganaron un `409 CONFLICT` al cerrarse la
   * CRÍTICA del doble pago SPEI. Ese `409` NO puede llegarle al operador como «Hubo un conflicto
   * con el estado actual»: en una cola de back-office un genérico se lee como *«la app falló»* y
   * se reintenta, y el dato que hace inútil el reintento —**la solicitud ya cerró**— se queda en
   * el `details` sin usar. El contrato manda **dos** términos (`{ status, closedAt }`) y los dos
   * se miden aquí, incluido el que motivó el segundo: `status` NO terminal con `closedAt` sellado.
   */
  it('409 CONFLICT (§M5-T): dice el estado y que la solicitud YA CERRÓ, no el genérico', async () => {
    vi.spyOn(api, 'verifyBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'CONFLICT',
        message: 'Sell request is terminal or closed',
        details: { status: 'pagada', closedAt: '2026-09-01T18:03:00.000Z' },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar verificación' }));

    const msg = await screen.findByText(/ya está cerrada/);
    // El estado va con su RÓTULO del sistema, nunca el enum crudo (DESIGN_SYSTEM §9.2).
    expect(msg.textContent).toContain('Pagada');
    // Y el genérico desaparece: era exactamente lo que se leía como «la app falló».
    expect(screen.queryByText('Hubo un conflicto con el estado actual.')).toBeNull();
    // ⚠️ Ni marca de tiempo ni cifras internas: `closedAt` decide la FRASE, no se pinta.
    expect(msg.textContent).not.toMatch(/2026-09-01|18:03/);
  });

  it('409 CONFLICT con `status` NO terminal y `closedAt` sellado: también dice que ya cerró (el caso de P1)', async () => {
    vi.spyOn(api, 'verifyBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'CONFLICT',
        message: 'Sell request is terminal or closed',
        details: { status: 'verificacion', closedAt: '2026-09-01T18:03:00.000Z' },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar verificación' }));

    const msg = await screen.findByText(/ya está cerrada/);
    // El segundo término manda aunque el `status` no sea terminal: es el caso que el PoC fabricó.
    expect(msg.textContent).toContain('En verificación');
  });

  it('409 CONFLICT en EN: misma frase enriquecida (paridad ES/EN del copy nuevo)', async () => {
    vi.spyOn(api, 'verifyBuylistRequest').mockRejectedValue(
      new ApiClientError(409, {
        code: 'CONFLICT',
        message: 'Sell request is terminal or closed',
        details: { status: 'pagada', closedAt: '2026-09-01T18:03:00.000Z' },
      }),
    );
    renderWithProviders(<M5View />, 'en');
    await openStage('Verifying');
    fireEvent.click(await screen.findByRole('button', { name: 'Start verification' }));

    const msg = await screen.findByText(/already closed/);
    expect(msg.textContent).toContain('Paid');
    expect(screen.queryByText('There was a conflict with the current state.')).toBeNull();
  });

  it('409 CONFLICT SIN `details`: cae al copy base y no se inventa ningún estado', async () => {
    vi.spyOn(api, 'verifyBuylistRequest').mockRejectedValue(
      new ApiClientError(409, { code: 'CONFLICT', message: 'Sell request is terminal or closed' }),
    );
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    fireEvent.click(await screen.findByRole('button', { name: 'Iniciar verificación' }));

    expect(await screen.findByText('Hubo un conflicto con el estado actual.')).toBeInTheDocument();
    // Sin `details` NO hay nada que enriquecer: ni frase de cierre, ni un placeholder crudo.
    expect(screen.queryByText(/ya está cerrada|\{status\}/)).toBeNull();
  });

  it('Aprobar un ítem llama a la decisión approve y confirma', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue({
      id: 'sri-1',
      card: { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] },
      productType: 'raw',
      finish: 'holofoil',
      itemStatus: 'aprobada',
    });
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    const approveButtons = await screen.findAllByRole('button', { name: 'Aprobar al pactado' });
    fireEvent.click(approveButtons[0]);

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'approve', approvedPriceCents: undefined, receivedLanguage: 'en' }),
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
    await openStage('Verificando');
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
    // Copy i18n del código del contrato, no un genérico — **y se lee del catálogo**, no de un
    // fragmento tecleado aquí: el texto es de ux-ui (DESIGN_SYSTEM §26.3) y este test no debe
    // fijarlo. Lo que sí fija es que **el operador ve el copy y no el inglés del servidor**.
    expect(
      await within(dialog).findByText(es.error.APPROVED_PRICE_CAP_EXCEEDED),
    ).toBeInTheDocument();
    // Y por lo negativo: la cota retirada dentro del ciclo (`cotizado × 2`) no puede volver a
    // explicarse en un mensaje que también sale dentro del ciclo (§26.3, defecto 2 de QA).
    expect(within(dialog).queryByText(/cotizado × 2/)).not.toBeInTheDocument();
  });

  const ITEM_STUB = {
    id: 'sri-1',
    card: { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal' as const] },
    productType: 'raw' as const,
    finish: 'holofoil' as const,
    itemStatus: 'rechazada' as const,
  };

  it('No aceptar abre el selector de causas con la vista previa y envía reasonCode (F2b)', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue(ITEM_STUB);
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    const buttons = await screen.findAllByRole('button', { name: /^No aceptar/ });
    fireEvent.click(buttons[0]);

    // El clic NO envía nada: abre el selector, sin causa elegida el botón está apagado.
    const panel = await screen.findByTestId('f2-panel-reject-sri-1');
    const send = within(panel).getByTestId('f2-reject-send-sri-1');
    expect(send).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();

    // Vista previa del texto que recibirá el vendedor, por causa.
    fireEvent.click(within(panel).getByLabelText(/No llegó en el paquete/));
    expect(within(panel).getByTestId('f2-reject-preview-sri-1').textContent).toContain('no venía dentro');
    expect(within(panel).getByTestId('f2-reject-preview-sri-1').textContent).not.toContain('Tus cartas te esperan');
    fireEvent.click(within(panel).getByLabelText(/Llegó en otra condición/));
    expect(within(panel).getByTestId('f2-reject-preview-sri-1').textContent).toContain('Tus cartas te esperan');

    // «Otra razón» exige texto 3–500 y se envía como `reason`.
    fireEvent.click(within(panel).getByLabelText(/Otra razón/));
    expect(send).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText(/Motivo \(3 a 500/), { target: { value: 'esquina doblada' } });
    fireEvent.click(send);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'reject', reasonCode: 'other', reason: 'esquina doblada' }),
    );
    expect(await screen.findByText(/no se aceptó; el vendedor recibe el correo/)).toBeInTheDocument();
  });

  it('«No llegó» abre el mismo panel con la causa not_received ya elegida (F2b)', async () => {
    const spy = vi.spyOn(api, 'decideBuylistItem').mockResolvedValue(ITEM_STUB);
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    fireEvent.click((await screen.findAllByRole('button', { name: 'No llegó' }))[0]);
    const panel = await screen.findByTestId('f2-panel-reject-sri-1');
    expect(within(panel).getByText(/No se le ofrece recoger la carta/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByTestId('f2-reject-send-sri-1'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sri-1', { decision: 'reject', reasonCode: 'not_received' }));
  });

  it.each([
    [400, { code: 'VALIDATION_ERROR', message: 'x', details: { field: 'reasonCode' } }, 'Elige una causa.'],
    [409, { code: 'REVISION_PENDING', message: 'x', details: { itemIds: ['sri-1'] } }, 'Esta carta tiene una baja esperando al vendedor.'],
    [422, { code: 'REQUEST_NOT_RECEIVED', message: 'x' }, 'No se puede marcar «No llegó» hasta que la solicitud esté recibida.'],
  ])('No aceptar: el %i del servidor se muestra DENTRO del panel con su copy (F2b)', async (status, body, text) => {
    vi.spyOn(api, 'decideBuylistItem').mockRejectedValue(new ApiClientError(status, body));
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    fireEvent.click((await screen.findAllByRole('button', { name: 'No llegó' }))[0]);
    const panel = await screen.findByTestId('f2-panel-reject-sri-1');
    fireEvent.click(within(panel).getByTestId('f2-reject-send-sri-1'));
    expect(await within(panel).findByText(text)).toBeInTheDocument();
  });

  it('Convertir a inventario NO se pinta (ni deshabilitado) si el ítem no está aprobado (§BUYLIST-FLUJO F1)', async () => {
    renderWithProviders(<M5View />, 'es');
    await screen.findAllByText(/^sr-/);
    // Fixture de la etapa inicial: ningún ítem está `aprobada` → ningún botón, ni muerto.
    expect(screen.queryAllByRole('button', { name: 'Convertir a inventario' })).toHaveLength(0);
  });

  it('Revelar CLABE la muestra bajo demanda y Ocultar la retira (no persiste)', async () => {
    const spy = vi
      .spyOn(api, 'revealBuylistClabe')
      .mockResolvedValue({ sellRequestId: 'sr-3001', clabe: '002010077777777771' });
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    const revealButtons = await screen.findAllByRole('button', { name: 'Revelar CLABE' });
    fireEvent.click(revealButtons[0]);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3001'));
    expect(await screen.findByText('002010077777777771')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar CLABE' }));
    expect(screen.queryByText('002010077777777771')).not.toBeInTheDocument();
  });

  /**
   * ⚠️⚠️ **DINERO SALIENTE · §M5-V (v1.61).** Este test afirmaba que «Pagar por SPEI» estaba
   * HABILITADO sobre `sr-3001` —`verificacion`, recibida y verificada, **sin nada aprobado**—, o
   * sea codificaba en verde un estado que el servidor contesta con `422`. Era la reincidencia
   * exacta del defecto de v1.57, una versión de contrato más tarde.
   *
   * Ahora mide las TRES filas que el ciclo produce, y la distinción entre ellas es la norma:
   *  - `sr-3001` — nada aprobado (**V-a**) ⇒ apagado, y **sin** nota: no faltan veredictos.
   *  - `sr-3005` — ciclo con dos líneas `buy` sin juzgar (**V-b**) ⇒ apagado **y dice cuántas**.
   *  - `sr-3006` — cherry-pick con las `buy` aprobadas y la `skip` en `verificacion` ⇒ **paga**.
   */
  function requestCard(id: string): HTMLElement {
    return screen.getByText(id).closest('div.rounded-lg') as HTMLElement;
  }

  it('Pagar por SPEI: paga el ciclo YA DECIDIDO y NO el que tiene líneas compradas sin veredicto', async () => {
    const spy = vi.spyOn(api, 'paySpeiBuylist').mockResolvedValue(
      srv({
        id: 'sr-3006',
        userId: 'u-782',
        status: 'pagada',
        quotedTotalCents: 60000,
        createdAt: '',
        // Una solicitud PAGADA pasó por las cuatro puertas de §M5-V.0.
        receivedAt: '2026-09-02T15:00:00Z',
        verifiedAt: '2026-09-02T16:00:00Z',
        approvedTotalCents: 47000,
        offerSentAt: '2026-08-28T10:00:00Z',
        items: [],
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    await screen.findByText('sr-3001');

    // V-a: recibida y verificada, pero NADA aprobado ⇒ el botón NO se enciende.
    const payable = (card: HTMLElement) =>
      within(card).getByRole('button', { name: 'Pagar por SPEI' }) as HTMLButtonElement;
    expect(payable(requestCard('sr-3001')).disabled).toBe(true);
    // …y no se le echa la culpa a los veredictos: no falta ninguno (§M5-V.6, la escalera).
    expect(within(requestCard('sr-3001')).queryByText(/por decidir/)).toBeNull();

    // V-b: dentro del ciclo, DOS líneas `buy` sin veredicto (la `skip` no cuenta) ⇒ apagado, y la
    // pantalla dice POR QUÉ y a qué acto ir. El número lo da el servidor (`pendingDecisionItemCount`).
    const cycle = requestCard('sr-3005');
    expect(payable(cycle).disabled).toBe(true);
    // Copy NORMATIVO de DESIGN_SYSTEM §27.1.4 (la «cadena preventiva del botón apagado»).
    const hint = within(cycle).getByText('Faltan 2 cartas por decidir antes de poder pagar.');
    expect(hint).toBeInTheDocument();
    // §27.1.4: el botón lo REFERENCIA, para que el lector de pantalla lo anuncie con él.
    expect(payable(cycle).getAttribute('aria-describedby')).toBe(hint.id);

    // Y el camino normal del ciclo SIGUE pagando: sin este assert, un predicado que bloqueara
    // todo pasaría los dos anteriores.
    const cherryPick = requestCard('sr-3006');
    expect(within(cherryPick).queryByText(/por decidir/)).toBeNull();
    fireEvent.click(payable(cherryPick));

    const dialog = await screen.findByRole('dialog', { name: 'Pagar por SPEI' });
    const confirm = await within(dialog).findByRole('button', { name: /Confirmar pago de/ });
    // Referencia obligatoria: sin ella no se puede confirmar.
    expect(confirm).toBeDisabled();
    // F1-1: lo MOSTRADO como «Se deposita» es EXACTAMENTE lo que viaja como `expectedNetCents`.
    const shown = within(dialog).getByTestId('spei-net').textContent as string;
    fireEvent.change(within(dialog).getByLabelText('Referencia o clave de rastreo del SPEI'), {
      target: { value: 'MBAN-2026-081701' },
    });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-3006', 'MBAN-2026-081701', expect.any(Number)));
    const sentNet = spy.mock.calls[0][2] as number;
    expect(shown).toBe(formatMoneyCents(sentNet, 'es'));
    expect(await screen.findByText(/Pago SPEI registrado/)).toBeInTheDocument();
  });

  /**
   * ⚠️ **MEN-2, reabierta por el código nuevo y cerrada aquí.** `422 ITEMS_NOT_DECIDED` (contrato
   * v1.61) no tenía copy, así que `useErrorMessage` caía a `apiError.message` y el súper-admin
   * leía **inglés del servidor en el verbo que saca dinero**. Con §27.1 cableado lee su idioma, y
   * con la cifra que mandó **este** error (§27.1.2: `details.pendingDecisionItemIds.length`).
   */
  it('el 422 ITEMS_NOT_DECIDED se lee en español, con su cifra, y NUNCA en el inglés del servidor', async () => {
    vi.spyOn(api, 'paySpeiBuylist').mockRejectedValue(
      new ApiClientError(422, {
        code: 'ITEMS_NOT_DECIDED',
        message: 'Payment requires a verification verdict on every purchased line',
        details: { sellRequestId: 'sr-3006', pendingDecisionItemIds: ['sri-cp-1', 'sri-cp-2'] },
      }),
    );
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    await screen.findByText('sr-3006');
    fireEvent.click(
      within(requestCard('sr-3006')).getByRole('button', { name: 'Pagar por SPEI' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Pagar por SPEI' });
    fireEvent.change(within(dialog).getByLabelText('Referencia o clave de rastreo del SPEI'), {
      target: { value: 'MBAN-2026-081702' },
    });
    const confirm = await within(dialog).findByRole('button', { name: /Confirmar pago de/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

    expect(await within(dialog).findByText(es.error.ITEMS_NOT_DECIDED_WITH_DETAILS.replace(
      '{count, plural, one {queda # carta sin decidir} other {quedan # cartas sin decidir}}',
      'quedan 2 cartas sin decidir',
    ))).toBeInTheDocument();
    // Las dos mitades del modo de fallo: ni el inglés crudo, ni la base sin cifra.
    expect(within(dialog).queryByText(/Payment requires a verification verdict/)).toBeNull();
    expect(within(dialog).queryByText(es.error.ITEMS_NOT_DECIDED)).toBeNull();
  });

  it('las pestañas filtran por etapa: "Verificando" muestra sr-3001/sr-3002 y "Por pagar" muestra sr-3003', async () => {
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
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
    await openStage('Verificando');
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
    await openStage('Verificando');
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
    await openStage('Verificando');
    // sr-3001 createdAt=2026-08-12 → formatDate es-MX "12 ago 2026".
    await screen.findByText('sr-3001');
    expect(screen.getAllByText(/12 ago 2026/).length).toBeGreaterThan(0);
  });

  it('muestra el total aprobado DEL SERVER (approvedTotalCents, sin sumar en la UI)', async () => {
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    await screen.findByText('sr-3001');
    fireEvent.click(screen.getByRole('tab', { name: /Por pagar/ }));
    // sr-3003: approvedTotalCents=28000 (fixture) → MX$280.00 etiquetado como total aprobado.
    const card = await screen.findByTestId('m5-request-sr-3003');
    expect(within(card).getByText(/Total aprobado/)).toBeInTheDocument();
    expect(within(card).getByText(/Total aprobado/).textContent).toContain('280.00');
  });

  it('pestaña Piezas rechazadas: lista transversal con plazos, fases y SIN convertir a inventario', async () => {
    const DAY = 24 * 3600 * 1000;
    const card: CardDTO = { id: 'c', externalId: 'c', name: 'Umbreon VMAX', number: '215', rarity: 'Rare Rainbow', supertype: 'Pokémon', subtypes: [], setId: 'swsh7', setName: 'Evolving Skies', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
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
    await openStage('Verificando');
    await screen.findByText('sr-3001');
    fireEvent.click(screen.getByRole('tab', { name: /Piezas rechazadas/ }));

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
    await openStage('Por pagar');
    const payButtons = await screen.findAllByRole('button', { name: 'Pagar por SPEI' });
    fireEvent.click(payButtons.find((b) => !(b as HTMLButtonElement).disabled)!);
    const dialog = await screen.findByRole('dialog', { name: 'Pagar por SPEI' });
    fireEvent.change(within(dialog).getByLabelText('Referencia o clave de rastreo del SPEI'), { target: { value: 'X' } });
    const confirm = await within(dialog).findByRole('button', { name: /Confirmar pago de/ });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    fireEvent.click(confirm);

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
  const card: CardDTO = { id: 'c', externalId: 'c', name: 'Charizard', number: '4', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
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
        srv({
          id: 'sr-stuck',
          userId: 'u-900',
          seller: { id: 'u-900', name: 'Ana Ríos', email: 'ana.rios@example.mx' },
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          receivedAt: '2026-08-12T10:00:00.000Z',
          verifiedAt: '2026-08-12T11:00:00.000Z',
          approvedTotalCents: null,
          offerSentAt: null,
          items: [rejectedItem('sri-a'), rejectedItem('sri-b')],
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const spy = vi.spyOn(api, 'rejectBuylistRequest').mockResolvedValue(
      srv({
        id: 'sr-stuck',
        userId: 'u-900',
        status: 'rechazada',
        quotedTotalCents: 45000,
        createdAt: '2026-08-12T00:00:00.000Z',
        receivedAt: '2026-08-12T10:00:00.000Z',
        verifiedAt: '2026-08-12T11:00:00.000Z',
        approvedTotalCents: null,
        offerSentAt: null,
        items: [rejectedItem('sri-a'), rejectedItem('sri-b')],
      }),
    );
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
        srv({
          id: 'sr-mixed',
          userId: 'u-901',
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          receivedAt: '2026-08-12T10:00:00.000Z',
          verifiedAt: '2026-08-12T11:00:00.000Z',
          approvedTotalCents: null,
          offerSentAt: null,
          items: [
            rejectedItem('sri-c'),
            { id: 'sri-d', card, productType: 'raw', finish: 'normal', itemStatus: 'aprobada', approvedPriceCents: 30000 },
          ],
        }),
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
        srv({
          id: 'sr-stuck',
          userId: 'u-900',
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          receivedAt: '2026-08-12T10:00:00.000Z',
          verifiedAt: '2026-08-12T11:00:00.000Z',
          approvedTotalCents: null,
          offerSentAt: null,
          items: [rejectedItem('sri-a')],
        }),
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
describe('M5View · panel de «No aceptar» (el foco no se pierde al escribir)', () => {
  it('escribir varios caracteres seguidos NO pierde el foco del campo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<M5View />, 'es');
    await openStage('Verificando');
    fireEvent.click((await screen.findAllByRole('button', { name: /^No aceptar/ }))[0]);
    const panel = await screen.findByTestId('f2-panel-reject-sri-1');
    fireEvent.click(within(panel).getByLabelText(/Otra razón/));
    const input = within(panel).getByLabelText(/Motivo \(3 a 500/);

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
  const card: CardDTO = { id: 'c', externalId: 'c', name: 'Blastoise', number: '2', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
  const closedReq = (id: string, status: 'pagada' | 'rechazada' | 'abandonada' | 'expirada') =>
    srv({
    id,
    userId: 'u-777',
    seller: { id: 'u-777', name: 'Diana Olvera', email: 'diana.olvera@example.mx' },
    status,
    quotedTotalCents: 50200,
    createdAt: '2026-08-01T00:00:00.000Z',
    receivedAt: '2026-08-01T10:00:00.000Z',
    verifiedAt: '2026-08-01T11:00:00.000Z',
    approvedTotalCents: null,
    offerSentAt: null,
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

  it('al abrir «Cerradas» pide `live=false` (no un CSV de terminales) y pageSize 25', async () => {
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
        // ⚠️ v1.51.8 (BL-18): `live: false`, NO un CSV de terminales. El servidor filtra por
        // EXCLUSIÓN sobre su propio set, así que un terminal nuevo entra a esta pestaña SOLO.
        expect.objectContaining({ live: false, page: 1, pageSize: 25 }),
      ),
    );
    // Y la enumeración NO viaja: si alguien repone el CSV de terminales, esto se pone rojo.
    expect(spy.mock.calls.every(([f]) => f?.status === undefined)).toBe(true);
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

  // IMP-B (regresión): pagar ANTES de convertir movía la solicitud a «Cerradas» y el
  // resumen read-only escondía «Convertir a inventario», atorando una carta `aprobada` que
  // el backend SÍ deja convertir. Ahora el botón se ofrece por-ítem según el `itemStatus`.
  it('«Cerradas»: un ítem aprobado NO convertido ofrece «Convertir a inventario» y lo dispara', async () => {
    const paidWithApprovedItem = srv({
      id: 'sr-c9',
      userId: 'u-777',
      seller: { id: 'u-777', name: 'Diana Olvera', email: 'diana.olvera@example.mx' },
      status: 'pagada' as const,
      quotedTotalCents: 50200,
      approvedTotalCents: 50200,
      createdAt: '2026-08-01T00:00:00.000Z',
      receivedAt: '2026-08-01T10:00:00.000Z',
      verifiedAt: '2026-08-01T11:00:00.000Z',
      offerSentAt: null,
      items: [
        {
          id: 'sr-c9-i',
          card,
          productType: 'raw' as const,
          finish: 'normal' as const,
          // Solicitud pagada, pero el ítem sigue `aprobada` (aún no convertido).
          itemStatus: 'aprobada' as const,
          quotedPriceCents: 50200,
          approvedPriceCents: 50200,
        },
      ],
    });
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [paidWithApprovedItem],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    const convertSpy = vi.spyOn(api, 'convertBuylistItemToInventory').mockResolvedValue({
      inventoryItemId: 'inv-1',
      folio: 'INV-000123',
      alreadyConverted: false,
    });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));
    await screen.findByText('sr-c9');

    fireEvent.click(await screen.findByRole('button', { name: 'Convertir a inventario' }));

    await waitFor(() => expect(convertSpy).toHaveBeenCalledWith('sr-c9-i'));
  });

  it('«Cerradas»: un ítem rechazado NO ofrece «Convertir a inventario»', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [closedReq('sr-c1', 'rechazada')],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));
    await screen.findByText('sr-c1');

    expect(
      screen.queryByRole('button', { name: 'Convertir a inventario' }),
    ).not.toBeInTheDocument();
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

/**
 * v1.51 (M-46) · los CUATRO estados nuevos del enum, y las dos maneras en que M5 podía mentir
 * sobre ellos.
 *
 * 1. **La acción imposible.** `canRejectRequest` salía de `REQUEST_TERMINAL`, un `Set` escrito a
 *    mano con TRES estados. Con `expirada` en el enum (el CUARTO terminal, criterio 113) la
 *    pantalla ofrecía «Rechazar solicitud» sobre una solicitud cerrada y el servidor contestaba
 *    **409**. Se borró el `Set`: ahora se lee `isTerminal`, DERIVADO SERVER-SIDE.
 * 2. **La desaparición silenciosa.** El filtro es
 *    `filtered.filter(r => activeStatuses.includes(r.status))`: un status sin pestaña **no sale
 *    en ninguna vista**, y eso no falla ni avisa. `ofertada`, `aceptada` y `en_transito` no
 *    tenían pestaña.
 */
describe('M5View · los cuatro estados nuevos (v1.51 · M-46)', () => {
  const card: CardDTO = { id: 'c', externalId: 'c', name: 'Blastoise', number: '2', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
  const rejectedItem = (id: string) => ({
    id,
    card,
    productType: 'raw' as const,
    finish: 'normal' as const,
    itemStatus: 'rechazada' as const,
    rejectionReason: 'no es NM: esquina doblada',
    rejectedAt: '2026-08-18T00:00:00.000Z',
  });

  it('una solicitud `expirada` con TODOS los ítems rechazados NO ofrece «Rechazar solicitud»', async () => {
    // Es exactamente la fila que el `Set` viejo daba por NO terminal: cumple la precondición de
    // «todos los ítems rechazados», así que lo único que puede retirar el botón es `isTerminal`.
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        srv({
          id: 'sr-exp',
          userId: 'u-902',
          status: 'expirada',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          // Expiró sin que llegara nada: las dos anclas en `null` y lo dice la fila, no el olvido.
          receivedAt: null,
          verifiedAt: null,
          approvedTotalCents: null,
          offerSentAt: null,
          items: [rejectedItem('sri-e')],
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    // `expirada` es terminal ⇒ vive en «Cerradas», que es server-side: no sale en las operativas.
    await screen.findByRole('tab', { name: /Cerradas/ });
    expect(screen.queryByRole('button', { name: 'Rechazar solicitud' })).not.toBeInTheDocument();
  });

  it('el botón sí aparece sobre una solicitud VIVA equivalente (el contraste que prueba el guard)', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        srv({
          id: 'sr-viva',
          userId: 'u-902',
          status: 'verificacion',
          quotedTotalCents: 45000,
          createdAt: '2026-08-12T00:00:00.000Z',
          receivedAt: '2026-08-12T10:00:00.000Z',
          verifiedAt: '2026-08-12T11:00:00.000Z',
          approvedTotalCents: null,
          offerSentAt: null,
          items: [rejectedItem('sri-v')],
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    expect(await screen.findByRole('button', { name: 'Rechazar solicitud' })).toBeInTheDocument();
  });

  it('sin `isTerminal` (backend previo a v1.51) el cierre NO se ofrece: fail-closed', async () => {
    // Un campo ausente no puede leerse como «sigue viva»: ofrecería un botón que da 409. Se
    // fuerza el shape viejo a propósito — es la única manera de probar la dirección del fallo.
    const legacyRow = {
      id: 'sr-legacy',
      userId: 'u-903',
      status: 'verificacion' as const,
      quotedTotalCents: 45000,
      createdAt: '2026-08-12T00:00:00.000Z',
      items: [rejectedItem('sri-l')],
    } as unknown as Awaited<ReturnType<typeof api.getAdminBuylist>>['data'][number];
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [legacyRow],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-legacy');
    expect(screen.queryByRole('button', { name: 'Rechazar solicitud' })).not.toBeInTheDocument();
  });

  it('`ofertada`, `aceptada` y `en_transito` son VISIBLES: tienen pestaña propia y badge con rótulo', async () => {
    const cycleRow = (id: string, status: 'ofertada' | 'aceptada' | 'en_transito') =>
      srv({
        id,
        userId: 'u-904',
        status,
        quotedTotalCents: 50000,
        createdAt: '2026-08-20T00:00:00.000Z',
        // `ofertada`/`aceptada`/`en_transito`: la carta sigue fuera de nuestras manos.
        receivedAt: null,
        verifiedAt: null,
        approvedTotalCents: null,
        offerSentAt: null,
        items: [],
      });
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        cycleRow('sr-of', 'ofertada'),
        cycleRow('sr-ac', 'aceptada'),
        cycleRow('sr-tr', 'en_transito'),
      ],
      page: 1,
      pageSize: 25,
      total: 3,
    });
    renderWithProviders(<M5View />, 'es');

    // Las tres filas se pintan (la pestaña del ciclo es la primera NO vacía ⇒ etapa por defecto),
    // cada una con su versalita (§23.1a) — no con la clave i18n cruda ni en blanco.
    expect(await screen.findByText('sr-of')).toBeInTheDocument();
    expect(screen.getByText('sr-ac')).toBeInTheDocument();
    expect(screen.getByText('sr-tr')).toBeInTheDocument();

    // Y la pestaña existe y cuenta las TRES.
    const tab = screen.getByRole('tab', { name: /Con el vendedor/ });
    expect(within(tab).getByText('3')).toBeInTheDocument();

    // Cada rótulo sale en DOS superficies: el BADGE de su fila (mono, versalitas) y el paso
    // homónimo del stepper de cada solicitud — el pipeline pasó de CINCO pasos a OCHO (§23.2a).
    // Con la lista vieja de cinco, estos tres estados caían en `currentIdx === -1` y el stepper
    // no marcaba ningún paso: el estado desaparecía también de ahí.
    for (const label of ['Ofertada', 'Aceptada', 'En tránsito']) {
      const nodes = screen.getAllByText(label);
      expect(nodes.some((n) => n.className.includes('font-mono')), `badge de ${label}`).toBe(true);
      expect(nodes.some((n) => !n.className.includes('font-mono')), `paso de ${label}`).toBe(true);
    }
    // El stepper marca el paso actual de cada fila (`aria-current="step"`), uno por solicitud.
    expect(document.querySelectorAll('li[aria-current="step"]')).toHaveLength(3);
  });

  it('«Cerradas» pinta una `expirada` con el copy de su MOTIVO, no con el del estado (§23.1d)', async () => {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [
        srv({
          id: 'sr-exp2',
          userId: 'u-905',
          status: 'expirada',
          expiredReason: 'no_offer',
          quotedTotalCents: 50000,
          createdAt: '2026-08-20T00:00:00.000Z',
          receivedAt: null,
          verifiedAt: null,
          approvedTotalCents: null,
          offerSentAt: null,
          items: [],
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<M5View />, 'es');
    fireEvent.click(await screen.findByRole('tab', { name: /Cerradas/ }));
    await screen.findByText('sr-exp2');
    // «No procedió» (la causa es NUESTRA), no «Expirada» ni el rojo de `rechazada`.
    expect(screen.getByText('No procedió')).toBeInTheDocument();
    expect(screen.queryByText('Expirada')).not.toBeInTheDocument();
  });
});

/**
 * §23.14.6-3bis (v2.3.5) — la comprobación normativa de las pestañas de M5, escrita como
 * **ASERCIÓN POSITIVA** y no como `grep`.
 *
 * El motivo de la forma: *un estado sin pestaña **no falla, no avisa y desaparece del
 * back-office***. Un `grep` de cadenas prohibidas no lo caza —no hay cadena que buscar—, así que
 * lo que se afirma es la **partición TOTAL** del enum. Las dos lecturas baratas de §23.8a
 * (§23.8aa y §23.8ac) sí son cadenas, y van detrás.
 */
describe('M5View · §23.8a — la partición es TOTAL y los rótulos dicen de quién es el pendiente', () => {
  it('los ONCE estados del contrato tienen pestaña, y caen donde manda el mapa normativo', () => {
    // ⚠️ Se escribe el reparto ESPERADO, no se recorre el mapa: recorrerlo se afirmaría a sí
    // mismo. Ésta es la tabla de §23.8a transcrita a mano, que es el punto de la comprobación.
    expect(M5_STATUS_TAB).toEqual({
      cotizada: 'por_ofertar',
      ofertada: 'con_vendedor',
      aceptada: 'con_vendedor',
      en_transito: 'con_vendedor',
      recibida: 'verificando',
      verificacion: 'verificando',
      aprobada: 'por_pagar',
      pagada: 'cerradas',
      rechazada: 'cerradas',
      abandonada: 'cerradas',
      expirada: 'cerradas',
    });
    // Partición: total (los once) y sin solapes (un estado, una pestaña).
    expect(Object.keys(M5_STATUS_TAB)).toHaveLength(11);
  });

  it('`aceptada` NO comparte pestaña con nada que se lea «en camino» (criterio 156)', () => {
    // La restricción que §23.8ab deja viva con el rótulo nuevo. `aceptada` y `en_transito`
    // comparten pestaña, y por eso el rótulo NO puede hablar de tránsito: los distingue el badge.
    expect(M5_STATUS_TAB.aceptada).toBe(M5_STATUS_TAB.en_transito);
    for (const locale of [es, en]) {
      const label = locale.admin.m5.tabs[M5_STATUS_TAB.aceptada as 'con_vendedor'];
      expect(label.toLowerCase()).not.toMatch(/camino|tr[áa]nsito|transit|way|shipping/);
    }
  });

  it('ninguna pestaña dice «recibir»/«receive»: en esa cola no hay nada que recibir (§23.8aa)', () => {
    for (const locale of [es, en]) {
      for (const label of Object.values(locale.admin.m5.tabs)) {
        expect(label.toLowerCase(), `rótulo que induce a esperar: ${label}`).not.toMatch(
          /recib|receiv/,
        );
      }
    }
  });

  it('ninguna pestaña se llama «Rechazadas»/"Rejected" A SECAS (colisión con el estado, §23.8ac)', () => {
    // A secas colisiona con el ESTADO `rechazada` de solicitud, que vive en «Cerradas». Con el
    // objeto nombrado («Piezas rechazadas» / "Rejected items") deja de haber misnavegación.
    expect(es.admin.m5.tabs.piezas_rechazadas).toBe('Piezas rechazadas');
    expect(en.admin.m5.tabs.piezas_rechazadas).toBe('Rejected items');
    for (const locale of [es, en]) {
      for (const label of Object.values(locale.admin.m5.tabs)) {
        expect(['Rechazadas', 'Rejected']).not.toContain(label);
      }
    }
  });

  it('las TRES claves viejas no existen en NINGUNO de los dos catálogos (paridad estricta)', () => {
    // «Una clave viva en un solo idioma es el modo típico en que un texto retirado revive.»
    for (const locale of [es, en]) {
      for (const vieja of ['por_recibir', 'ciclo', 'rechazadas']) {
        expect(Object.keys(locale.admin.m5.tabs)).not.toContain(vieja);
      }
    }
  });

  it('el orden de la barra sigue el pipeline y los identificadores SON las claves i18n', () => {
    expect(M5_OP_TAB_ORDER).toEqual(['por_ofertar', 'con_vendedor', 'verificando', 'por_pagar']);
    // El desfase que §23.8a vino a quitar del texto no puede volver por el código: si alguien
    // renombra el rótulo sin renombrar el discriminante, esto se pone rojo.
    const tabs = new Set(Object.values(M5_STATUS_TAB));
    for (const key of tabs) {
      expect(Object.keys(es.admin.m5.tabs), `sin clave i18n: ${key}`).toContain(key);
      expect(Object.keys(en.admin.m5.tabs), `sin clave i18n: ${key}`).toContain(key);
    }
  });
});

/**
 * v1.51.8 (§4.39c **sitio 10**) · el botón de PAGAR POR SPEI — **dinero saliente**.
 *
 * Aquí vivía la **sexta copia** de un subconjunto de estados: `canPay = isSuperAdmin && (status
 * === 'aprobada' || status === 'verificacion')`. Y no era una copia que pudiera desincronizarse
 * algún día: **ya lo estaba**, porque la precondición del servidor **nunca fue solo el `status`**
 * y el cliente replicaba justamente ese término y ninguno más ⇒ la pantalla ofrecía pagar donde el
 * servidor responde `422`.
 *
 * *(La forma de entonces —`status ∈ PAYABLE ∧ verifiedAt != null`, v1.51.8— está **SUPERSEDED**:
 * la fórmula viva, y su cuenta, viven en el contrato §M5-V.0 y desde entonces han crecido dos
 * veces. Aquí no se transcribe ninguna de las dos cosas, que es de lo que va este bloque.)*
 *
 * El remedio no fue copiar bien las condiciones —eso duplicaría la regla entera en vez de borrarla
 * y metería `verifiedAt` en la lógica de una pantalla—: lo deriva el servidor en `isPayable`.
 */
describe('M5View · `isPayable` gobierna el botón de pagar (v1.51.8)', () => {
  const card: CardDTO = { id: 'c', externalId: 'c', name: 'Blastoise', number: '2', rarity: 'Rare Holo', supertype: 'Pokémon', subtypes: [], setId: 'base1', setName: 'Base Set', setPtcgoCode: null, imageSmallUrl: '', imageLargeUrl: '', availableFinishes: ['normal'] };
  const row = (id: string, extra: Record<string, unknown>) => ({
    id,
    userId: 'u-910',
    status: 'aprobada' as const,
    quotedTotalCents: 30000,
    createdAt: '2026-08-20T00:00:00.000Z',
    items: [
      {
        id: `${id}-i`,
        card,
        productType: 'raw' as const,
        finish: 'normal' as const,
        itemStatus: 'aprobada' as const,
        quotedPriceCents: 30000,
      },
    ],
    ...extra,
  });

  function withRow(extra: Record<string, unknown>) {
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({
      data: [row('sr-pay', extra) as unknown as AdminBuylistDTO],
      page: 1,
      pageSize: 25,
      total: 1,
    });
  }

  it('`aprobada` SIN verificar (`isPayable:false`) NO habilita el pago, aunque el estado sea pagable', async () => {
    // ⚠️ El caso exacto que el literal viejo no podía ver: el término de `status` se cumple y el
    // de la verificación no. Antes el botón salía habilitado y el servidor contestaba 422.
    // *(Sin ordinales a propósito: la posición de cada término en §M5-V.0 ya cambió dos veces.)*
    withRow({ isTerminal: false, isPayable: false });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-pay');
    expect(screen.getByRole('button', { name: 'Pagar por SPEI' })).toBeDisabled();
  });

  it('«nunca 0»: un ítem sin `quotedPriceCents` muestra «—», no MX$0.00', async () => {
    const r = row('sr-np', { isTerminal: false }) as unknown as AdminBuylistDTO;
    (r.items[0] as { quotedPriceCents: number | null }).quotedPriceCents = null;
    vi.spyOn(api, 'getAdminBuylist').mockResolvedValue({ data: [r], page: 1, pageSize: 25, total: 1 });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-np');
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
  });

  it('con `isPayable:true` sí lo habilita', async () => {
    withRow({ isTerminal: false, isPayable: true });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-pay');
    expect(screen.getByRole('button', { name: 'Pagar por SPEI' })).toBeEnabled();
  });

  it('sin el campo (backend previo a v1.51.8) el pago NO se habilita: fail-closed', async () => {
    // El `=== true` importa más aquí que en `isTerminal`: el botón que sobra es de PAGO.
    withRow({ isTerminal: false });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-pay');
    expect(screen.getByRole('button', { name: 'Pagar por SPEI' })).toBeDisabled();
  });

  it('el ROL no se funde en el campo: sin super_admin no hay pago ni con `isPayable:true`', async () => {
    // «¿está en condición de pagarse?» (la fila) y «¿puedo pagarla yo?» (el actor) son dos
    // preguntas; el campo contesta la primera y el rol se queda en el cliente. Aquí el mock de
    // `useRole` fija `super_admin`, así que se comprueba la mitad que SÍ es observable: el campo
    // por sí solo no basta para que el botón exista fuera de la sección de dinero.
    withRow({ isTerminal: false, isPayable: true });
    renderWithProviders(<M5View />, 'es');
    await screen.findByText('sr-pay');
    // La CLABE (misma sección de dinero, mismo gate de rol) sigue detrás del rol, no de isPayable.
    expect(screen.getByRole('button', { name: 'Revelar CLABE' })).toBeInTheDocument();
  });
});
