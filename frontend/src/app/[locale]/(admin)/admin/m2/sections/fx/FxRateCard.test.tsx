import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import * as api from '@/lib/api';
import type { FxDTO, FxRefreshDTO, FxRefreshOutcome, FxRefreshReason } from '@/types/contract';
import es from '../../../../../../../../messages/es.json';
import { FxRateCard } from './FxRateCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * LOS CANDADOS DE `DESIGN_SYSTEM §30.17`, HECHOS EJECUTABLES
 *
 * *«Un candado que no se puede poner rojo no vale, y **un candado que mide el nombre de un campo
 * no vale nada**.»* Éstos miden **qué puede hacer la pantalla** y **qué sale por la red**:
 *
 *  - **FX-UI-1** cuenta **peticiones**: `toBeDisabled()` pasa en verde con un `aria-disabled`
 *    sobre un botón que **sigue disparando su `onClick`** — es exactamente el matcher que deja
 *    pasar «mover el tipo de cambio a ciegas». Aquí se cuenta `setFxMode`, que es el punto por el
 *    que la petición sale de este componente.
 *  - **FX-UI-2** mide **qué palancas ofrece** la tarjeta, no cómo se llama un rótulo.
 *  - **FX-UI-7** mide una **invarianza** (el colchón no puede tocar el salto).
 *
 * ⚠️ Y uno que no estaba en §30.17 porque el contrato es de ayer: **el de v1.63.3** —
 * `mode: "manual"` con `manual.applied: false` **es alcanzable**, y la tarjeta tiene que obedecer
 * `applied`, ⛔ no derivarlo del `mode`.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** `FxStateDTO` completo (§M2-F.3): las dos tasas viajan SIEMPRE, rija la que rija. */
function fxState(over: Partial<FxDTO> = {}): FxDTO {
  return {
    rate: 19,
    bufferPct: 3,
    source: 'manual',
    effectiveDate: '2026-09-09',
    // ⭐ v1.63.4 (regla 6 de §M2-F.3): el respaldo viaja SIEMPRE y al NIVEL SUPERIOR. Está en el
    // fixture BASE —y no sólo en el del acuse— a propósito: si sólo apareciera «donde hace falta»,
    // el fixture reproduciría el campo condicional que la regla 6 prohíbe.
    fallbackRate: 18,
    mode: 'manual',
    modeResolvedFrom: 'setting',
    manual: { rate: 19, applied: true },
    automatic: { rate: 18.2431, effectiveDate: '2026-09-05', ageDays: 3, status: 'fresh', applied: false },
    ...over,
  };
}

/** Modo `auto` con Banxico rigiendo — el otro lado del interruptor. */
function autoState(over: Partial<FxDTO> = {}): FxDTO {
  return fxState({
    rate: 18.2431,
    source: 'banxico',
    effectiveDate: '2026-09-05',
    mode: 'auto',
    manual: { rate: 19, applied: false },
    automatic: { rate: 18.2431, effectiveDate: '2026-09-05', ageDays: 3, status: 'fresh', applied: true },
    ...over,
  });
}

/** El fixture de FX-UI-2: ni tasa manual ni fila de Banxico ⇒ rige el 18 que nadie tecleó. */
function fallbackState(): FxDTO {
  return fxState({
    rate: 18,
    source: 'fallback',
    mode: 'auto',
    manual: { rate: null, applied: false },
    automatic: { rate: null, effectiveDate: null, ageDays: null, status: 'missing', applied: false },
  });
}

/** Modo `manual` con `19.0` y **ninguna** fila de Banxico — el estado real de producción. */
function manualWithoutBanxico(over: Partial<FxDTO> = {}): FxDTO {
  return fxState({
    automatic: { rate: null, effectiveDate: null, ageDays: null, status: 'missing', applied: false },
    ...over,
  });
}

function refreshResult(
  outcome: FxRefreshOutcome,
  extra: { reason?: FxRefreshReason | null; fetchedRate?: number | null; state?: Partial<FxDTO> } = {},
): FxRefreshDTO {
  return {
    ...fxState(extra.state),
    refresh: {
      outcome,
      reason: extra.reason ?? null,
      fetchedRate: extra.fetchedRate ?? null,
      at: '2026-09-09T17:04:11Z',
    },
  };
}

const T = es.admin.m2.fx;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getFx').mockResolvedValue(fxState());
});

/** Los dos segmentos del interruptor. */
const segment = (name: 'MANUAL' | 'AUTOMÁTICA') => screen.getByRole('radio', { name });

/** Espera a que la tarjeta haya resuelto el `GET` (la cifra grande deja de ser `—`). */
async function ready() {
  await waitFor(() => expect(screen.getByTestId('fx-current').textContent).not.toBe('—'));
}

describe('FX-UI-1 ⭐⭐ · la pantalla NO ofrece el interruptor sin las dos tasas', () => {
  it('(a) el `GET` no resuelve NUNCA ⇒ 0 peticiones y ningún diálogo, aunque se pulse', async () => {
    vi.spyOn(api, 'getFx').mockReturnValue(new Promise<FxDTO>(() => {}));
    const put = vi.spyOn(api, 'setFxMode');
    renderWithProviders(<FxRateCard />, 'es');

    await userEvent.click(segment('AUTOMÁTICA'));

    // ⭐ La aserción que mata la mutación: se cuenta lo que SALE, no un atributo.
    expect(put).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(T.toggle.loadingReason)).toBeInTheDocument();
    // Y ⛔ no se pinta ninguna cifra mientras tanto (§30.11).
    expect(screen.getByTestId('fx-current')).toHaveTextContent('—');
  });

  it('(b) el `GET` falla ⇒ 0 peticiones, banner con `Reintentar`, y ⛔ ninguna cifra', async () => {
    vi.spyOn(api, 'getFx').mockRejectedValue(new ApiClientError(500, { code: 'INTERNAL', message: 'boom' }));
    const put = vi.spyOn(api, 'setFxMode');
    renderWithProviders(<FxRateCard />, 'es');

    await screen.findByRole('alert');
    await userEvent.click(segment('AUTOMÁTICA'));

    expect(put).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    // ⛔ Ni una cifra de tasa: media tarjeta de tipo de cambio parece autoritativa y no lo es.
    expect(screen.queryByTestId('fx-manual')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/19\.0000|18\.2431/);
  });

  it('(c) el DTO llega SIN el bloque `automatic` ⇒ 0 peticiones y el motivo bloqueante EN ACENTO', async () => {
    const maimed = { ...fxState() } as Partial<FxDTO>;
    delete maimed.automatic;
    vi.spyOn(api, 'getFx').mockResolvedValue(maimed as FxDTO);
    const put = vi.spyOn(api, 'setFxMode');
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));

    expect(put).toHaveBeenCalledTimes(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const reason = screen.getByText(T.toggle.blockedReason);
    expect(reason).toBeInTheDocument();
    expect(reason).toHaveClass('text-accent');
    // La cifra grande SÍ se pinta: `rate` y `source` son verdad (§30.11).
    expect(screen.getByTestId('fx-current')).toHaveTextContent('19.0000');
  });

  it('⭐ CONTROL POSITIVO: con las dos tasas, el mismo clic abre el diálogo — y sigue habiendo 0 `PUT`', async () => {
    const put = vi.spyOn(api, 'setFxMode');
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));

    expect(await screen.findByRole('dialog')).toHaveTextContent(T.confirm.title);
    expect(put).toHaveBeenCalledTimes(0);
  });
});

describe('FX-UI-2 ⭐⭐ · un `fallback` NO se pinta como `manual`', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fallbackState());
  });

  it('(a) la fuente resuelve `source.fallback`, en acento, y ⛔ NUNCA `source.manual`', async () => {
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    const badge = screen.getByTestId('fx-source');
    expect(badge).toHaveTextContent(T.source.fallback);
    // La mentira de v1.62.2: el 18 de código presentado como el número del dueño.
    expect(badge).not.toHaveTextContent(T.source.manual);
    expect(badge).toHaveClass('text-accent');
    // Y la avería de next-intl sin `onError`: la ruta de la clave pintada como si fuera copy.
    expect(document.body.textContent).not.toMatch(/admin\.m2\.fx|source\.fallback/);
    expect(screen.getByText(T.source.fallbackBody)).toBeInTheDocument();
  });

  it('(b) ⭐ LA CONDUCTA: la tarjeta se comporta como lo que es — sin ninguna tasa real', async () => {
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    expect(screen.getByRole('button', { name: T.manual.create })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.refresh.cta })).toBeInTheDocument();
    // ⛔ Y no ofrece «cambiar» una tasa que no existe.
    expect(screen.queryByRole('button', { name: T.manual.edit })).not.toBeInTheDocument();
  });

  it('(c) ⭐⭐ NINGUNA de las dos columnas lleva `RIGE`, y el 18 ⛔ no se pinta como el de Banxico', async () => {
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    expect(screen.queryAllByText(T.ruling.mark)).toHaveLength(0);
    const automatic = within(screen.getByTestId('fx-automatic'));
    expect(automatic.getAllByText(T.auto.missing).length).toBeGreaterThan(0);
    expect(screen.getByTestId('fx-automatic').textContent).not.toMatch(/18/);
    expect(within(screen.getByTestId('fx-manual')).getByText(T.manual.none)).toBeInTheDocument();
  });
});

describe('FX-UI-3 ⭐ · el refresco no afirma un éxito que no ocurrió', () => {
  async function clickRefresh() {
    await userEvent.click(await screen.findByRole('button', { name: T.refresh.cta }));
  }

  it('`failed` + `no_token` ⇒ banner rojo PERSISTENTE, y ⛔ ningún copy de éxito', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('failed', { reason: 'no_token' }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    await clickRefresh();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(T.refresh.failedTitle);
    expect(alert).toHaveTextContent(T.refresh.reason.no_token);
    expect(alert).toHaveTextContent('Sigue rigiendo 19.0000 (MANUAL).');
    expect(document.body.textContent).not.toMatch(/Es distinta de la que teníamos|la misma que ya teníamos/);

    // ⛔ No es un toast: sobrevive a OTRA interacción de la tarjeta (aquí, abrir el editor).
    await userEvent.click(screen.getByRole('button', { name: T.manual.edit }));
    expect(screen.getByRole('alert')).toHaveTextContent(T.refresh.failedTitle);
  });

  it('los cuatro motivos se traducen y uno desconocido ⛔ no cae al copy de éxito', async () => {
    const cases: [FxRefreshReason, string][] = [
      ['http_error', T.refresh.reason.http_error],
      ['invalid_payload', T.refresh.reason.invalid_payload],
      ['network_error', T.refresh.reason.network_error],
    ];
    for (const [reason, copy] of cases) {
      vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('failed', { reason }));
      const view = renderWithProviders(<FxRateCard />, 'es');
      await ready();
      await clickRefresh();
      expect(await screen.findByRole('alert')).toHaveTextContent(copy);
      view.unmount();
    }

    vi.spyOn(api, 'refreshFx').mockResolvedValue(
      refreshResult('failed', { reason: 'quota_exceeded' as unknown as FxRefreshReason }),
    );
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    await clickRefresh();
    expect(await screen.findByRole('alert')).toHaveTextContent(T.refresh.reason.unknown);
  });

  it('EL TERCER CASO, el que se olvida: `unchanged` NO es un fallo', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('unchanged', { fetchedRate: 18.2431 }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    await clickRefresh();

    expect(await screen.findByText(/la misma que ya teníamos/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Es distinta de la que teníamos/);
  });

  it('⛔ un `200` sin cifra que afirmar tampoco se anuncia como éxito (la deuda de `fetchedRate`)', async () => {
    // `outcome: "updated"` pero SIN `fetchedRate`: la pantalla no puede decir qué devolvió Banxico
    // y ⛔ NO sustituye ese hueco por la tasa que rige (que en manual es de otra magnitud).
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('updated', { fetchedRate: null }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    await clickRefresh();

    expect(await screen.findByRole('alert')).toHaveTextContent(T.refresh.failedTitle);
    expect(document.body.textContent).not.toMatch(/Banxico devolvió 19\.0000/);
  });

  it('CONTROL NEGATIVO: un `updated` de verdad se dice, con la cifra que devolvió Banxico', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('updated', { fetchedRate: 18.6312 }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    await clickRefresh();

    expect(await screen.findByText(/Banxico devolvió 18\.6312/)).toBeInTheDocument();
    // En modo manual, el refresco NO cambia cuál rige: sólo la cifra de comparación (§30.7).
    expect(screen.getByText(/Sigue rigiendo tu tasa manual \(19\.0000\)/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('FX-UI-4 ⭐ · el acuse: donde toca, y sólo donde toca', () => {
  /**
   * ⭐⭐ **v1.63.4 — este candado cambió de forma, y el cambio ES la deuda `FX-F1` cerrada.**
   *
   * Hasta v1.63.3 el número que el acuse tiene que **nombrar antes de tocar nada** sólo existía
   * dentro del `422`, así que la tarjeta mandaba un `PUT` sin acuse **sólo para leerlo** y
   * `FX-UI-4(a)` medía *«0 peticiones que cambien algo + 1 consulta de precondición»*. Con
   * `fallbackRate` publicado en el DTO (regla 6 de §M2-F.3), el literal de §30.17 se cumple:
   * **CERO peticiones hasta que el humano confirma**.
   */
  it('(a) ⭐ sin ninguna tasa de Banxico ⇒ acuse con CERO peticiones, y el `PUT` final LLEVA la bandera', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(manualWithoutBanxico());
    const put = vi.spyOn(api, 'setFxMode').mockResolvedValue(fallbackState());
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(T.ack.title);
    // Los cinco párrafos, con el número que NOMBRÓ el servidor (⛔ nunca un 18 horneado).
    expect(dialog).toHaveTextContent('Ahora mismo rige tu tasa manual: 19.0000 pesos por dólar.');
    expect(dialog).toHaveTextContent('Si pasas a automática, regirían 18.0000 pesos por dólar.');
    expect(dialog).toHaveTextContent(T.ack.whereFrom);
    expect(dialog).toHaveTextContent('cambia −5.26 %');
    expect(dialog).toHaveTextContent(T.confirm.untouched);
    // ⛔ Ni la palabra «error», ni el código, ni el 422.
    expect(dialog.textContent).not.toMatch(/FX_NO_AUTOMATIC_RATE|422|[Ee]rror/);
    // ⭐⭐ **El literal de FX-UI-4(a), por fin al pie de la letra**: ni una sola petición hasta que
    // el humano confirma. Rojo el día que alguien reintroduzca la vía de sondeo.
    expect(put).toHaveBeenCalledTimes(0);
    expect(segment('MANUAL')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: /Sí, pasar a 18\.0000/ }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // Se inspecciona **el cuerpo** (react-query añade su propio 2.º argumento; se mira el 1.º).
    expect(put.mock.calls[0][0]).toEqual({ mode: 'auto', acknowledgeNoAutomaticRate: true });
  });

  /**
   * ⭐ **El acuse nombra `dto.fallbackRate`, ⛔ no un `18` horneado** (§30.16.8). Es el candado que
   * hace inútil la tentación barata de cerrar `FX-F1` escribiendo la constante en el cliente: con
   * un servidor que diga otro número, el diálogo tiene que decir **ese**, y el salto tiene que
   * recalcularse contra **ese**.
   */
  it('(a-bis) ⭐ el número del diálogo sale del DTO: con `fallbackRate: 17.5` el acuse dice 17.5000', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(manualWithoutBanxico({ fallbackRate: 17.5 }));
    const put = vi.spyOn(api, 'setFxMode').mockResolvedValue(fallbackState());
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Si pasas a automática, regirían 17.5000 pesos por dólar.');
    // Y el salto es contra ESE número: (17.5 − 19) / 19 = −7.89 %, no el −5.26 % del 18.
    expect(dialog).toHaveTextContent('cambia −7.89 %');
    expect(dialog.textContent).not.toMatch(/18\.0000/);
    expect(put).toHaveBeenCalledTimes(0);
    // El CTA también, que es el botón que el humano pulsa para mover el dinero.
    await userEvent.click(screen.getByRole('button', { name: /Sí, pasar a 17\.5000/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  });

  /**
   * ⚠️ **La DEGRADACIÓN, y por qué se prueba en vez de darla por imposible.** `fallbackRate` es
   * obligatorio en las cuatro rutas, pero *«el contrato dice que siempre viaja»* es exactamente la
   * clase de precondición que se desactiva sola cuando falta el dato. Si el servidor no lo emite
   * —hoy: uno anterior a `FX-25`—, la tarjeta ⛔ **no se queda muda**: pide el número por la puerta
   * que la regla 6 (ii) garantiza que sigue abierta, el `422` **con su `details` completo**.
   */
  it('(a-ter) ⚠️ DTO sin `fallbackRate` (servidor no conforme) ⇒ el acuse se compone del `422`, sin acuse en el 1.er `PUT`', async () => {
    const incomplete = manualWithoutBanxico() as Partial<FxDTO>;
    delete incomplete.fallbackRate;
    vi.spyOn(api, 'getFx').mockResolvedValue(incomplete as FxDTO);
    const put = vi
      .spyOn(api, 'setFxMode')
      .mockRejectedValueOnce(
        new ApiClientError(422, {
          code: 'FX_NO_AUTOMATIC_RATE',
          message: 'no automatic rate',
          details: { currentRate: 19, fallbackRate: 18 },
        }),
      )
      .mockResolvedValueOnce(fallbackState());
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(T.ack.title);
    expect(dialog).toHaveTextContent('Si pasas a automática, regirían 18.0000 pesos por dólar.');
    expect(dialog.textContent).not.toMatch(/FX_NO_AUTOMATIC_RATE|422|[Ee]rror/);
    // La consulta de precondición ⛔ NO lleva el acuse, y por contrato no cambia el modo (`FX-12`).
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toEqual({ mode: 'auto' });
    expect(segment('MANUAL')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('button', { name: /Sí, pasar a 18\.0000/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1][0]).toEqual({ mode: 'auto', acknowledgeNoAutomaticRate: true });
  });

  it('(b) con `stale` se abre el diálogo NORMAL, y el `PUT` ⛔ NO lleva la bandera', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(
      fxState({
        automatic: { rate: 18.2431, effectiveDate: '2026-07-31', ageDays: 40, status: 'stale', applied: false },
      }),
    );
    const put = vi.spyOn(api, 'setFxMode').mockResolvedValue(autoState());
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(T.confirm.title);
    expect(dialog).not.toHaveTextContent(T.ack.title);
    // Hay número real que juzgar: se DICE que está vieja, y el CTA es el normal.
    expect(dialog).toHaveTextContent('lleva 40 días sin actualizarse');
    expect(put).toHaveBeenCalledTimes(0);

    await userEvent.click(screen.getByRole('button', { name: /Sí, pasar a 18\.2431/ }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // ⛔ La bandera NO viaja cuando no hace falta: con `stale` hay número real que juzgar.
    expect(put.mock.calls[0][0]).toEqual({ mode: 'auto' });
  });
});

describe('FX-UI-5 ⭐ · el modo NO se pinta optimista', () => {
  it('con el diálogo abierto la selección no se ha movido, y cancelar no manda nada', async () => {
    const put = vi.spyOn(api, 'setFxMode');
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));
    await screen.findByRole('dialog');

    expect(segment('MANUAL')).toHaveAttribute('aria-checked', 'true');
    expect(segment('AUTOMÁTICA')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('fx-current')).toHaveTextContent('19.0000');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(segment('MANUAL')).toHaveAttribute('aria-checked', 'true');
    expect(put).toHaveBeenCalledTimes(0);
  });
});

describe('FX-UI-6 ⭐ · la frescura la deriva el SERVIDOR', () => {
  it('fixture contradictorio (`ageDays: 40`, `status: "fresh"`) ⇒ se pinta AL DÍA', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(
      fxState({
        automatic: { rate: 18.2431, effectiveDate: '2026-07-31', ageDays: 40, status: 'fresh', applied: false },
      }),
    );
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    const automatic = within(screen.getByTestId('fx-automatic'));
    expect(automatic.getByText(T.auto.fresh)).toBeInTheDocument();
    // Rojo si pinta VIEJA: eso significaría un `ageDays > 5` escrito en el navegador.
    expect(automatic.queryByText(T.auto.stale)).not.toBeInTheDocument();
  });

  it('POR LO NEGATIVO: el umbral (`5`) ⛔ no está escrito en ninguna cadena de la tarjeta', () => {
    // Hoy son 5 días y es CONSTANTE DE CÓDIGO del servidor; el contrato ya contempla promoverlo a
    // dial. Una cadena que hornea una constante ajena caduca en silencio.
    expect(JSON.stringify(T)).not.toMatch(/\b5\b/);
  });
});

describe('FX-UI-7 ⭐⭐ · el colchón NO entra en el salto', () => {
  it('cambiar SÓLO el colchón deja la línea del salto EXACTAMENTE igual', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxState({ bufferPct: 3 }));
    const first = renderWithProviders(<FxRateCard />, 'es');
    await ready();
    const withThree = screen.getByTestId('fx-jump').textContent;
    expect(withThree).toContain('−0.7569');
    expect(withThree).toContain('−3.98');
    first.unmount();

    vi.spyOn(api, 'getFx').mockResolvedValue(fxState({ bufferPct: 10 }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    expect(screen.getByTestId('fx-jump').textContent).toBe(withThree);
  });

  it('POR AUSENCIA: ninguna «tasa efectiva» (tasa × colchón) se pinta en la tarjeta', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxState({ bufferPct: 3 }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    // 19 × 1.03 = 19.57 · 18.2431 × 1.03 = 18.79. Un tercer número emitido por la pantalla puede
    // discrepar del motor de precios: aquí no existe.
    expect(document.body.textContent).not.toMatch(/19\.57|18\.79/);
  });
});

describe('FX-UI-8 ⭐ · apagar el manual NO borra el número en pantalla', () => {
  it('tras el flip a AUTOMÁTICA, la columna MANUAL sigue leyendo 19.0000 y sin `RIGE`', async () => {
    vi.spyOn(api, 'setFxMode').mockResolvedValue(autoState());
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));
    await userEvent.click(await screen.findByRole('button', { name: /Sí, pasar a 18\.2431/ }));

    await waitFor(() => expect(segment('AUTOMÁTICA')).toHaveAttribute('aria-checked', 'true'));
    const manual = within(screen.getByTestId('fx-manual'));
    expect(manual.getByText('19.0000')).toBeInTheDocument();
    expect(manual.queryByText(T.ruling.mark)).not.toBeInTheDocument();
    expect(manual.queryByText(T.manual.none)).not.toBeInTheDocument();
    expect(manual.getByRole('button', { name: T.manual.edit })).toBeInTheDocument();
    // Y la que ahora manda lleva la marca (y sólo ella).
    expect(within(screen.getByTestId('fx-automatic')).getByText(T.ruling.mark)).toBeInTheDocument();
  });
});

describe('FX-UI-9 ⭐ · guardar una tasa en modo `auto` NO parece que no hizo nada', () => {
  it('se lee «guardada, todavía no rige», la cifra grande no se mueve y ⛔ nada de «actualizado»', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(autoState());
    vi.spyOn(api, 'updateFx').mockResolvedValue(
      autoState({ manual: { rate: 25, applied: false } }),
    );
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(screen.getByRole('button', { name: T.manual.edit }));
    const field = screen.getByLabelText(T.manual.field);
    await userEvent.clear(field);
    await userEvent.type(field, '25');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Guardada. Todavía no rige: seguimos en automática (18.2431 de Banxico). Regirá en cuanto pases a manual.'),
    ).toBeInTheDocument();
    const manual = within(screen.getByTestId('fx-manual'));
    expect(manual.getByText('25.0000')).toBeInTheDocument();
    expect(manual.queryByText(T.ruling.mark)).not.toBeInTheDocument();
    expect(screen.getByTestId('fx-current')).toHaveTextContent('18.2431');
    expect(document.body.textContent).not.toMatch(/actualizad/i);
  });

  it('⛔ y guardar en `auto` NO abre ningún diálogo: no rige, no hay nada que confirmar', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(autoState());
    const update = vi.spyOn(api, 'updateFx').mockResolvedValue(autoState({ manual: { rate: 25, applied: false } }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(screen.getByRole('button', { name: T.manual.edit }));
    await userEvent.clear(screen.getByLabelText(T.manual.field));
    await userEvent.type(screen.getByLabelText(T.manual.field), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ rate: 25 }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('CONTROL: si el número que se guarda RIGE, se confirma antes — mueve el catálogo igual', async () => {
    const update = vi.spyOn(api, 'updateFx').mockResolvedValue(fxState({ rate: 25, manual: { rate: 25, applied: true } }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(screen.getByRole('button', { name: T.manual.edit }));
    await userEvent.clear(screen.getByLabelText(T.manual.field));
    await userEvent.type(screen.getByLabelText(T.manual.field), '25');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(T.confirm.title);
    expect(update).toHaveBeenCalledTimes(0);

    await userEvent.click(screen.getByRole('button', { name: /Sí, pasar a 25\.0000/ }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ rate: 25 }));
    expect(await screen.findByText('Guardada, y ya rige: 25.0000 pesos por dólar.')).toBeInTheDocument();
  });
});

describe('FX-UI-10 · `modeResolvedFrom: "legacy"` se dice, y se dice en muted', () => {
  it('con `legacy` se lee MODO HEREDADO, sin `role="alert"` y sin acento', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxState({ modeResolvedFrom: 'legacy' }));
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    expect(screen.getByText(T.mode.legacyLabel)).toBeInTheDocument();
    const body = screen.getByText(T.mode.legacyBody, { exact: false });
    expect(body).toHaveClass('text-muted');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con `setting` ⛔ no aparece: no hay nada que trazar', async () => {
    renderWithProviders(<FxRateCard />, 'es');
    await ready();
    expect(screen.queryByText(T.mode.legacyLabel)).not.toBeInTheDocument();
  });
});

describe('FX-UI-11 · ninguna cifra mientras carga ni tras fallar la carga', () => {
  it('⛔ ni `0.0000`, ni `18`, ni la tasa de la última visita', async () => {
    vi.spyOn(api, 'getFx').mockReturnValue(new Promise<FxDTO>(() => {}));
    renderWithProviders(<FxRateCard />, 'es');

    expect(screen.getByTestId('fx-current')).toHaveTextContent('—');
    expect(document.body.textContent).not.toMatch(/0\.0000|18\.0000|19\.0000/);
  });
});

describe('FX-UI-12 · el copy no promete un `Deshacer`', () => {
  it('tras el cambio de modo se lee «ahora rige…», y ⛔ no existe ningún control «Deshacer»', async () => {
    vi.spyOn(api, 'setFxMode').mockResolvedValue(autoState());
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    await userEvent.click(segment('AUTOMÁTICA'));
    await userEvent.click(await screen.findByRole('button', { name: /Sí, pasar a 18\.2431/ }));

    const status = await screen.findByText(/Ahora rige 18\.2431 \(BANXICO\)/);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('Puedes volver a manual cuando quieras');
    expect(screen.queryByRole('button', { name: /Deshacer|Undo/ })).not.toBeInTheDocument();
  });
});

describe('FX-UI-13 · el idioma (visto en pantalla, no `grep`eado)', () => {
  it('EN: las cuatro fuentes, las tres frescuras y los cinco párrafos del acuse', async () => {
    // Fuente desconocida ⇒ neutro declarado, ⛔ nunca `MANUAL`.
    vi.spyOn(api, 'getFx').mockResolvedValue(fxState({ source: 'ecb' as unknown as FxDTO['source'] }));
    const unknown = renderWithProviders(<FxRateCard />, 'en');
    await ready();
    expect(screen.getByTestId('fx-source')).toHaveTextContent('UNRECOGNISED SOURCE');
    expect(screen.getByText(/We can't say where the rate in force comes from/)).toBeInTheDocument();
    unknown.unmount();

    vi.spyOn(api, 'getFx').mockResolvedValue(manualWithoutBanxico());
    // v1.63.4: el acuse se compone del DTO ⇒ abrirlo ⛔ no manda nada. El espía está para que un
    // `PUT` de más se vea, no para contestarlo.
    const put = vi.spyOn(api, 'setFxMode');
    renderWithProviders(<FxRateCard />, 'en');
    await ready();
    expect(screen.getByTestId('fx-source')).toHaveTextContent('MANUAL');
    expect(within(screen.getByTestId('fx-automatic')).getAllByText('NONE').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('radio', { name: 'AUTOMATIC' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('There is no Banxico rate');
    expect(dialog).toHaveTextContent('Right now your manual rate is in force: 19.0000 pesos per dollar.');
    expect(dialog).toHaveTextContent('If you switch to automatic, 18.0000 pesos per dollar would be in force.');
    // El párrafo más largo del sistema, COMPLETO y sin «ver más».
    expect(dialog).toHaveTextContent('No Banxico rate has ever reached this system.');
    expect(dialog).toHaveTextContent('changes by −5.26 %');
    expect(dialog).toHaveTextContent("What's already closed isn't touched");
    expect(put).toHaveBeenCalledTimes(0);
  });
});

describe('⭐ v1.63.3 · `applied` se OBEDECE; ⛔ no se deriva del `mode`', () => {
  /**
   * El estado de la **cuarta fila de §M2-F.1**: `mode: "manual"` **sin número**, con una fila de
   * Banxico. Sólo se alcanza por SQL/migración, y es exactamente donde la definición vieja
   * (`applied ⟺ mode === "manual"`) mentía. La pantalla pinta lo que el DTO dice.
   *
   * ⚠️ Y la tarjeta pinta **lo que el DTO diga**, no lo que sepamos del servidor: aquí se sirve el
   * DTO de la 4ª fila ya defendida (`FX-23`, implementado — rige la fila de Banxico) y el caso sin
   * ninguna fila se cubre en FX-UI-2 (`source: "fallback"`, las DOS `applied` en `false`). Los dos
   * salen de la misma rama de render, y ninguno consulta el `mode` para decidir la marca.
   */
  it('`mode: "manual"` con `applied: false` ⇒ la columna MANUAL ⛔ NO lleva `RIGE`', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(
      fxState({
        rate: 18.2431,
        source: 'banxico',
        mode: 'manual',
        manual: { rate: null, applied: false },
        automatic: { rate: 18.2431, effectiveDate: '2026-09-05', ageDays: 3, status: 'fresh', applied: true },
      }),
    );
    renderWithProviders(<FxRateCard />, 'es');
    await ready();

    expect(within(screen.getByTestId('fx-manual')).queryByText(T.ruling.mark)).not.toBeInTheDocument();
    expect(within(screen.getByTestId('fx-automatic')).getByText(T.ruling.mark)).toBeInTheDocument();
    expect(screen.getByTestId('fx-current')).toHaveTextContent('18.2431');
    // El segmento MANUAL sigue marcado (es el `mode` que el servidor dice) pero ⛔ no es pulsable
    // sin número guardado, y lo dice.
    expect(segment('MANUAL')).toHaveAttribute('aria-checked', 'true');
    expect(segment('MANUAL')).toBeDisabled();
    expect(screen.getByText(T.toggle.noManualReason)).toBeInTheDocument();
  });
});
