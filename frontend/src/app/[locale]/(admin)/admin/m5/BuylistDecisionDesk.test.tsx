import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistDecisionDesk } from './BuylistDecisionDesk';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { BuylistDecisionLineDTO, BuylistDecisionTableDTO } from '@/types/contract';

const CARD = {
  id: 'c-1',
  externalId: 'x',
  name: 'Charizard VMAX',
  number: '020/189',
  rarity: 'Rare Holo',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's',
  setName: 'Darkness Ablaze',
  setPtcgoCode: null,
  imageSmallUrl: '',
  imageLargeUrl: '',
  availableFinishes: ['holofoil' as const],
};

function line(over: Partial<BuylistDecisionLineDTO> = {}): BuylistDecisionLineDTO {
  return {
    itemId: 'i-1',
    card: { ...CARD, ...(over.card ?? {}) },
    productType: 'raw',
    finish: 'holofoil',
    cardProductId: null,
    quotedPriceCents: 90000,
    derivedPriceCents: 84000,
    priceBasis: 'market',
    pendingReason: null,
    position: { stock: 5, verifying: 1, inTransit: 1, committed: 2, total: 9 },
    suggestion: { verdict: 'buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
    ...over,
  };
}

function table(over: Partial<BuylistDecisionTableDTO> = {}): BuylistDecisionTableDTO {
  return {
    sellRequestId: 'sr-1',
    status: 'cotizada',
    quotedTotalCents: 90000,
    lines: [line()],
    totals: {
      buyableGrossCents: 84000,
      shippingFeeCents: 18000,
      netCents: 66000,
      minimumOfferNetCents: 20000,
      requiredGrossCents: 38000,
      netBelowMinimum: false,
    },
    operatorCapCents: 150000,
    requiresAuthorization: false,
    pickupAddressMissing: false,
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function render(dto: BuylistDecisionTableDTO, locale: 'es' | 'en' = 'es') {
  vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue(dto);
  return renderWithProviders(<BuylistDecisionDesk sellRequestId="sr-1" onClose={() => {}} />, locale);
}

/** La fila es compacta: el campo de precio solo existe tras «Editar oferta». */
async function findAmount(name = 'Charizard VMAX') {
  fireEvent.click(await screen.findByRole('button', { name: `Editar oferta: ${name}` }));
  return (await screen.findByLabelText(`Precio ofertado para ${name}`)) as HTMLInputElement;
}

describe('Mesa de decisión — las cifras que pidió el humano', () => {
  it('pinta la POSICIÓN como una fracción y los CUATRO sumandos por separado', async () => {
    render(table());
    const strip = await screen.findByTestId('position-strip');
    // Primer tiempo: UNA cifra sobre su umbral.
    expect(within(strip).getByText('Posición 9/10')).toBeInTheDocument();
    // Segundo tiempo: los cuatro, cada uno con su etiqueta.
    for (const label of ['En inventario', 'Verificando', 'En camino', 'Comprometido']) {
      expect(within(strip).getByText(label)).toBeInTheDocument();
    }
    // Los grupos son encabezados REALES: el lector anuncia el grupo antes del número.
    const inHouse = within(strip).getByText('En nuestras manos');
    expect(inHouse.tagName).toBe('TH');
    expect(inHouse).toHaveAttribute('colspan', '2');
    expect(within(strip).getByText('Todavía no').tagName).toBe('TH');
  });

  /**
   * ⚠️ R6 — «en camino» y «comprometido» **no se suman jamás**. La prueba lo mide por lo que NO
   * está: ningún subtotal, ningún `+`, ninguna etiqueta que agrupe las dos en una cifra. El
   * ÚNICO sitio donde los cuatro se suman es `POSICIÓN`, y esa palabra no significa inventario.
   */
  it('NO ofrece ningún subtotal que sume «en camino» + «comprometido»', async () => {
    render(table());
    const strip = await screen.findByTestId('position-strip');
    const text = strip.textContent ?? '';
    expect(text).not.toMatch(/\+/);
    expect(text).not.toMatch(/por llegar|subtotal|en total/i);
    // `3` (1 en camino + 2 comprometidas) no aparece como cifra suelta en ninguna celda.
    const cells = within(strip).getAllByRole('cell');
    expect(cells.map((c) => c.textContent?.replace(/\D/g, ''))).not.toContain('3');
  });

  /**
   * ⚠️ §23.7 — el caso que esta pantalla existe para no confundir. `position: null` +
   * `positionUnavailable` significa **«no pude contar»**, NO cero: un cero se ve confiable y
   * empuja a comprar de más.
   */
  it('SIN CONTEO: desaparece la tira ENTERA —incluido el titular— y aparece una frase', async () => {
    render(table({ lines: [line({ position: null, positionUnavailable: true })] }));
    const box = await screen.findByTestId('position-unavailable');
    expect(within(box).getByText('Sin conteo')).toBeInTheDocument();
    expect(within(box).getByText('No pudimos contar el inventario de esta carta.')).toBeInTheDocument();
    // Ni tira, ni titular, ni denominador: un «—/10» se lee como «0/10».
    expect(screen.queryByTestId('position-strip')).not.toBeInTheDocument();
    expect(screen.queryByText(/Posición/)).not.toBeInTheDocument();
    /*
     * §23.7b — las prohibiciones. Se miden sobre los NODOS, no sobre la cadena entera: el em
     * dash de «Sin sugerencia — falta el conteo» es puntuación de prosa, mientras que lo
     * prohibido es un `—` **ocupando el sitio de un valor** (ahí ya significa «precio
     * pendiente», §16.3a, y además se lee como cero). La regla real es: **ningún nodo cuyo
     * texto completo sea un marcador de hueco**, y ningún `0`.
     */
    expect(box.textContent).not.toMatch(/\b0\b/);
    const placeholders = new Set(['—', '–', '-', '?', 'N/D', 'n/a', '']);
    for (const node of box.querySelectorAll('*')) {
      expect(placeholders.has((node.textContent ?? '').trim())).toBe(false);
    }
    // Nunca se infiere veredicto.
    expect(within(box).getByText('Sin sugerencia — falta el conteo.')).toBeInTheDocument();
  });

  it('un CERO REAL sí se pinta, con su retícula y su titular (el contraste que lo hace legible)', async () => {
    render(
      table({
        lines: [line({ position: { stock: 0, verifying: 0, inTransit: 0, committed: 0, total: 0 } })],
      }),
    );
    const strip = await screen.findByTestId('position-strip');
    expect(within(strip).getByText('Posición 0/10')).toBeInTheDocument();
    expect(within(strip).getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('position-unavailable')).not.toBeInTheDocument();
  });

  it('la sugerencia es una FRASE con cifras, y solo «no comprar» se destaca', async () => {
    render(
      table({
        lines: [
          line({
            position: { stock: 8, verifying: 1, inTransit: 0, committed: 1, total: 10 },
            suggestion: { verdict: 'do_not_buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
          }),
        ],
      }),
    );
    const s = await screen.findByTestId('suggestion');
    expect(s).toHaveTextContent('Sugerencia: no comprar');
    expect(s).toHaveTextContent('la posición llegó al tope de 10 piezas por variante.');
    // Asimetría: la palabra que dice «para» es la única con color y peso.
    expect(within(s).getByText('no comprar').className).toContain('text-accent');
  });

  it('un bounty vivo SIN objetivo se explica en vez de callarse (caso legacy legible)', async () => {
    render(
      table({
        lines: [
          line({
            suggestion: { verdict: 'buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: true },
          }),
        ],
      }),
    );
    expect(await screen.findByTestId('suggestion')).toHaveTextContent(
      'Este bounty no tiene objetivo; se está midiendo con el tope.',
    );
  });
});

describe('Mesa de decisión — decidir y emitir', () => {
  it('las líneas con precio nacen marcadas; las sin precio, desmarcadas y bloqueadas', async () => {
    render(
      table({
        lines: [
          line({ itemId: 'a' }),
          line({ itemId: 'b', card: { ...CARD, id: 'c-2', name: 'Snorlax V' }, derivedPriceCents: null }),
        ],
      }),
    );
    const conPrecio = await screen.findByLabelText('Comprar Charizard VMAX');
    const sinPrecio = screen.getByLabelText('Comprar Snorlax V');
    expect(conPrecio).toBeChecked();
    expect(sinPrecio).not.toBeChecked();
    expect(sinPrecio).toBeDisabled();
    // Y jamás MX$0.00 en la línea sin precio: cero es un precio.
    expect(screen.getByTestId('line-no-price')).toHaveTextContent('Sin precio');
    expect(screen.queryByText('MX$0.00')).not.toBeInTheDocument();
  });

  /** D6 llevado al default: la sugerencia informa, NO preselecciona. */
  it('una línea `do_not_buy` nace MARCADA — la inercia no decide por el operador', async () => {
    render(
      table({
        lines: [
          line({
            suggestion: { verdict: 'do_not_buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
          }),
        ],
      }),
    );
    expect(await screen.findByLabelText('Comprar Charizard VMAX')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Emitir oferta' })).toBeEnabled();
  });

  it('al desmarcar, los totales bajan y el piso apaga el botón CON su motivo', async () => {
    render(
      table({
        lines: [line({ itemId: 'a' }), line({ itemId: 'b', card: { ...CARD, id: 'c-2', name: 'Pikachu VMAX' }, derivedPriceCents: 30000 })],
      }),
    );
    await screen.findByTestId('desk-totals');
    // 84000 + 30000 = 114000 centavos de bruto; − 18000 de envío ⇒ 96000 centavos = MX$960.00.
    expect(screen.getByTestId('desk-net')).toHaveTextContent('MX$960.00');

    fireEvent.click(screen.getByLabelText('Comprar Charizard VMAX'));
    await waitFor(() => expect(screen.getByTestId('desk-net')).toHaveTextContent('MX$120.00'));

    const emit = screen.getByRole('button', { name: 'Emitir oferta' });
    expect(emit).toBeDisabled();
    // §15.9 — apagado pero NUNCA mudo: el motivo, el mínimo y el remedio, con cifras del servidor.
    expect(emit).toHaveAttribute('aria-describedby', 'desk-blocker');
    const why = document.getElementById('desk-blocker');
    expect(why).toHaveTextContent('el depósito quedaría en MX$120.00 y el mínimo es MX$200.00');
    // requiredGross 38000 − bruto 30000 = 8000 centavos = MX$80.00, expresado en BRUTO porque
    // es la única palanca que el operador puede mover.
    expect(why).toHaveTextContent('Agrega MX$80.00 de bruto');
  });

  /**
   * ⚠️ EL PRE-LLENADO Y SU GUARDA. El campo «Precio ofertado» nace MOSTRANDO el precio con que se
   * cotizó (`derivedPriceCents`) —no vacío— para que el operador confirme/ajuste en vez de teclear
   * en blanco (un campo vacío invitó al `0.01` fantasma). Pero es SOLO display: mientras no lo
   * cambie, la línea sigue SIN override —basis derivado, sin motivo, sin `overridePriceCents`—.
   */
  it('(a) el campo «Precio ofertado» nace PRE-LLENADO con el derivado, no vacío', async () => {
    render(table()); // derivedPriceCents 84000 ⇒ $840
    const amount = await findAmount();
    expect(amount.value).toBe('840');
    // Pre-llenar NO es ajustar: no hay motivo ni marca de override.
    expect(screen.queryByLabelText('Motivo del ajuste')).not.toBeInTheDocument();
  });

  /**
   * ⚠️ Carta SIN derivado (null / PRICE_PENDING): el campo queda VACÍO. No se inventa un precio en
   * un campo que decide dinero.
   */
  it('(a·bis) sin `derivedPriceCents` el campo queda VACÍO —no se inventa precio', async () => {
    render(table({ lines: [line({ derivedPriceCents: null })] }));
    const amount = await findAmount();
    expect(amount.value).toBe('');
  });

  it('(b) SIN tocar nada la línea NO es manual: la oferta emite el DERIVADO sin `overridePriceCents`', async () => {
    render(table()); // una sola línea con derivedPriceCents 84000
    const spy = vi.spyOn(api, 'emitBuylistOffer').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'ofertada',
      offerState: 'sent',
      offerSentAt: '2026-09-01T12:00:00.000Z',
      offerGrossCents: 84000,
      offerShippingFeeCents: 18000,
      offerNetCents: 66000,
      offerAcceptDeadlineAt: '2026-09-03T18:00:00.000Z',
      requiresAuthorization: false,
      items: [],
    });
    // El campo nace en '840' (el derivado); NO lo tocamos.
    const amount = await findAmount();
    expect(amount.value).toBe('840');

    fireEvent.click(screen.getByRole('button', { name: 'Emitir oferta' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir la oferta y mandar el correo' }));
    // Basis derivado ⇒ la línea viaja como `buy` PELADA: sin `overridePriceCents`, sin `overrideReason`.
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sr-1', [{ itemId: 'i-1', decision: 'buy', expectedDerivedCents: 84000 }]),
    );
  });

  it('(c) al CAMBIAR el pre-llenado a un monto distinto, la línea SÍ se vuelve override', async () => {
    render(table());
    const amount = await findAmount();
    // Arranca en el derivado, sin motivo.
    expect(amount.value).toBe('840');
    expect(screen.queryByLabelText('Motivo del ajuste')).not.toBeInTheDocument();

    // Cambiarlo a un monto DISTINTO ⇒ ahora es override: aparece el motivo y la basis lo marca.
    fireEvent.change(amount, { target: { value: '900' } });
    const reason = await screen.findByLabelText('Motivo del ajuste');
    expect(reason).toBeInTheDocument();
    fireEvent.change(reason, { target: { value: 'el mercado se movió' } });

    const spy = vi.spyOn(api, 'emitBuylistOffer').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'ofertada',
      offerState: 'sent',
      offerSentAt: '2026-09-01T12:00:00.000Z',
      offerGrossCents: 90000,
      offerShippingFeeCents: 18000,
      offerNetCents: 72000,
      offerAcceptDeadlineAt: '2026-09-03T18:00:00.000Z',
      requiresAuthorization: false,
      items: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Emitir oferta' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir la oferta y mandar el correo' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sr-1', [
        { itemId: 'i-1', decision: 'buy', expectedDerivedCents: 84000, overridePriceCents: 90000, overrideReason: 'el mercado se movió' },
      ]),
    );
  });

  it('el override exige motivo, y mandar el derivado EXACTO no lo exige', async () => {
    render(table());
    const amount = await findAmount();

    // Delta ≠ 0 ⇒ aparece el motivo y el botón se apaga hasta que sea válido.
    fireEvent.change(amount, { target: { value: '900' } });
    const reason = await screen.findByLabelText('Motivo del ajuste');
    expect(screen.getByRole('button', { name: 'Emitir oferta' })).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'el mercado se movió' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Emitir oferta' })).toBeEnabled(),
    );

    // Delta EXACTAMENTE cero ⇒ no es override: el campo de motivo desaparece.
    fireEvent.change(amount, { target: { value: '840' } });
    await waitFor(() => expect(screen.queryByLabelText('Motivo del ajuste')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Emitir oferta' })).toBeEnabled();
  });

  it('emite cubriendo EXACTAMENTE los ítems: lo no marcado viaja como `skip`', async () => {
    render(
      table({
        lines: [line({ itemId: 'a' }), line({ itemId: 'b', card: { ...CARD, id: 'c-2', name: 'Pikachu VMAX' }, derivedPriceCents: 30000 })],
      }),
    );
    const spy = vi.spyOn(api, 'emitBuylistOffer').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'ofertada',
      offerState: 'sent',
      offerSentAt: '2026-09-01T12:00:00.000Z',
      offerGrossCents: 84000,
      offerShippingFeeCents: 18000,
      offerNetCents: 66000,
      offerAcceptDeadlineAt: '2026-09-03T18:00:00.000Z',
      requiresAuthorization: false,
      items: [],
    });

    fireEvent.click(await screen.findByLabelText('Comprar Pikachu VMAX'));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir oferta' }));
    const dialog = await screen.findByRole('dialog');
    // La confirmación repite líneas y los TRES montos.
    expect(dialog).toHaveTextContent('1 carta por un bruto de MX$840.00');
    expect(dialog).toHaveTextContent('envío de MX$180.00');
    expect(dialog).toHaveTextContent('se depositan MX$660.00');
    // ⛔ No se señala cuántas líneas iban contra la sugerencia: sería la fricción que D6 prohíbe.
    expect(dialog.textContent).not.toMatch(/sugerencia/i);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir la oferta y mandar el correo' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sr-1', [
        { itemId: 'a', decision: 'buy', expectedDerivedCents: 84000 },
        { itemId: 'b', decision: 'skip' },
      ]),
    );
    expect(await screen.findByText(/Oferta emitida/)).toBeInTheDocument();
  });

  /**
   * ⚠️ Los DOS desenlaces. Una oferta `pending_authorization` **no existe para el vendedor**: la
   * pantalla no puede sugerir lo contrario, y el verbo del botón lo dice desde antes.
   */
  it('sobre el tope: el botón cambia de VERBO y el desenlace dice que el correo NO salió', async () => {
    render(table({ requiresAuthorization: true }));
    expect(await screen.findByRole('button', { name: 'Enviar a autorización' })).toBeEnabled();
    expect(screen.getByText('El correo no sale hasta que el súper-admin la autorice.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir oferta' })).not.toBeInTheDocument();

    vi.spyOn(api, 'emitBuylistOffer').mockResolvedValue({
      sellRequestId: 'sr-1',
      status: 'cotizada',
      offerState: 'pending_authorization',
      offerSentAt: null,
      offerGrossCents: 84000,
      offerShippingFeeCents: 18000,
      offerNetCents: 66000,
      offerAcceptDeadlineAt: null,
      requiresAuthorization: true,
      items: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a autorización' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mandar a autorización' }));
    expect(
      await screen.findByText(/El correo NO se ha mandado y la solicitud sigue igual para el vendedor/),
    ).toBeInTheDocument();
  });

  it('sin dirección de origen no se puede emitir, y se dice el REMEDIO', async () => {
    render(table({ pickupAddressMissing: true }));
    const emit = await screen.findByRole('button', { name: 'Emitir oferta' });
    expect(emit).toBeDisabled();
    expect(
      screen.getAllByText(/Llámalo \(tienes su teléfono en la cola\)/).length,
    ).toBeGreaterThan(0);
  });

  it('el conteo caído avisa a nivel de pantalla y NO apaga el botón', async () => {
    render(table({ lines: [line({ position: null, positionUnavailable: true })] }));
    expect(
      await screen.findByText(/No pudimos contar el inventario de 1 de 1 cartas/),
    ).toBeInTheDocument();
    // Se puede ofertar sin conteo: lo que falta es el consejo, no el permiso.
    expect(screen.getByRole('button', { name: 'Emitir oferta' })).toBeEnabled();
  });

  it('el 422 del servidor se pinta como alerta, no como toast', async () => {
    render(table());
    vi.spyOn(api, 'emitBuylistOffer').mockRejectedValue(
      new ApiClientError(422, {
        code: 'OFFER_NET_BELOW_MINIMUM',
        message: 'net below minimum',
        details: { grossCents: 1, shippingFeeCents: 18000, netCents: 0 },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir oferta' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir la oferta y mandar el correo' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('emitida ⇒ la mesa es de SOLO LECTURA (el override vive solo antes del correo)', async () => {
    render(table({ status: 'ofertada' }));
    // §60.5 d: fuera de `cotizada` el texto dice DÓNDE está la acción, por estado.
    expect(
      await screen.findByText('La oferta ya salió y el vendedor la tiene. Para cambiarla o cerrarla, usa «Cancelar la oferta» en la solicitud.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir oferta' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Precio ofertado para Charizard VMAX')).not.toBeInTheDocument();
  });

  it('EN: la mesa existe entera en inglés (paridad)', async () => {
    render(table(), 'en');
    expect(await screen.findByText('Position 9/10')).toBeInTheDocument();
    expect(screen.getByText('In our hands')).toBeInTheDocument();
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue offer' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/admin\.m5\.desk/);
  });
});

/**
 * BRJ-UI-2 = FE-BRJ-2 (DESIGN_SYSTEM §60.5 d · contrato v1.82 §PNL.4): «Declinar» DENTRO de la mesa en `cotizada`,
 * que llama al MISMO `onDecline` que abre el diálogo de la fila; en `aceptada` no hay «Declinar» y el texto dice
 * dónde está la acción. Canario: ofrecer «Declinar» en `aceptada`.
 */
describe('BRJ-UI-2 · «Declinar» en la mesa', () => {
  it('cotizada ⇒ «Declinar» junto a «Emitir oferta», y lo pulsa ⇒ onDecline', async () => {
    const onDecline = vi.fn();
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue(table());
    renderWithProviders(<BuylistDecisionDesk sellRequestId="sr-1" onClose={() => {}} onDecline={onDecline} />, 'es');
    await screen.findByRole('button', { name: 'Emitir oferta' });
    fireEvent.click(screen.getByTestId('desk-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it.each([
    // ✏ §BSD-UX.6a: la nota ya no dice «ya no se cancela» (en `aceptada` existe «Declinar» — el de la FICHA, no el de la mesa).
    ['aceptada', 'El vendedor aceptó. Genera su guía para que mande las cartas; si ya no quieres comprarlas, puedes declinarla mientras no diga que ya las mandó.'],
    ['en_transito', 'El paquete viene en camino. Cuando llegue, pulsa «Recibida: empezar revisión» y rechaza ahí las cartas que vengan mal.'],
    ['verificacion', 'Está en revisión: aprueba o rechaza cada carta en la solicitud, o marca varias y «Rechazar seleccionadas».'],
    ['pagada', 'Esta solicitud ya no tiene nada que decidir aquí.'],
  ] as const)('%s ⇒ sin «Declinar» y con su texto', async (status, text) => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue(table({ status }));
    renderWithProviders(<BuylistDecisionDesk sellRequestId="sr-1" onClose={() => {}} onDecline={() => {}} />, 'es');
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByTestId('desk-decline')).not.toBeInTheDocument();
  });
});

describe('Mesa de decisión — diseño A (BUYLIST-MESA)', () => {
  const photoCard = { imageSmallUrl: 'https://img/s.png', imageLargeUrl: 'https://img/l.png' };
  const mesa = {
    marketMxnCents: 100000,
    standardOfferCents: 70000,
    standardPctBp: 7000,
  };
  const lines = [
    line({ itemId: 'a', card: { ...CARD, ...photoCard, name: 'Std' }, derivedPriceCents: 70000, ...mesa, adjustment: null, sinceQuote: null }),
    line({
      itemId: 'b',
      card: { ...CARD, name: 'Sube' },
      derivedPriceCents: 75000,
      ...mesa,
      adjustment: { deltaCents: 5000, reasonCode: 'BOUNTY', reasonText: 'Hay un bounty.' },
      sinceQuote: { quotedCents: 70000, deltaCents: 5000, reasonCode: 'MARKET_UP', reasonText: 'x' },
    }),
    line({
      itemId: 'c',
      card: { ...CARD, name: 'Baja' },
      derivedPriceCents: 50000,
      ...mesa,
      adjustment: { deltaCents: -20000, reasonCode: 'STOCK_CAP', reasonText: 'Ya tenemos 10.' },
      position: { stock: 10, verifying: 0, inTransit: 0, committed: 0, total: 10 },
      suggestion: { verdict: 'do_not_buy', rule: 'variant_cap', thresholdQty: 10, bountyActive: false },
    }),
    line({
      itemId: 'd',
      card: { ...CARD, name: 'Nada' },
      derivedPriceCents: null,
      priceBasis: 'pending',
      pendingReason: 'no_market',
      marketMxnCents: null,
      standardOfferCents: null,
      standardPctBp: null,
      adjustment: null,
    }),
  ];

  it('un chip por fila según adjustment, con motivo y delta; la nota sinceQuote va aparte', async () => {
    render(table({ lines }));
    await screen.findAllByTestId('desk-line');
    const chips = screen.getAllByTestId('line-chip').map((c) => c.getAttribute('data-chip'));
    expect(chips).toEqual(['standard', 'up', 'down', 'noPrice']);
    expect(screen.getAllByTestId('line-chip')[1]).toHaveTextContent('Subida +MX$50.00');
    expect(screen.getAllByTestId('line-chip')[2]).toHaveTextContent('Bajada −MX$200.00');
    expect(screen.getByText('Ya tenemos 10.')).toBeInTheDocument();
    expect(screen.getByTestId('line-since-quote')).toHaveTextContent('Cotizamos MX$700.00; hoy ofertamos MX$750.00 (MX$50.00 más): el mercado subió desde la cotización');
    expect(screen.getAllByTestId('line-standard')[0]).toHaveTextContent('70 % → MX$700.00');
    expect(screen.getAllByTestId('line-stock')[2]).toHaveTextContent('ya no necesitamos');
    expect(screen.getAllByTestId('line-stock')[0]).toHaveTextContent('Tenemos 9 · aceptamos hasta 10');
  });

  it('«Solo las que cambian» oculta las Estándar', async () => {
    render(table({ lines }));
    await screen.findAllByTestId('desk-line');
    fireEvent.click(screen.getByRole('button', { name: /Solo las que cambian \(3\)/ }));
    expect(screen.getAllByTestId('desk-line')).toHaveLength(3);
  });

  it('el campo de precio solo aparece al editar (tecla E o botón) y no repite «Derivado por la curva»', async () => {
    render(table({ lines }));
    const list = (await screen.findAllByTestId('desk-line'))[0].parentElement!;
    expect(screen.queryByLabelText(/Precio ofertado para/)).not.toBeInTheDocument();
    list.focus();
    fireEvent.keyDown(list, { key: 'e' });
    expect(await screen.findByLabelText('Precio ofertado para Std')).toBeInTheDocument();
    expect(screen.queryByText(/Derivado por la curva/)).not.toBeInTheDocument();
  });

  it('la foto se amplía en un visor que cierra con Esc', async () => {
    render(table({ lines }));
    fireEvent.click(await screen.findByTestId('line-photo'));
    const img = await screen.findByTestId('photo-viewer-img');
    expect(img).toHaveAttribute('src', 'https://img/l.png');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('photo-viewer-img')).not.toBeInTheDocument());
  });

  it('atajos: ↓ mueve, Espacio marca/desmarca', async () => {
    render(table({ lines }));
    const list = (await screen.findAllByTestId('desk-line'))[0].parentElement!;
    list.focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(screen.getAllByTestId('desk-line')[1]).toHaveAttribute('aria-current', 'true');
    const box = within(screen.getAllByTestId('desk-line')[1]).getByRole('checkbox');
    expect(box).toBeChecked();
    fireEvent.keyDown(list, { key: ' ' });
    expect(box).not.toBeChecked();
  });

  it('409 OFFER_PRICE_CHANGED ⇒ sin éxito, refresca la mesa y resalta la línea con «cambió de X a Y»', async () => {
    const get = vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue(table());
    renderWithProviders(<BuylistDecisionDesk sellRequestId="sr-1" onClose={() => {}} />, 'es');
    vi.spyOn(api, 'emitBuylistOffer').mockRejectedValue(
      new ApiClientError(409, {
        code: 'OFFER_PRICE_CHANGED',
        message: 'changed',
        details: { lines: [{ lineId: 'i-1', expectedCents: 84000, currentCents: 86000 }] },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir oferta' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir la oferta y mandar el correo' }));
    const note = await screen.findByTestId('line-price-changed');
    expect(note).toHaveTextContent('El precio cambió de MX$840.00 a MX$860.00; revisa y vuelve a emitir');
    expect(screen.getByTestId('price-changed-banner')).toBeInTheDocument();
    // Sin éxito: ni banner de «Oferta emitida» ni diálogo abierto; y la mesa se volvió a pedir.
    expect(screen.queryByText(/Oferta emitida/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1));
  });

  it('IMP-2: al editar el precio, el chip compara la oferta EDITADA con el estándar y dice «Precio editado por ti»', async () => {
    render(table({ lines }));
    const list = (await screen.findAllByTestId('desk-line'))[0].parentElement!;
    list.focus();
    fireEvent.keyDown(list, { key: 'e' });
    const input = await screen.findByLabelText('Precio ofertado para Std');
    fireEvent.change(input, { target: { value: '650' } });
    const row = screen.getAllByTestId('desk-line')[0];
    const chip = within(row).getByTestId('line-chip');
    expect(chip).toHaveAttribute('data-chip', 'down');
    expect(chip).toHaveTextContent('Bajada −MX$50.00');
    expect(within(row).getByTestId('line-reason-edited')).toHaveTextContent('Precio editado por ti');
    fireEvent.change(input, { target: { value: '800' } });
    expect(within(row).getByTestId('line-chip')).toHaveTextContent('Subida +MX$100.00');
  });

  it('IMP-2: 409 en una línea editada habla del derivado y conserva el precio editado', async () => {
    vi.spyOn(api, 'getBuylistDecisionTable').mockResolvedValue(table());
    vi.spyOn(api, 'emitBuylistOffer').mockRejectedValue(
      new ApiClientError(409, {
        code: 'OFFER_PRICE_CHANGED',
        message: 'changed',
        details: { lines: [{ lineId: 'i-1', expectedCents: 84000, currentCents: 86000 }] },
      }),
    );
    renderWithProviders(<BuylistDecisionDesk sellRequestId="sr-1" onClose={() => {}} />, 'es');
    fireEvent.click(await screen.findByTestId('line-edit'));
    fireEvent.change(await screen.findByLabelText(/Precio ofertado para/), { target: { value: '900' } });
    fireEvent.change(await screen.findByLabelText('Motivo del ajuste'), { target: { value: 'el mercado se movió' } });
    fireEvent.click(screen.getByRole('button', { name: 'Emitir oferta' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir la oferta y mandar el correo' }));
    const note = await screen.findByTestId('line-price-changed');
    expect(note).toHaveTextContent(
      'El precio de referencia cambió de MX$840.00 a MX$860.00; tu precio editado se conserva: MX$900.00',
    );
  });

  it('sinceQuote BOUNTY y MANUAL_OVERRIDE tienen texto propio (es/en)', async () => {
    const mk = (code: 'BOUNTY' | 'MANUAL_OVERRIDE') => [
      line({
        itemId: 'q',
        derivedPriceCents: 75000,
        ...mesa,
        adjustment: null,
        sinceQuote: { quotedCents: 70000, deltaCents: 5000, reasonCode: code, reasonText: 'x' },
      }),
    ];
    const a = render(table({ lines: mk('BOUNTY') }));
    expect(await screen.findByTestId('line-since-quote')).toHaveTextContent('hay un bounty activo');
    a.unmount();
    const b = render(table({ lines: mk('MANUAL_OVERRIDE') }), 'en');
    expect(await screen.findByTestId('line-since-quote')).toHaveTextContent('the team set the price');
    b.unmount();
  });

  it('«Solo las que cambian» incluye líneas Estándar con sinceQuote.deltaCents ≠ 0', async () => {
    const ls = [
      line({ itemId: 'x', derivedPriceCents: 70000, ...mesa, adjustment: null, sinceQuote: null }),
      line({
        itemId: 'y',
        derivedPriceCents: 70000,
        ...mesa,
        adjustment: null,
        sinceQuote: { quotedCents: 65000, deltaCents: 5000, reasonCode: 'CURVE_CHANGED', reasonText: 'x' },
      }),
    ];
    render(table({ lines: ls }));
    await screen.findAllByTestId('desk-line');
    fireEvent.click(screen.getByRole('button', { name: /Solo las que cambian \(1\)/ }));
    expect(screen.getAllByTestId('desk-line')).toHaveLength(1);
  });

  it('el resumen no nombra una columna «Cambio» y la lista tiene role correcto para aria-activedescendant', async () => {
    render(table({ lines }));
    await screen.findAllByTestId('desk-line');
    expect(screen.getByTestId('desk-summary-hint')).not.toHaveTextContent('«Cambio»');
    const list = screen.getAllByTestId('desk-line')[0].parentElement!;
    expect(list).toHaveAttribute('role', 'group');
    expect(list).toHaveAttribute('aria-activedescendant');
  });
});
