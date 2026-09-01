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

  it('el override exige motivo, y mandar el derivado EXACTO no lo exige', async () => {
    render(table());
    const amount = await screen.findByLabelText('Precio ofertado para Charizard VMAX');

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
        { itemId: 'a', decision: 'buy' },
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
    expect(await screen.findByText('La oferta ya salió: la mesa es de solo lectura.')).toBeInTheDocument();
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
