import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { FxSection } from './FxSection';
import type { FxDTO, FxRefreshDTO, FxRefreshOutcome, FxRefreshReason } from '@/types/contract';
import * as api from '@/lib/api';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS DOS BLOQUEANTES QUE QA DEVOLVIÓ, HECHOS EJECUTABLES
 *
 * **B-1 · `source: "fallback"` no tenía rama y el backend YA lo emite.** Con la tabla `FxRate`
 * vacía y el modo en `auto`, `GET /admin/fx` devuelve `source: "fallback"`: el sistema **no tiene
 * ninguna tasa real** y está cotizando todo el catálogo con un **18 escrito en el código**. La
 * pantalla pintaba la ruta de la clave i18n y —peor— un badge `info` (azul, «todo normal») sobre
 * ese 18. Aquí se fija lo que §30.5 manda: rótulo **`SIN RESPALDO REAL`**, acento, el párrafo que
 * dice que nadie tecleó ese número, y ⛔ **jamás `MANUAL`**.
 *
 * **B-2 · el refresco fallido se pintaba VERDE**, que es literalmente lo que el dueño reportó:
 * pulsó «Refrescar Banxico», leyó *«Tipo de cambio actualizado»* y el fetch no había ocurrido.
 * `POST /admin/fx/refresh` contesta `200` aunque falle, y §M2-F.5 es normativa: *«la UI está
 * OBLIGADA a distinguir `failed` visualmente»*. Aquí se rompe a propósito (`outcome: "failed"`) y
 * se exige el rojo, con su **control negativo** (`updated` sí es éxito) al lado.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** `FxStateDTO` completo (§M2-F.3): las dos tasas viajan SIEMPRE, rija la que rija. */
function fxState(over: Partial<FxDTO> = {}): FxDTO {
  return {
    rate: 18.42,
    bufferPct: 3,
    source: 'banxico',
    effectiveDate: '2026-09-08',
    mode: 'auto',
    modeResolvedFrom: 'setting',
    manual: { rate: null, applied: false },
    automatic: { rate: 18.42, effectiveDate: '2026-09-08', ageDays: 1, status: 'fresh', applied: true },
    ...over,
  };
}

/** El estado REAL del hallazgo: sin fila `FxRate` y sin tasa manual ⇒ rige el 18 de código. */
function fxFallbackState(): FxDTO {
  return fxState({
    rate: 18,
    source: 'fallback',
    manual: { rate: null, applied: false },
    automatic: { rate: null, effectiveDate: null, ageDays: null, status: 'missing', applied: false },
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
      at: '2026-09-08T17:04:11Z',
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getFx').mockResolvedValue(fxState());
});

/** El botón que dispara el refresco. */
async function clickRefresh() {
  await userEvent.click(await screen.findByRole('button', { name: /Refrescar Banxico/ }));
}

describe('FxSection · B-1: `source: "fallback"` tiene rama propia y NO se disfraza de manual', () => {
  it('pinta SIN RESPALDO REAL — no la ruta de la clave, y ⛔ nunca MANUAL', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxFallbackState());
    renderWithProviders(<FxSection />, 'es');

    expect(await screen.findByText('SIN RESPALDO REAL')).toBeInTheDocument();
    // La mentira de v1.62.2: el 18 de código presentado como el número del dueño.
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument();
    // Y la avería de next-intl sin `onError`: la ruta de la clave pintada como si fuera copy.
    expect(screen.queryByText(/sourceLabel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin\.m2\.fx/)).not.toBeInTheDocument();
  });

  it('el badge va en ACENTO, no en el tono informativo de un estado normal', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxFallbackState());
    renderWithProviders(<FxSection />, 'es');

    // La línea 65 original era `tone={source === 'manual' ? 'accent' : 'info'}` ⇒ azul informativo
    // sobre una tasa que nadie tecleó. `info` y `neutral` pintan `text-muted`: ninguno vale aquí.
    const badge = await screen.findByText('SIN RESPALDO REAL');
    expect(badge).toHaveClass('text-accent');
    expect(badge).not.toHaveClass('text-muted');
  });

  it('DICE que ese número no lo tecleó nadie y que todos los precios salen de él', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxFallbackState());
    renderWithProviders(<FxSection />, 'es');

    expect(
      await screen.findByText(/no lo tecleó nadie y no viene de Banxico/),
    ).toBeInTheDocument();
    expect(screen.getByText(/se están calculando con él ahora mismo/)).toBeInTheDocument();
  });

  it('CONTROL: `banxico` y `manual` siguen pintando su propio rótulo, en tinta', async () => {
    vi.spyOn(api, 'getFx').mockResolvedValue(fxState());
    const view = renderWithProviders(<FxSection />, 'es');
    const banxico = await screen.findByText('BANXICO');
    expect(banxico).toHaveClass('text-text');
    // Y sin el párrafo del fallback: el caso normal no grita.
    expect(screen.queryByText(/no lo tecleó nadie/)).not.toBeInTheDocument();
    view.unmount();

    vi.spyOn(api, 'getFx').mockResolvedValue(
      fxState({ rate: 19, source: 'manual', mode: 'manual', manual: { rate: 19, applied: true } }),
    );
    renderWithProviders(<FxSection />, 'es');
    expect(await screen.findByText('MANUAL')).toHaveClass('text-text');
  });

  it('una fuente que esta pantalla no conoce se pinta NEUTRA y lo declara (⛔ no cae a MANUAL)', async () => {
    // El día que el contrato gane un cuarto valor, esta pantalla no puede afirmar de dónde sale
    // el dinero: lo dice. (Fallback neutro de §28.3 / §30.5.)
    vi.spyOn(api, 'getFx').mockResolvedValue(
      fxState({ source: 'ecb' as unknown as FxDTO['source'] }),
    );
    renderWithProviders(<FxSection />, 'es');

    expect(await screen.findByText('FUENTE NO RECONOCIDA')).toBeInTheDocument();
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument();
    expect(screen.getByText(/No se puede afirmar de dónde sale la tasa/)).toBeInTheDocument();
  });
});

describe('FxSection · B-2: un refresco `failed` NO se anuncia como éxito', () => {
  it('⭐ `outcome: "failed"` ⇒ rojo, `role="alert"`, y NADA de «Tipo de cambio actualizado»', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('failed', { reason: 'no_token' }));
    const { container } = renderWithProviders(<FxSection />, 'es');
    await clickRefresh();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo traer la tasa de Banxico');
    // El motivo REAL de producción hoy (D-OPS-1 / P-63), traducido a lo que el dueño puede hacer.
    expect(alert).toHaveTextContent(/le falta la credencial de Banxico/);
    // Sigue diciendo qué rige mientras tanto: el DTO de vuelta es válido.
    expect(alert).toHaveTextContent('Sigue rigiendo 18.4200 (BANXICO).');

    // ⛔ Ni la frase, ni el verde: la mitad exacta de la queja del dueño.
    expect(screen.queryByText('Tipo de cambio actualizado.')).not.toBeInTheDocument();
    expect(container.querySelector('.border-success')).toBeNull();
  });

  it('cada motivo se traduce, y uno desconocido NO se cae al copy de éxito', async () => {
    const cases: [FxRefreshReason, RegExp][] = [
      ['http_error', /Banxico contestó con un error/],
      ['invalid_payload', /no se pudo leer como una tasa/],
      ['network_error', /No se pudo llegar a Banxico/],
    ];
    for (const [reason, copy] of cases) {
      vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('failed', { reason }));
      const view = renderWithProviders(<FxSection />, 'es');
      await clickRefresh();
      expect(await screen.findByRole('alert')).toHaveTextContent(copy);
      view.unmount();
    }

    vi.spyOn(api, 'refreshFx').mockResolvedValue(
      refreshResult('failed', { reason: 'quota_exceeded' as unknown as FxRefreshReason }),
    );
    const { container } = renderWithProviders(<FxSection />, 'es');
    await clickRefresh();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo traer la tasa y el sistema no dijo por qué.',
    );
    expect(container.querySelector('.border-success')).toBeNull();
  });

  it('un `200` SIN bloque `refresh` tampoco se anuncia como éxito', async () => {
    // Contra un servidor que no haya desplegado §M2-F.5 no se puede afirmar que el fetch ocurrió.
    vi.spyOn(api, 'refreshFx').mockResolvedValue(fxState() as FxRefreshDTO);
    const { container } = renderWithProviders(<FxSection />, 'es');
    await clickRefresh();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo traer la tasa de Banxico');
    expect(container.querySelector('.border-success')).toBeNull();
  });

  it('⭐ CONTROL NEGATIVO: `outcome: "updated"` SÍ es éxito, con la cifra que devolvió Banxico', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('updated', { fetchedRate: 18.6312 }));
    const { container } = renderWithProviders(<FxSection />, 'es');
    await clickRefresh();

    expect(
      await screen.findByText(/Banxico devolvió 18\.6312\. Es distinta de la que teníamos/),
    ).toBeInTheDocument();
    expect(container.querySelector('.border-success')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('`unchanged` dice que no cambió nada y que NO es un fallo (ni verde de update, ni rojo)', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(refreshResult('unchanged', { fetchedRate: 18.42 }));
    renderWithProviders(<FxSection />, 'es');
    await clickRefresh();

    expect(await screen.findByText(/la misma que ya teníamos/)).toBeInTheDocument();
    expect(screen.getByText(/No cambió nada, y no es un fallo/)).toBeInTheDocument();
    expect(screen.queryByText(/Es distinta de la que teníamos/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('en modo manual, un `updated` aclara que NO cambia cuál rige (§M2-F.5)', async () => {
    vi.spyOn(api, 'refreshFx').mockResolvedValue(
      refreshResult('updated', {
        fetchedRate: 18.6312,
        state: { rate: 19, source: 'manual', mode: 'manual', manual: { rate: 19, applied: true } },
      }),
    );
    renderWithProviders(<FxSection />, 'es');
    await clickRefresh();

    expect(await screen.findByText(/Sigue rigiendo tu tasa manual \(19\.0000\)/)).toBeInTheDocument();
  });
});

describe('FxSection · M-6: la ayuda describe la regla que rige HOY', () => {
  it('ya no afirma que el override manual tiene prioridad; dice que el MODO decide', async () => {
    renderWithProviders(<FxSection />, 'es');
    await screen.findByText('BANXICO');

    // La frase derogada por §M2-F.1 (el pase que separa el MODO del VALOR).
    expect(screen.queryByText(/tiene prioridad sobre el automático/)).not.toBeInTheDocument();
    expect(screen.getByText(/lo decide el modo del sistema/)).toBeInTheDocument();
    // Y la mitad que el dueño necesita saber: su número no se pierde.
    expect(screen.getByText(/la tasa manual se guarda siempre/)).toBeInTheDocument();
  });
});

describe('FxSection · lo que este arreglo NO podía romper', () => {
  it('guardar SOLO el colchón sigue mandando el payload sin `rate` (#13)', async () => {
    const spy = vi.spyOn(api, 'updateFx').mockResolvedValue(fxState({ bufferPct: 5 }));
    renderWithProviders(<FxSection />, 'es');

    await userEvent.type(await screen.findByLabelText('Nuevo colchón %'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Fijar override' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ bufferPct: 5 }));
    expect(spy.mock.calls[0][0]).not.toHaveProperty('rate');
  });
});
