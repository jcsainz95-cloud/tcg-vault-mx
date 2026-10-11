import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, getDefaultNormalizer } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { M12View } from './M12View';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { DecksMetaRefreshReport, DecksMetaPreviewResponse } from '@/types/contract';

/** v1.80 (P-71): el código se pinta «TWM 130» con espacio NO separable; el normalizador por defecto lo colapsaría. */
const KEEP_NBSP = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) };

// El rol de back-office se controla por test (patrón de DecksMetaDialControl.test).
const roleState = vi.hoisted(() => ({ role: 'super_admin' as 'super_admin' | 'vault_operator' }));
vi.mock('@/lib/role', () => ({
  useRole: () => ({
    role: roleState.role,
    setRole: () => {},
    isSuperAdmin: roleState.role === 'super_admin',
    canSwitchRole: false,
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  roleState.role = 'super_admin';
});

function report(over: Partial<DecksMetaRefreshReport> = {}): DecksMetaRefreshReport {
  return {
    mode: 'dryrun',
    formatCode: 'H-F',
    formatLabel: 'Standard (H–F)',
    autopublish: false,
    startedAt: '2026-09-19T12:00:00Z',
    finishedAt: '2026-09-19T12:00:38Z',
    urlsFetched: ['home', 'list/a', 'list/b'],
    decks: [
      { archetypeId: 'dragapult-ex', name: 'Dragapult ex', rank: 1, sharePct: 12.4, listId: 'a', cardsParsed: 18, sumQuantity: 60, matched: 17, total: 18, matchStatusBreakdown: { matched: 17 }, inBand: true },
      { archetypeId: 'charizard-ex', name: 'Charizard ex', rank: 2, sharePct: 10.1, listId: 'b', cardsParsed: 20, sumQuantity: 60, matched: 20, total: 20, matchStatusBreakdown: { matched: 20 }, inBand: true },
    ],
    canary: {
      verdict: 'PUBLISH',
      inBandDeckCount: 2,
      reason: null,
      checks: [
        { id: 'C1', ok: true, measured: 2, threshold: 3, label: 'x' },
        { id: 'C2', ok: true, measured: 0, threshold: 0, label: 'x' },
        { id: 'C3', ok: true, measured: 0.97, threshold: 0.9, label: 'x' },
        { id: 'C4', ok: true, measured: 0.03, threshold: 0.1, label: 'x' },
        { id: 'C5', ok: true, measured: 8, threshold: 3, label: 'x' },
      ],
    },
    verdict: 'PUBLISH',
    wouldPublish: true,
    applied: false,
    persistedCount: 0,
    publishedSlugs: [],
    supersededListIds: [],
    manualConflicts: [],
    pausedSkipped: [],
    errors: [],
    ...over,
  };
}

describe('M12View · Ensayo decks meta (dry-run)', () => {
  it('al correr el ensayo pinta el veredicto PUBLICARÍA y una fila por deck', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({ skipped: false, mode: 'dryrun', report: report() });
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    expect(await screen.findByText('PUBLICARÍA')).toBeInTheDocument();
    // Una fila por deck (aparece dos veces: tabla md+ y bloque móvil, por eso getAllByText).
    expect(screen.getAllByText('Dragapult ex').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Charizard ex').length).toBeGreaterThan(0);
    // Los cinco chequeos con su rótulo humano.
    expect(screen.getByText('arquetipos encontrados')).toBeInTheDocument();
    expect(screen.getByText('página principal legible')).toBeInTheDocument();
    // Modo en solo-lectura.
    expect(screen.getByText('ensayo — no publica nada')).toBeInTheDocument();
  });

  it('cuando el canary NO pasa, el veredicto es NO PUBLICARÍA', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({
      skipped: false,
      mode: 'dryrun',
      report: report({
        verdict: 'NO_PUBLISH',
        wouldPublish: false,
        canary: {
          verdict: 'NO_PUBLISH',
          inBandDeckCount: 0,
          reason: 'C1',
          checks: [{ id: 'C1', ok: false, measured: 0, threshold: 3, label: 'x' }],
        },
        manualConflicts: ['gardevoir-ex'],
      }),
    });
    renderWithProviders(<M12View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    expect(await screen.findByText('NO PUBLICARÍA')).toBeInTheDocument();
    // Conflicto manual listado en notas.
    expect(screen.getByText('gardevoir-ex')).toBeInTheDocument();
  });

  it('un fallo de red muestra el aviso amable con reintento', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockRejectedValue(new ApiClientError(502, { code: 'INTERNAL', message: 'boom' }));
    renderWithProviders(<M12View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    expect(
      await screen.findByText('No se pudo correr el ensayo. Suele ser un problema de red con Limitless; vuelve a intentarlo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('en EN también pinta el veredicto (paridad de catálogo)', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({ skipped: false, mode: 'dryrun', report: report() });
    renderWithProviders(<M12View />, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'Run dry-run' }));
    expect(await screen.findByText('WOULD PUBLISH')).toBeInTheDocument();
  });

  // SUP-LEG (trust-source): el reporte ya NO trae diagnóstico de legalidad, así que la pantalla no
  // lo pinta.
  it('ya no pinta el bloque de diagnóstico de legalidad', async () => {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({ skipped: false, mode: 'dryrun', report: report() });
    renderWithProviders(<M12View />, 'es');
    fireEvent.click(screen.getByRole('button', { name: 'Correr ensayo' }));

    await screen.findByText('PUBLICARÍA');
    expect(screen.queryByText('Diagnóstico de legalidad')).not.toBeInTheDocument();
    expect(screen.queryByText('Caídas por legalidad')).not.toBeInTheDocument();
  });
});

describe('M12View · Publicar ahora (publicación real inmediata)', () => {
  it('el botón "Publicar ahora" solo se ve para super_admin, no para operador', () => {
    const { unmount } = renderWithProviders(<M12View />, 'es');
    expect(screen.getByRole('button', { name: 'Publicar ahora' })).toBeInTheDocument();
    unmount();

    roleState.role = 'vault_operator';
    renderWithProviders(<M12View />, 'es');
    expect(screen.queryByRole('button', { name: 'Publicar ahora' })).not.toBeInTheDocument();
    expect(screen.queryByText('Publicar ahora')).not.toBeInTheDocument();
  });

  it('no publica de un clic: pide confirmación y, al confirmar, llama al endpoint real y pinta el éxito con el conteo', async () => {
    const runSpy = vi.spyOn(api, 'runDecksMetaPublishNow').mockResolvedValue({
      skipped: false,
      mode: 'live',
      report: report({
        mode: 'live',
        applied: true,
        publishedSlugs: ['dragapult-ex', 'charizard-ex', 'raging-bolt-ex'],
      }),
    });
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar ahora' }));
    // NO se llamó todavía: primero aparece la confirmación (esto publica de verdad).
    expect(runSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('¿Publicar ahora?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, publicar ahora' }));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));

    expect(await screen.findByText('Listo: se publicó en la tienda (3 decks).')).toBeInTheDocument();
  });

  it('con el interruptor apagado (DIAL_OFF) muestra el aviso de que no se publicó nada', async () => {
    const skippedDialOff: DecksMetaPreviewResponse = { skipped: true, reason: 'DIAL_OFF', mode: 'off' };
    vi.spyOn(api, 'runDecksMetaPublishNow').mockResolvedValue(skippedDialOff);
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar ahora' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, publicar ahora' }));

    expect(
      await screen.findByText(
        'El interruptor está apagado, así que no se publicó nada. Enciéndelo arriba para poder publicar.',
      ),
    ).toBeInTheDocument();
  });

  it('single-flight (ALREADY_RUNNING) muestra el aviso correspondiente', async () => {
    vi.spyOn(api, 'runDecksMetaPublishNow').mockResolvedValue({
      skipped: true,
      reason: 'ALREADY_RUNNING',
      mode: 'skipped',
    });
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar ahora' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, publicar ahora' }));

    expect(
      await screen.findByText('Ya hay una corrida en curso. Espera a que termine y vuelve a intentarlo.'),
    ).toBeInTheDocument();
  });

  it('un fallo de red al publicar muestra el aviso amable con reintento', async () => {
    vi.spyOn(api, 'runDecksMetaPublishNow').mockRejectedValue(
      new ApiClientError(502, { code: 'INTERNAL', message: 'boom' }),
    );
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar ahora' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, publicar ahora' }));

    expect(
      await screen.findByText('No se pudo publicar. Suele ser un problema de red con Limitless; vuelve a intentarlo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('cuando algún chequeo no deja publicar (publishedSlugs vacío) avisa que no se publicó nada', async () => {
    vi.spyOn(api, 'runDecksMetaPublishNow').mockResolvedValue({
      skipped: false,
      mode: 'live',
      report: report({ mode: 'live', wouldPublish: false, applied: false, publishedSlugs: [] }),
    });
    renderWithProviders(<M12View />, 'es');

    fireEvent.click(screen.getByRole('button', { name: 'Publicar ahora' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, publicar ahora' }));

    expect(
      await screen.findByText('No se publicó nada: algún chequeo no pasó. Se conservó la última lista buena.'),
    ).toBeInTheDocument();
  });
});

/**
 * rev `decks-portada` (§13 «Portada del deck», ARCHITECTURE §12.4.5): columna «Portada» del ensayo.
 * Regla «nunca arte externo»: la miniatura sale SOLO de `cover.imageUrl` (nuestro catálogo) y jamás
 * de Limitless — ni construida desde `SET-NÚM` ni aceptada si el backend la mandara por error.
 */
describe('M12View · columna Portada (decks-portada)', () => {
  const OUR_IMG = 'https://images.pokemontcg.io/sv6/130_hires.png';
  const LIMITLESS_IMG = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/TWM/TWM_130_R_EN_SM.png';

  function deck(over: Partial<DecksMetaRefreshReport['decks'][number]>): DecksMetaRefreshReport['decks'][number] {
    return {
      archetypeId: 'dragapult-ex', name: 'Dragapult ex', rank: 1, sharePct: 12.4, listId: 'a',
      cardsParsed: 18, sumQuantity: 60, matched: 17, total: 18, matchStatusBreakdown: { matched: 17 }, inBand: true,
      ...over,
    };
  }

  async function runWith(decks: DecksMetaRefreshReport['decks'], locale: 'es' | 'en' = 'es') {
    vi.spyOn(api, 'getDecksMetaPreview').mockResolvedValue({ skipped: false, mode: 'dryrun', report: report({ decks }) });
    renderWithProviders(<M12View />, locale);
    fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Correr ensayo' : 'Run dry-run' }));
    await screen.findByText(locale === 'es' ? 'PUBLICARÍA' : 'WOULD PUBLISH');
  }

  const imgSrcs = () => Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src') ?? '');

  it('portada casada: miniatura de NUESTRO catálogo + SET-NÚM + «casada»', async () => {
    await runWith([
      deck({ cover: { setCode: 'TWM', number: '130', matchStatus: 'matched', cardId: 'c1', imageUrl: OUR_IMG } }),
    ]);
    expect(screen.getAllByText('Portada').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TWM\u00A0130', KEEP_NBSP).length).toBeGreaterThan(0);
    expect(screen.getAllByText('casada').length).toBeGreaterThan(0);
    const srcs = imgSrcs();
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((s) => s === OUR_IMG)).toBe(true);
    expect(screen.getAllByAltText('Portada de Dragapult ex: TWM\u00A0130', KEEP_NBSP).length).toBeGreaterThan(0);
  });

  // 🔒 PRUEBA PRINCIPAL: si una URL de Limitless llega a pintarse (porque el backend la mandó por
  // error, o porque alguien «arregla» la miniatura construyéndola desde SET-NÚM), esto se pone rojo.
  it('NUNCA pinta una URL de Limitless, aunque el backend la mande en imageUrl', async () => {
    await runWith([
      deck({ cover: { setCode: 'TWM', number: '130', matchStatus: 'matched', cardId: 'c1', imageUrl: LIMITLESS_IMG } }),
      deck({
        archetypeId: 'charizard-ex', name: 'Charizard ex',
        cover: { setCode: 'OBF', number: '125', matchStatus: 'unmatched_number', cardId: null, imageUrl: null },
      }),
    ]);
    expect(screen.getAllByText('TWM\u00A0130', KEEP_NBSP).length).toBeGreaterThan(0);
    expect(screen.getAllByText('OBF\u00A0125', KEEP_NBSP).length).toBeGreaterThan(0);
    const srcs = imgSrcs();
    expect(srcs.filter((s) => /limitless/i.test(s))).toEqual([]);
    // Y ninguna imagen de otra fuente se cuela: sin imagen propia, queda el pozo vacío.
    expect(srcs).toEqual([]);
    // TD-a: dice la verdad — casó y el backend SÍ mandó imagen, pero se rechazó por violar el contrato.
    // No debe decir «sin imagen en el catálogo» (eso sería falso y escondería el defecto del backend).
    expect(screen.getAllByText(/imagen rechazada \(no es de nuestro catálogo\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/sin imagen en el catálogo/)).toBeNull();
    // a11y (QA menor 3): sin `<img>` no hay `alt`, pero la celda sigue teniendo nombre accesible.
    expect(screen.getAllByText('Portada de Dragapult ex: TWM\u00A0130', KEEP_NBSP).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Portada de Charizard ex: OBF\u00A0125', KEEP_NBSP).length).toBeGreaterThan(0);
  });

  it('casada sin imageUrl (legítimo): «sin imagen en el catálogo», NO «rechazada»', async () => {
    await runWith([
      deck({ cover: { setCode: 'TWM', number: '130', matchStatus: 'matched', cardId: 'c1', imageUrl: null } }),
    ]);
    expect(screen.getAllByText(/sin imagen en el catálogo/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/imagen rechazada/)).toBeNull();
    expect(imgSrcs()).toEqual([]);
  });

  it('matchStatus desconocido (contrato ampliado): respaldo legible, sin clave i18n cruda', async () => {
    await runWith([
      deck({
        cover: {
          setCode: 'MEG', number: '56', cardId: null, imageUrl: null,
          matchStatus: 'future_status' as unknown as 'ambiguous',
        },
      }),
    ]);
    expect(screen.getAllByText('no casada · motivo no reconocido (future_status)').length).toBeGreaterThan(0);
    expect(screen.queryByText(/reason\./)).toBeNull();
    expect(imgSrcs()).toEqual([]);
  });

  it('no casada: dice por qué y no pinta imagen', async () => {
    await runWith([
      deck({ cover: { setCode: 'MEG', number: '56', matchStatus: 'unmatched_set', cardId: null, imageUrl: null } }),
      deck({
        archetypeId: 'gardevoir-ex', name: 'Gardevoir ex',
        cover: { setCode: 'SVI', number: '86', matchStatus: 'ambiguous', cardId: null, imageUrl: OUR_IMG },
      }),
    ]);
    expect(screen.getAllByText('no casada · el set no está en el catálogo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('no casada · varias cartas candidatas').length).toBeGreaterThan(0);
    // Aunque un no-casado trajera imageUrl, no hay carta elegida ⇒ no se pinta.
    expect(imgSrcs()).toEqual([]);
  });

  it('sin portada (null) vs backend anterior (campo ausente)', async () => {
    await runWith([
      deck({ cover: null }),
      deck({ archetypeId: 'charizard-ex', name: 'Charizard ex' }), // sin `cover`: backend previo a la rev
    ]);
    // Solo el deck con `cover:null` dice «sin portada» (tabla + bloque móvil = 2).
    expect(screen.getAllByText('sin portada')).toHaveLength(2);
    expect(imgSrcs()).toEqual([]);
  });

  it('en EN la columna y los estados tienen texto (paridad)', async () => {
    await runWith(
      [deck({ cover: { setCode: 'MEG', number: '56', matchStatus: 'unmatched_set', cardId: null, imageUrl: null } })],
      'en',
    );
    expect(screen.getAllByText('Cover').length).toBeGreaterThan(0);
    expect(screen.getAllByText('not matched · set not in catalog').length).toBeGreaterThan(0);
  });

  it('en EN el estado «rechazada» también tiene texto (paridad)', async () => {
    await runWith(
      [deck({ cover: { setCode: 'TWM', number: '130', matchStatus: 'matched', cardId: 'c1', imageUrl: LIMITLESS_IMG } })],
      'en',
    );
    expect(screen.getAllByText(/image rejected \(not from our catalog\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no image in the catalog/)).toBeNull();
    expect(imgSrcs()).toEqual([]);
  });
});
