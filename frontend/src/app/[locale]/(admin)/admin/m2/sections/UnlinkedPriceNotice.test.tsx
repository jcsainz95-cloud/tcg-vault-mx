import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as repair from '@/lib/api/catalog-link-repair';
import * as exc from '@/lib/api/catalog-link-exceptions';
import { ApiClientError } from '@/lib/api-client';
import type { UnlinkedPriceReport } from '@/types/contract';
import { UnlinkedPriceNotice } from './UnlinkedPriceNotice';

const UUID1 = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const UUID2 = '8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
const REPORT: UnlinkedPriceReport = {
  totalCards: 12,
  sets: [
    { setId: UUID1, name: 'Scarlet', unlinked: 9, total: 100, collisions: 2, omittedProducts: null },
    { setId: UUID2, name: 'Violet', unlinked: 3, total: 50, collisions: null, omittedProducts: 1, conflicts: 2 },
  ],
  notLinkable: { totalCards: 4, sets: [{ setId: 'x', name: 'Promos Raros', unlinked: 4, reason: 'no_group' }] },
};

const SUM: exc.LinkExceptionsSummary = {
  unlinkedCards: 12, unlinkedSets: 2, repairedYesterday: 5, pricedYesterday: 5, lastRunAt: null, nextRunAt: null, waitingDecision: null, pendingConfirm: null, autoLinkEnabled: null,
};
const R = (o: Partial<repair.LinkRepairResult>): repair.LinkRepairResult => ({
  linked: 0, priced: null, groupUsed: null, reason: null, nextAttemptAt: null, reasons: [], piecesCorrected: 0, piecesExcluded: [], ...o,
});

beforeEach(() => {
  vi.restoreAllMocks();
  // Sin link-exceptions (backend previo): la lista cae a `sync-status.unlinkedPrice`.
  vi.spyOn(exc, 'getLinkExceptions').mockRejectedValue(new Error('offline'));
});

describe('UnlinkedPriceNotice', () => {
  it('ausente o 0 cartas: no pinta nada', () => {
    const a = renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    expect(a.container.textContent).toBe('');
    const b = renderWithProviders(<UnlinkedPriceNotice report={{ totalCards: 0, sets: [] }} />);
    expect(b.container.textContent).toBe('');
  });

  it('presente: título con sets, lista por set, y «no ligables» aparte sin botón', () => {
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    expect(screen.getByText('12 cartas sin precio ligado en 2 sets')).toBeTruthy();
    expect(screen.getByText(/9 de 100 sin ligar · 2 coincidencias dudosas/)).toBeTruthy();
    expect(screen.getByText(/3 de 50 sin ligar · 1 omitidos/)).toBeTruthy();
    expect(screen.queryByText(/no cambia precios ya cargados/)).toBeNull();
    const nl = screen.getByTestId('unlinked-not-linkable');
    expect(nl.textContent).toMatch(/Promos Raros.*este set no tiene grupo de precios/);
    expect(nl.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('reintento ok: llama link-repair con el UUID local y dice cuántas se ligaron', async () => {
    const spy = vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 5, reasons: [], piecesCorrected: 2, piecesExcluded: [{ key: 'customerVault', count: 3 }, { key: 'movement', count: 1 }] }));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(UUID1));
    expect((await screen.findByTestId('unlinked-result')).textContent).toBe(
      'Se ligaron 5 cartas en Scarlet. Se corrigieron los acabados de 2 piezas. No se tocaron: 3 en bóveda de clientes, 1 con movimientos.',
    );
  });

  it('0 ligadas: dice la verdad con el motivo', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 0, reasons: [{ key: 'collisions', count: null }], piecesCorrected: 0, piecesExcluded: [] }));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Violet/ }));
    expect((await screen.findByTestId('unlinked-result')).textContent).toBe(
      'No se pudo ligar ninguna carta en Violet: hay números repetidos y no se sabe cuál es cuál.',
    );
  });

  it('429: espera unos minutos; otro error: alerta', async () => {
    const spy = vi
      .spyOn(repair, 'repairCatalogLinks')
      .mockRejectedValueOnce(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'x', details: { retryAfterSeconds: 540 } } as never))
      .mockRejectedValueOnce(new ApiClientError(503, { code: 'UPSTREAM_ERROR', message: 'x' } as never));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    expect(await screen.findByText('Espera 9 minutos antes de reintentar este set.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Violet/ }));
    expect(await screen.findByText('La fuente de precios no respondió, intenta más tarde.')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('UnlinkedPriceNotice · nombre y motivos', () => {
  it('m-11: el nombre del set se conserva aunque la fila desaparezca al refrescar', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 29, reasons: [], piecesCorrected: 0, piecesExcluded: [] }));
    function H() {
      const [r, setR] = useState(REPORT);
      return (
        <>
          <UnlinkedPriceNotice report={r} />
          <button onClick={() => setR({ ...REPORT, sets: [REPORT.sets[1]] })}>drop</button>
        </>
      );
    }
    renderWithProviders(<H />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    await screen.findByTestId('unlinked-result');
    fireEvent.click(screen.getByText('drop'));
    expect(screen.queryByRole('button', { name: /Actualizar este set: Scarlet/ })).toBeNull();
    expect(screen.getByTestId('unlinked-result').textContent).toBe('Se ligaron 29 cartas en Scarlet.Cerrar');
  });
  it('I-13: con 0 ligadas lista hasta 2 motivos de cartas con su cuenta', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 0, reasons: [{ key: 'nameMismatch', count: 1 }, { key: 'ownerConflict', count: 2 }], piecesCorrected: 0, piecesExcluded: [] }));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    expect((await screen.findByTestId('unlinked-result')).textContent).toBe('No se pudo ligar ninguna carta en Scarlet: 1 por nombre distinto, 2 con dueño distinto.');
  });
});

describe('§AUTO-ENLACE · F1/F2/F4', () => {
  const X = { lastAttemptAt: null, tries: null, candidates: [], canConfirm: false };
  const EXC = {
    unlinkedCards: 12,
    summary: SUM,
    sets: [
      { setId: UUID1, name: 'Scarlet', unlinked: 9, total: 100, reason: 'group_ambiguous' as const, groupUsed: null, nextAttemptAt: null, ...X },
      { setId: UUID2, name: 'Violet', unlinked: 3, total: 50, reason: null, groupUsed: { groupId: 7, name: 'SV: Violet', via: 'auto' as const }, nextAttemptAt: null, ...X },
      { setId: 'z', name: 'Fuera', unlinked: 2, total: 5, reason: 'not_in_provider' as const, groupUsed: null, nextAttemptAt: null, ...X },
    ],
  };
  it('lista desde link-exceptions: motivo y grupo por set; sin botón para «no en proveedor»', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue(EXC);
    renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    expect(await screen.findByText('Scarlet')).toBeTruthy();
    expect(screen.getByText(/hay varios grupos de precios posibles/)).toBeTruthy();
    expect(screen.getByText(/Grupo de precios: SV: Violet \(automático\)/)).toBeTruthy();
    expect(screen.getByText(/Grupo de precios: sin grupo asignado/)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('unlinked-not-linkable').textContent).toMatch(/Fuera.*la fuente de precios no tiene este set/);
  });
  it('F1: el resultado queda DENTRO de la fila pulsada (no al final de la lista)', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue(EXC);
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 4, priced: 4 }));
    renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Actualizar este set: Scarlet/ }));
    const res = await screen.findByTestId('unlinked-result');
    expect(res.closest('li')?.textContent).toContain('Scarlet');
    expect(res.closest('li')?.textContent).not.toContain('Violet');
    expect(res.textContent).toBe('Se ligaron 4 cartas en Scarlet. Se actualizaron 4 precios.');
  });
  it('0 ligadas con motivo del servidor: lo dice en español claro', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ reason: 'provider_failing', nextAttemptAt: null }));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    expect((await screen.findByTestId('unlinked-result')).textContent).toBe(
      'No se pudo ligar ninguna carta en Scarlet: la fuente de precios está fallando; vuelve a intentarlo más tarde.',
    );
  });
});

describe('§AUTO-ENLACE fase 1 · correcciones tras gate', () => {
  const REPORT_G: UnlinkedPriceReport = {
    totalCards: 5,
    sets: [
      { setId: UUID1, name: 'Scarlet', unlinked: 3, total: 100, collisions: null, omittedProducts: null, groupUsed: { groupId: 7, name: null, via: 'auto' }, reason: 'collisions' },
      { setId: UUID2, name: 'Violet', unlinked: 2, total: 50, collisions: null, omittedProducts: null, groupUsed: { groupId: 8, name: null, via: 'promo_table' }, reason: null },
    ],
    notLinkable: { totalCards: 4, sets: [{ setId: 'p', name: 'SV Promos', unlinked: 4, reason: 'no_group', exceptionReason: 'promo_route', groupUsed: { groupId: 9, name: 'Promos SV', via: 'promo_table' } }] },
  };
  it('B-3/M-1: sin link-exceptions pinta grupo y motivo; name null cae a id o «grupo de promos»; promo_route con texto propio', () => {
    renderWithProviders(<UnlinkedPriceNotice report={REPORT_G} />);
    expect(screen.getByText(/hay números repetidos/)).toBeTruthy();
    expect(screen.getByText(/Grupo de precios: grupo 7 \(automático\)/)).toBeTruthy();
    expect(screen.getByText(/Grupo de precios: grupo de promos \(tabla de promos\)/)).toBeTruthy();
    const nl = screen.getByTestId('unlinked-not-linkable').textContent ?? '';
    expect(nl).toMatch(/SV Promos.*es un set de promos y sigue su propia ruta/);
    expect(nl).not.toMatch(/sin coincidencia clara/);
    expect(nl).toMatch(/Promos SV/);
  });
  it('I-4: si la fila desaparece al refrescar, el resultado sigue visible arriba de la lista', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 3, priced: 3 }));
    function Host() {
      const [done, setDone] = useState(false);
      return (
        <>
          <button onClick={() => setDone(true)}>refrescar</button>
          <UnlinkedPriceNotice report={done ? { ...REPORT_G, sets: [REPORT_G.sets[1]!] } : REPORT_G} />
        </>
      );
    }
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    await screen.findByTestId('unlinked-result');
    fireEvent.click(screen.getByText('refrescar'));
    const res = await screen.findByTestId('unlinked-result');
    expect(res.textContent).toContain('Se ligaron 3 cartas en Scarlet');
    expect(res.closest('[data-testid="unlinked-resolved"]')).not.toBeNull();
  });
  it('V3: con linked>0 y priced>0 se muestra el aviso de finish_not_in_product (caso real vía readLinkRepair)', async () => {
    const real = repair.readLinkRepair({ linked: 5, priced: 4, omitted: [{ reason: 'finish_not_in_product', count: 3 }] });
    expect(real.finishNotInProduct).toBe(3);
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(real);
    renderWithProviders(<UnlinkedPriceNotice report={REPORT_G} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    const txt = (await screen.findByTestId('unlinked-result')).textContent ?? '';
    expect(txt).toMatch(/Se ligaron 5 cartas/);
    expect(txt).toMatch(/Se actualizaron 4 precios/);
    expect(txt).toMatch(/3 cartas tienen un acabado que la fuente no da para ese producto; quedan sin precio de ese acabado/);
  });
  it.each([
    ['0/0', 0, 0, /No se pudo ligar ninguna carta en Scarlet: .*por nombre distinto.*acabado/],
    ['0/28', 0, 28, /No hubo cartas nuevas por ligar en Scarlet\..*Se actualizaron 28 precios/],
    ['5/0', 5, 0, /Se ligaron 5 cartas en Scarlet/],
    ['5/28', 5, 28, /Se ligaron 5 cartas en Scarlet.*Se actualizaron 28 precios/],
  ])('V3: caso real (finish 1 + name_mismatch 1) con linked/priced %s muestra ambos avisos una sola vez', async (_n, linked, priced, lead) => {
    const real = repair.readLinkRepair({
      linked, priced, omitted: [{ reason: 'finish_not_in_product', count: 1 }, { reason: 'name_mismatch', count: 1 }],
    });
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(real);
    renderWithProviders(<UnlinkedPriceNotice report={REPORT_G} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    const txt = (await screen.findByTestId('unlinked-result')).textContent ?? '';
    expect(txt).toMatch(lead);
    expect(txt.match(/un acabado que/g)).toHaveLength(1);
    expect(txt.match(/nombre (distinto|no coincide)/g)).toHaveLength(1);
    if (linked === 0 && priced === 0) return;
    expect(txt).toMatch(/1 carta tiene un acabado que la fuente no da/);
    expect(txt).toMatch(/1 carta quedó sin ligar porque el nombre no coincide/);
  });
  it('M1: el resultado fijo de I-4 se puede cerrar', async () => {
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 3, priced: 3 }));
    function Host() {
      const [done, setDone] = useState(false);
      return (
        <>
          <button onClick={() => setDone(true)}>refrescar</button>
          <UnlinkedPriceNotice report={done ? { ...REPORT_G, sets: [REPORT_G.sets[1]!] } : REPORT_G} />
        </>
      );
    }
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    await screen.findByTestId('unlinked-result');
    fireEvent.click(screen.getByText('refrescar'));
    fireEvent.click(await screen.findByTestId('unlinked-result-close'));
    await waitFor(() => expect(screen.queryByTestId('unlinked-result')).toBeNull());
  });
  it('I-1: availableAgainAt/nextAttemptAt se lee como enfriamiento, nunca «se reintenta solo»', async () => {
    expect(repair.readLinkRepair({ linked: 1, availableAgainAt: '2026-11-27T12:00:00Z' }).nextAttemptAt).toBe('2026-11-27T12:00:00Z');
    vi.spyOn(repair, 'repairCatalogLinks').mockResolvedValue(R({ linked: 1, nextAttemptAt: '2026-11-27T12:00:00Z' }));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT_G} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    const txt = (await screen.findByTestId('unlinked-result')).textContent ?? '';
    expect(txt).toMatch(/Disponible de nuevo a las/);
    expect(txt).not.toMatch(/reintenta solo/);
  });
  it('M-3: mientras un botón corre, el de la otra fila también se deshabilita', async () => {
    let done: (v: repair.LinkRepairResult) => void = () => {};
    vi.spyOn(repair, 'repairCatalogLinks').mockReturnValue(new Promise((r) => { done = r; }));
    renderWithProviders(<UnlinkedPriceNotice report={REPORT_G} />);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar este set: Scarlet/ }));
    await waitFor(() => expect((screen.getByRole('button', { name: /Actualizar este set: Violet/ }) as HTMLButtonElement).disabled).toBe(true));
    done(R({ linked: 1 }));
    await screen.findByTestId('unlinked-result');
  });
});

describe('readLinkRepair', () => {
  it('mapea el motivo dominante', () => {
    expect(repair.readLinkRepair({ linked: 3 })).toEqual(R({ linked: 3 }));
    expect(repair.readLinkRepair({ linked: 0, piecesExcluded: [{ reason: 'movement:refund_return', count: 2 }, { reason: 'zzz', count: 1 }] }).piecesExcluded).toEqual([{ key: 'movement', count: 2 }, { key: 'other', count: 1 }]);
    expect(repair.readLinkRepair({ linked: 0, notLinkable: 'no_group' }).reasons).toEqual([{ key: 'noGroup', count: null }]);
    expect(repair.readLinkRepair({ linked: 0, collisions: 1, conflicts: 4 }).reasons[0]).toEqual({ key: 'ownerConflict', count: 4 });
    // I-13: no_local_card (incluye sellado) no tapa los motivos de cartas; hasta 2, en orden.
    const mixed = repair.readLinkRepair({ linked: 0, conflicts: 2, omitted: [{ reason: 'no_local_card', count: 90 }, { reason: 'name_mismatch', count: 1 }, { reason: 'card_already_linked', count: 5 }] });
    expect(mixed.reasons).toEqual([{ key: 'ownerConflict', count: 2 }, { key: 'nameMismatch', count: 1 }]);
    expect(repair.readLinkRepair({ linked: 0, omitted: [{ reason: 'no_local_card', count: 9 }] }).reasons).toEqual([{ key: 'noLocalCard', count: 9 }]);
    expect(repair.readLinkRepair({ linked: 0, omitted: [{ reason: 'name_mismatch', count: 2 }] }).reasons).toEqual([{ key: 'nameMismatch', count: 2 }]);
  });
});
describe('§AUTO-ENLACE F3 · Confirmar candidato', () => {
  const CAND = { groupId: 24380, name: 'Classic Collection', publishedOn: '2026-06-12', productCount: 34, score: 0.9 };
  const EXC3: exc.LinkExceptions = {
    unlinkedCards: 11,
    summary: SUM,
    sets: [{ setId: UUID1, name: 'Scarlet', unlinked: 11, total: 30, reason: 'name_mismatch', groupUsed: null, nextAttemptAt: null, lastAttemptAt: null, tries: 1, canConfirm: true,
      candidates: [CAND, { ...CAND, groupId: 2, name: 'Otro' }] }],
  };
  it('muestra el mejor candidato arriba, confirma y pinta el resultado junto al caso', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue(EXC3);
    const spy = vi.spyOn(exc, 'confirmLinkException').mockResolvedValue({ setId: UUID1, groupUsed: null, linked: 9, priced: 18, collisions: 0, conflicts: 0 });
    renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    expect(await screen.findByText(/Mejor candidato: Classic Collection/)).toBeTruthy();
    expect(screen.getByText(/los nombres de las cartas no coinciden/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar el grupo Classic Collection para Scarlet/ }));
    const res = await screen.findByTestId('confirm-result');
    expect(spy).toHaveBeenCalledWith(UUID1, 24380);
    expect(res.closest('li')?.textContent).toContain('Scarlet');
    expect(res.textContent).toMatch(/Confirmado en Scarlet: 9 cartas ligadas y 18 precios actualizados\./);
  });
  it('422 GROUP_NOT_FOUND se explica en claro', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue(EXC3);
    vi.spyOn(exc, 'confirmLinkException').mockRejectedValue(new ApiClientError(422, { code: 'GROUP_NOT_FOUND', message: 'x', details: {} }));
    renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar el grupo Classic Collection/ }));
    expect((await screen.findByTestId('confirm-error')).textContent).toMatch(/ya no existe/);
  });
  it('sin canConfirm no hay botón Confirmar', async () => {
    vi.spyOn(exc, 'getLinkExceptions').mockResolvedValue({ ...EXC3, sets: [{ ...EXC3.sets[0], canConfirm: false }] });
    renderWithProviders(<UnlinkedPriceNotice report={undefined} />);
    await screen.findByText('Scarlet');
    expect(screen.queryByText('Confirmar')).toBeNull();
  });
});
