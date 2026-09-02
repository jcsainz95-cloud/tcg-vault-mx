import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { BuylistCycleQueues } from './BuylistCycleQueues';
import * as api from '@/lib/api';
import type {
  LiveSellerRowDTO,
  PendingGuideCancellationRowDTO,
  PendingOfferAuthorizationRowDTO,
  PendingShipmentConfirmationRowDTO,
} from '@/types/contract';

const SELLER = { id: 'u-777', name: 'Ash Ketchum', email: 'ash@example.com' };

function page<T>(data: T[]) {
  return { data, page: 1, pageSize: 20, total: data.length };
}

/**
 * Instante que cae, **sin ambigüedad**, en el día `offsetDays` respecto de HOY en
 * `America/Mexico_City`. Sustituye al viejo `Date.now() + 20 h`, que dejó de ser determinista al
 * pasar `caducityTone` de una ventana rodante de horas al **día del calendario**: veinte horas caen
 * hoy o mañana según la hora a la que corra la suite.
 */
function caducityOnMxDay(offsetDays: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(
    new Date(Date.now()),
  );
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  // Mediodía de CDMX (UTC−6 todo el año desde 2022): lejos de cualquier borde de medianoche.
  return new Date(`${day.toISOString().slice(0, 10)}T12:00:00-06:00`).toISOString();
}

function authRow(over: Partial<PendingOfferAuthorizationRowDTO> = {}) {
  return {
    sellRequestId: 'sr-auth-1',
    seller: SELLER,
    preparedBy: 'operador@tcghunt.mx',
    offerPreparedAt: '2026-08-29T15:00:00.000Z',
    offerGrossCents: 200000,
    operatorCapCents: 150000,
    excessCents: 50000,
    lineCount: 4,
    buyLineCount: 3,
    caducityAt: caducityOnMxDay(0),
    ...over,
  };
}

function shipRow(over: Partial<PendingShipmentConfirmationRowDTO> = {}) {
  return {
    sellRequestId: 'sr-conf-1',
    seller: SELLER,
    sellerShippedDeclaredAt: '2026-08-26T18:00:00.000Z',
    shipDeadlineAt: '2026-09-02T18:00:00.000Z',
    carrier: 'Estafeta',
    trackingNumber: '7712345678',
    businessDaysWaiting: 6,
    alert: true,
    ...over,
  };
}

function guideRow(over: Partial<PendingGuideCancellationRowDTO> = {}) {
  return {
    sellRequestId: 'sr-guide-1',
    seller: SELLER,
    carrier: 'Estafeta',
    trackingNumber: '7798765432',
    guideSentAt: '2026-08-20T18:00:00.000Z',
    guideCancellationPendingAt: '2026-08-28T18:00:00.000Z',
    closedStatus: 'expirada' as const,
    expiredReason: 'not_shipped' as const,
    ...over,
  };
}

function sellerRow(over: Partial<LiveSellerRowDTO> = {}): LiveSellerRowDTO {
  return {
    seller: { ...SELLER, phone: '5555123456' },
    liveCount: 3,
    oldestCreatedAt: '2026-08-25T14:00:00.000Z',
    latestStatus: 'cotizada',
    ...over,
  };
}

function stub({
  auth = [authRow()],
  ship = [shipRow()],
  guides = [guideRow()],
  sellers = [sellerRow()],
}: {
  auth?: PendingOfferAuthorizationRowDTO[];
  ship?: PendingShipmentConfirmationRowDTO[];
  guides?: PendingGuideCancellationRowDTO[];
  sellers?: LiveSellerRowDTO[];
} = {}) {
  vi.spyOn(api, 'getPendingOfferAuthorizations').mockResolvedValue(page(auth));
  vi.spyOn(api, 'getPendingShipmentConfirmations').mockResolvedValue(page(ship));
  vi.spyOn(api, 'getPendingGuideCancellations').mockResolvedValue(page(guides));
  vi.spyOn(api, 'getLiveSellers').mockResolvedValue(page(sellers));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('Colas del ciclo — ofertas por autorizar', () => {
  it('avisa de que la fila SE MUERE SOLA y destaca la caducidad a ≤1 día', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    expect(await screen.findByText('operador@tcghunt.mx')).toBeInTheDocument();
    expect(
      screen.getByText(/Si nadie autoriza antes de esa fecha, la solicitud caduca sola/),
    ).toBeInTheDocument();
    expect(screen.getByText('Caduca hoy')).toBeInTheDocument();
  });

  /**
   * **El énfasis es del CALENDARIO de CDMX, no de una ventana rodante de horas** — y no promete la
   * regla de días hábiles del servidor, que el front no tiene (ver `caducityTone`).
   *
   * El caso que fija el reloj a las 23:00 de CDMX es exactamente la regresión que había: una fila
   * que muere **mañana** a mediodía está a ~13 h de distancia, así que la ventana vieja (`≤24 h`)
   * la rotulaba **«Caduca hoy»** — el copy visible decía un día que no era.
   */
  it('«hoy» y «mañana» son días de CALENDARIO en CDMX, no una ventana de 24/48 h', async () => {
    // 2026-09-01 23:00 en CDMX (UTC−6). Se congela `Date.now`, que es lo único que lee el tono.
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-02T05:00:00.000Z').getTime());

    // Muere MAÑANA a mediodía de CDMX ⇒ 2026-09-02T18:00Z: a solo ~13 h del reloj congelado.
    const tomorrowNoon = caducityOnMxDay(1);
    expect(tomorrowNoon).toBe('2026-09-02T18:00:00.000Z');

    stub({ auth: [authRow({ caducityAt: tomorrowNoon })] });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    expect(await screen.findByText('operador@tcghunt.mx')).toBeInTheDocument();

    // ⛔ La ventana vieja (`≤24 h`) decía «Caduca hoy» aquí. El día del calendario dice «mañana».
    expect(screen.getByText('Caduca mañana')).toBeInTheDocument();
    expect(screen.queryByText('Caduca hoy')).not.toBeInTheDocument();
  });

  it('a más de dos días no se destaca nada: el énfasis se gasta si se pinta siempre', async () => {
    stub({ auth: [authRow({ caducityAt: caducityOnMxDay(3) })] });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    expect(await screen.findByText('operador@tcghunt.mx')).toBeInTheDocument();
    expect(screen.queryByText('Caduca hoy')).not.toBeInTheDocument();
    expect(screen.queryByText('Caduca mañana')).not.toBeInTheDocument();
  });

  it('mañana se rotula «Caduca mañana», y sigue siendo un día de calendario', async () => {
    stub({ auth: [authRow({ caducityAt: caducityOnMxDay(1) })] });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    expect(await screen.findByText('operador@tcghunt.mx')).toBeInTheDocument();
    expect(screen.getByText('Caduca mañana')).toBeInTheDocument();
    expect(screen.queryByText('Caduca hoy')).not.toBeInTheDocument();
  });

  it('autorizar es autorizar LO GUARDADO: el diálogo lo dice y no ofrece editar', async () => {
    stub();
    const spy = vi.spyOn(api, 'authorizeBuylistOffer').mockResolvedValue({
      sellRequestId: 'sr-auth-1',
      status: 'ofertada',
      offerState: 'sent',
      offerSentAt: '2026-09-01T12:00:00.000Z',
      offerGrossCents: 200000,
      offerShippingFeeCents: 18000,
      offerNetCents: 182000,
      offerAcceptDeadlineAt: '2026-09-03T18:00:00.000Z',
      requiresAuthorization: false,
      items: [],
    });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: 'Autorizar y mandar' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Sale tal como se preparó: MX$2,000.00 de bruto, 3 líneas.');
    expect(dialog).toHaveTextContent('No se puede editar aquí');
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Autorizar y mandar el correo' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('sr-auth-1'));
    expect(await screen.findByText(/el correo salió y el plazo del vendedor arranca ahora/)).toBeInTheDocument();
  });

  it('un operador NO ve el botón, y se le dice de quién es la acción', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin={false} />, 'es');
    expect(
      await screen.findByText('Solo el súper-admin puede autorizar una oferta por encima del tope.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Autorizar y mandar' })).not.toBeInTheDocument();
  });
});

describe('Colas del ciclo — por confirmar envío', () => {
  it('pinta los días esperando y la ALERTA que manda el servidor', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Por confirmar envío');
    expect(await screen.findByText('6 días hábiles')).toBeInTheDocument();
    expect(screen.getByTestId('shipment-alert')).toHaveTextContent('Alerta');
  });

  /**
   * ⚠️ El caso que el front NO puede recalcular. `businessDaysWaiting: null` **no es cero**: es
   * «no se pudo calcular», y `alert` **falla hacia `true`** porque «llevo demasiado» y «no sé
   * cuánto llevo» piden la MISMA acción humana. La fila se degrada y **la cola se pinta**.
   */
  it('días NO calculables: lo dice con palabras, no con un 0, y la alerta SIGUE encendida', async () => {
    stub({
      ship: [
        shipRow({
          businessDaysWaiting: null,
          businessDaysUnavailable: true,
          alert: true,
          shipDeadlineAt: null,
          carrier: null,
          trackingNumber: null,
        }),
      ],
    });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Por confirmar envío');
    expect(await screen.findByText('No se pudo calcular')).toBeInTheDocument();
    // Ni un cero que se vea confiable, ni una alerta apagada por falta de dato.
    expect(screen.queryByText('0 días hábiles')).not.toBeInTheDocument();
    expect(screen.getByTestId('shipment-alert')).toBeInTheDocument();
    expect(screen.getByText('Sin guía')).toBeInTheDocument();
  });

  it('la alerta NO promete que algo vaya a expirar ni a moverse', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Por confirmar envío');
    expect(
      await screen.findByText(/Nada expira y no se mueve ningún estado|No expira nada ni mueve el estado/),
    ).toBeInTheDocument();
  });
});

describe('Colas del ciclo — guías por cancelar', () => {
  /** D22: la cola **no se vacía sola**. Las dos mitades van juntas o la cola crece para siempre. */
  it('la fila sale de la cola SOLO al marcarla como cancelada', async () => {
    stub();
    const spy = vi.spyOn(api, 'markBuylistGuideCancellationDone').mockResolvedValue({
      sellRequestId: 'sr-guide-1',
      guideCancellationDoneAt: '2026-09-01T12:00:00.000Z',
    });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Guías por cancelar');

    expect(await screen.findByText('7798765432')).toBeInTheDocument();
    expect(screen.getByText(/Esta cola no se vacía sola/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guía cancelada' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Confirma que cancelaste la guía 7798765432 con Estafeta.');
    // El costo real entra al reporte, y el copy dice que no toca a nadie el bolsillo.
    fireEvent.change(within(dialog).getByLabelText('Costo real de la etiqueta (opcional)'), {
      target: { value: '0' },
    });
    expect(dialog).toHaveTextContent('no toca lo que se le deposita a nadie');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar como cancelada' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('sr-guide-1', { guideActualCostCents: 0 }),
    );
    expect(await screen.findByText('Guía marcada como cancelada.')).toBeInTheDocument();
  });

  it('el vacío es POSITIVO: aquí «no hay nada» es una buena noticia', async () => {
    stub({ guides: [] });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Guías por cancelar');
    expect(await screen.findByText('Ninguna guía pendiente de cancelar.')).toBeInTheDocument();
  });

  it('pinta POR QUÉ se cerró usando el motivo, no solo el estado (§23.1d)', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Guías por cancelar');
    // `expirada` + `not_shipped` ⇒ versalita propia, no el rótulo genérico.
    expect(await screen.findByText('Sin envío')).toBeInTheDocument();
    expect(screen.queryByText('Expirada')).not.toBeInTheDocument();
  });
});

describe('Colas del ciclo — vendedores con solicitudes vivas (D12)', () => {
  it('el TELÉFONO viaja en la fila, para poder llamar sin ir a buscar al usuario', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Vendedores con solicitudes vivas');
    expect(await screen.findByText('5555123456')).toBeInTheDocument();
    expect(
      screen.getByText(/Es la lista de gente a la que le debemos una respuesta/),
    ).toBeInTheDocument();
  });

  it('sin teléfono se DICE, no se inventa ni se deja en blanco', async () => {
    stub({ sellers: [sellerRow({ seller: { ...SELLER, phone: null } })] });
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'es');
    openTab('Vendedores con solicitudes vivas');
    expect(await screen.findByText('Sin teléfono')).toBeInTheDocument();
  });

  it('EN: las cuatro colas existen en inglés (paridad)', async () => {
    stub();
    renderWithProviders(<BuylistCycleQueues isSuperAdmin />, 'en');
    for (const tab of [
      'Offers to approve',
      'Shipments to confirm',
      'Labels to cancel',
      'Sellers with live requests',
    ]) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
    expect(await screen.findByText('Prepared by')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/admin\.m5\.queues/);
  });
});
