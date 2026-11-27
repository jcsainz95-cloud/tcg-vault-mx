import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import * as linkRepair from '@/lib/api/catalog-link-repair';
import type { LinkRepairResult } from '@/lib/api/catalog-link-repair';
import type {
  CatalogSyncStatusResponse,
  RefreshVariantsResponse,
  RemoteSetDTO,
  RemoteSetsResponse,
  RefreshVariantsStatusResponse,
} from '@/types/contract';
import { CatalogSyncSection } from './CatalogSyncSection';
import { useCatalogSync, FORCE_ALL_PENDING_KEY } from './useCatalogSync';

/**
 * ⭐⭐ **LOS CANDADOS DE `DESIGN_SYSTEM §32`** (las mutaciones CS-1…CS-10 de §32.13).
 *
 * El defecto que originó la sección: el dueño apretó el botón obvio, la pantalla le dijo
 * **«191 cartas procesadas · 0 precios» en verde**, y no se había escrito nada. Estos tests
 * existen para que ese aviso **no pueda volver a pintarse verde sin escritura** — en NINGUNA de
 * las tres superficies de M2 (la acción de fila, el barrido de rutina y el barrido forzado).
 *
 * ⚠ Cada `it` está escrito para poder **ponerse rojo**: se afirma lo que el dueño LEE (la
 * versalita, la frase, la ausencia de la cifra de contexto) y el TOKEN de color del aviso, no un
 * detalle interno. Un candado que sólo puede pasar no es un candado.
 */

/** Harness mínimo: la sección con su hook real, sin montar el resto de M2 (que cuesta ~600 ms). */
function Harness() {
  const catalog = useCatalogSync();
  return <CatalogSyncSection catalog={catalog} />;
}

/** Estado en reposo de los dos barridos: nada corriendo, nada medido. */
const IDLE_CATALOG: CatalogSyncStatusResponse = {
  running: false,
  jobId: null,
  total: 0,
  done: 0,
  startedAt: null,
  finishedAt: null,
  summary: null,
};
const IDLE_VARIANTS: RefreshVariantsStatusResponse = {
  running: false,
  jobId: null,
  total: 0,
  done: 0,
  startedAt: null,
  finishedAt: null,
  summary: null,
};

const REFRESH_OK: RefreshVariantsResponse = {
  ok: true,
  setId: 'sv08',
  cardsProcessed: 191,
  cardsInSet: 191,
  cardProductsUpserted: 240,
  pricesUpserted: 236,
  pending: 0,
  tcgcsvReachable: true,
};

/** Todos los avisos vivos de la pantalla (`role=status` / `role=alert`). */
function notices(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="status"],[role="alert"]'));
}

/** El aviso cuyo texto casa. Falla —con el DOM a la vista— si no hay ninguno. */
async function findNotice(re: RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const hit = notices().find((n) => re.test(n.textContent ?? ''));
    if (!hit) throw new Error(`ningún aviso casa con ${re}. Avisos: ${notices().map((n) => n.textContent).join(' | ')}`);
    return hit;
  });
}

/**
 * ⭐ **La aserción del encargo**: «este aviso NO está en verde». El token de éxito de `Banner` es
 * `border-success`; `warning` y `danger` comparten bermellón (`border-accent`) y se distinguen por
 * la palabra, que es justo por lo que el veredicto es una versalita y no un punto de color (§10).
 */
function expectNotGreen(notice: HTMLElement) {
  expect(notice.className).not.toContain('border-success');
}
function expectWarning(notice: HTMLElement) {
  expectNotGreen(notice);
  expect(notice.className).toContain('border-accent');
}

/** Dispara la acción de fila («Actualizar este set») del set de la fixture. */
async function repairSurgingSparks() {
  const [btn] = await screen.findAllByRole('button', { name: /Actualizar Surging Sparks/ });
  fireEvent.click(btn);
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  vi.spyOn(api, 'getSyncStatus').mockResolvedValue(IDLE_CATALOG);
  vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue(IDLE_VARIANTS);
});
afterEach(() => {
  window.localStorage.clear();
});

/* ══════════════════ SUPERFICIE 1 · la acción de fila (§AUTO-ENLACE 4b) ══════════════ */

const LINK_OK: LinkRepairResult = {
  linked: 12,
  priced: 30,
  groupUsed: { groupId: 77, name: 'SV08 Surging Sparks', via: 'auto' },
  reason: null,
  nextAttemptAt: null,
  reasons: [],
  piecesCorrected: 0,
  piecesExcluded: [],
};

function remoteSets(extra: Partial<RemoteSetDTO> = {}): RemoteSetsResponse {
  return {
    data: [
      { id: 'sv08', name: 'Surging Sparks', imported: true, cardCount: 191, localSetId: 'loc-sv08', ...extra },
      { id: 'sv05', name: 'Temporal Forces', imported: false, cardCount: 0, localSetId: null },
    ],
    degraded: false,
    source: 'remote',
  } as RemoteSetsResponse;
}

async function updateTemporalForces() {
  const [btn] = await screen.findAllByRole('button', { name: /Actualizar Temporal Forces/ });
  fireEvent.click(btn);
}

describe('§AUTO-ENLACE 4b · «Actualizar este set» = sync (si falta) → link-repair', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getRemoteSets').mockResolvedValue(remoteSets());
  });

  it('set ya importado: NO llama sync, llama link-repair con el UUID local y NO llama refresh-variants', async () => {
    const sync = vi.spyOn(api, 'syncCatalog');
    const refresh = vi.spyOn(api, 'refreshVariants');
    const repair = vi.spyOn(linkRepair, 'repairCatalogLinks').mockResolvedValue(LINK_OK);
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const res = (await screen.findAllByTestId('unlinked-result'))[0]!;
    expect(repair).toHaveBeenCalledWith('loc-sv08');
    expect(sync).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(res.textContent).toMatch(/Se ligaron 12 cartas/);
    expect(res.textContent).toMatch(/Se actualizaron 30 precios/);
    expect(res.textContent).toMatch(/Grupo de precios: SV08 Surging Sparks/);
    expect(res.textContent).not.toMatch(/Se importaron/);
  });

  it('set sin localSetId: sync primero, luego link-repair con el localSetId de la respuesta, y «Se importaron N»', async () => {
    const order: string[] = [];
    const sync = vi.spyOn(api, 'syncCatalog').mockImplementation(async () => {
      order.push('sync');
      return { jobId: 'j', cardsUpserted: 140, localSetId: 'loc-sv05' } as never;
    });
    const refresh = vi.spyOn(api, 'refreshVariants');
    const repair = vi.spyOn(linkRepair, 'repairCatalogLinks').mockImplementation(async () => {
      order.push('link-repair');
      return { ...LINK_OK, linked: 0, priced: 0, reason: 'group_none' };
    });
    renderWithProviders(<Harness />, 'es');
    await updateTemporalForces();

    const res = (await screen.findAllByTestId('unlinked-result'))[0]!;
    expect(sync).toHaveBeenCalledWith({ setId: 'sv05', force: true });
    expect(repair).toHaveBeenCalledWith('loc-sv05');
    expect(order).toEqual(['sync', 'link-repair']);
    expect(refresh).not.toHaveBeenCalled();
    expect(res.textContent).toMatch(/Se importaron 140 cartas/);
    expect(res.textContent).toMatch(/No se pudo ligar ninguna carta en Temporal Forces/);
  });

  it('⭐ si sync falla: muestra el error y NO llama link-repair', async () => {
    vi.spyOn(api, 'syncCatalog').mockRejectedValue(new ApiClientError(502, { code: 'UPSTREAM_ERROR', message: 'x' }));
    const repair = vi.spyOn(linkRepair, 'repairCatalogLinks').mockResolvedValue(LINK_OK);
    renderWithProviders(<Harness />, 'es');
    await updateTemporalForces();

    const err = (await screen.findAllByTestId('unlinked-error'))[0]!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(repair).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('unlinked-result')).toHaveLength(0);
  });

  it('sync sin localSetId (backend previo): avisa y NO inventa un id para link-repair', async () => {
    vi.spyOn(api, 'syncCatalog').mockResolvedValue({ jobId: 'j', cardsUpserted: 5 } as never);
    const repair = vi.spyOn(linkRepair, 'repairCatalogLinks').mockResolvedValue(LINK_OK);
    renderWithProviders(<Harness />, 'es');
    await updateTemporalForces();

    const res = (await screen.findAllByTestId('unlinked-result'))[0]!;
    expect(repair).not.toHaveBeenCalled();
    expect(res.textContent).toMatch(/Se importaron 5 cartas/);
    expect(res.textContent).toMatch(/Vuelve a pulsar/);
  });

  it('deshabilita el botón mientras corre', async () => {
    let release: (r: LinkRepairResult) => void = () => {};
    vi.spyOn(linkRepair, 'repairCatalogLinks').mockReturnValue(new Promise((r) => { release = r; }));
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    await waitFor(() => {
      const [btn] = screen.getAllByRole('button', { name: /Actualizar Surging Sparks/ });
      expect(btn).toBeDisabled();
    });
    release(LINK_OK);
    (await screen.findAllByTestId('unlinked-result'))[0]!;
  });

  it('muestra grupo y motivo por fila si vienen, y tolera su ausencia', async () => {
    vi.spyOn(api, 'getRemoteSets').mockResolvedValue(
      remoteSets({ groupUsed: { groupId: 1, name: 'SV08 Grupo', via: 'confirmed' }, reason: 'collisions' }),
    );
    renderWithProviders(<Harness />, 'es');
    const row = (await screen.findAllByTestId('set-group-sv08'))[0]!;
    expect(row.textContent).toMatch(/SV08 Grupo/);
    expect(row.textContent).toMatch(/Hay cartas con el mismo número|colision|número/i);
    expect(screen.queryAllByTestId('set-group-sv05')).toHaveLength(0);
  });

  it('§32.1: el botón de la fila también está disponible en un set NO importado', async () => {
    renderWithProviders(<Harness />, 'es');
    const [btn] = await screen.findAllByRole('button', { name: /Actualizar Temporal Forces/ });
    expect(btn).not.toBeDisabled();
  });
});

/* ══════════════════ SUPERFICIE 2 · «Importar sets nuevos» (§32.5a) ══════════════════ */

describe('§32.5a · «Importar sets nuevos» — la acción de rutina', () => {
  /**
   * ⭐⭐ **§M2-CS.4 — «no entra, pero SE CUENTA; nunca excluido en silencio».**
   *
   * El `202` trae TRES cifras de selección y la pantalla sólo sabía leer dos: `setsSkippedUnknownDate`
   * —los sets remotos **sin fecha de lanzamiento**— no tenía **ni una aparición** en `frontend/`
   * aunque el backend lo emite. El DTO era más honesto de lo que la pantalla podía ser, que es la
   * inversión exacta del principio.
   */
  it('⭐⭐ §M2-CS.4: la selección se PINTA entera — corte, fuera-de-corte y SIN FECHA', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-sel',
      setsQueued: 4,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 140,
      setsSkippedUnknownDate: 2,
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/sin fecha de lanzamiento/i);
    expect(notice.textContent).toMatch(/2024\/01\/01/);
    expect(notice.textContent).toMatch(/140 set\(s\) fuera del corte/);
    expect(notice.textContent).toMatch(/2 sin fecha de lanzamiento/);
    // H3 — son cifras de SELECCIÓN, no de escritura: jamás abren la frase. La versalita va primera.
    const text = (notice.textContent ?? '').trim();
    expect(text.indexOf('140')).toBeGreaterThan(text.indexOf('Selección de esta corrida'));
    expect(text.indexOf('Selección de esta corrida')).toBeGreaterThan(0);
  });

  /**
   * ⭐ **H4 sobre las tres cifras de selección**: un despliegue anterior a v1.66 no las manda.
   * Lo que no viaja se pinta **«—»**; ⛔ **jamás `0`** —un cero afirma que se contó y salió cero—
   * y ⛔ jamás omitido (omitir también miente: el lector asume que no aplicaba).
   */
  it('⭐ H4: si la cifra de sets SIN FECHA no viaja, se pinta «—» y NUNCA un 0', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-sel2',
      setsQueued: 4,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 140,
      // Despliegue viejo: el campo NO viaja. El tipo lo declara presente, la red no lo garantiza.
    } as unknown as import('@/types/contract').CatalogSyncAllResponse);
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/Selección de esta corrida/);
    expect(notice.textContent).toMatch(/— sin fecha de lanzamiento/);
    expect(notice.textContent).not.toMatch(/0 sin fecha de lanzamiento/);
  });

  /**
   * La fuente CANÓNICA de la selección es el `summary` (§M2-CS.1): el `202` la dice al arrancar,
   * el `summary` al terminar. Y sólo cuenta el `summary` del barrido que ESTA corrida lanzó.
   */
  it('§M2-CS.1: al terminar, la selección se lee del `summary` (misma corrida), no del eco', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-sel3',
      setsQueued: 4,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-sel3',
      total: 4,
      done: 4,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:04:00.000Z',
      summary: {
        setsTotal: 4, setsWritten: 3, setsImported: 2, setsRefreshed: 1, setsNoop: 1,
        setsFailed: 0, cardsUpserted: 431, failures: [],
        fromReleaseDate: '2023/06/06', setsSkippedOutOfRange: 7, setsSkippedUnknownDate: 5,
      },
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/Selección de esta corrida/);
    await waitFor(() => expect(notice.textContent).toMatch(/2023\/06\/06/));
    expect(notice.textContent).toMatch(/7 set\(s\) fuera del corte/);
    expect(notice.textContent).toMatch(/5 sin fecha de lanzamiento/);
  });

  /** ⭐ CS-4 — el cero DEMOSTRABLE: `SIN CAMBIOS`, tono neutro, y la frase nombra el corte. */
  it('⭐ CS-4: sin nada nuevo ⇒ SIN CAMBIOS (neutro, NO verde) y la frase nombra la fecha de corte', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-1',
      setsQueued: 0,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 3,
      setsSkippedUnknownDate: 0,
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/SIN CAMBIOS/i);
    expectNotGreen(notice);
    expect(notice.className).not.toContain('border-accent'); // neutro, no bermellón
    expect(notice.textContent).toMatch(/2024\/01\/01/);
  });

  /**
   * ⭐ **La tercera superficie.** `setsQueued: 0` carga TRES hechos distintos según el endpoint:
   * también significa «rechacé la corrida, ya había un barrido en curso». Reportar eso como
   * «el catálogo está al día» es afirmar lo que no se midió. Si el cero no se puede demostrar,
   * el veredicto honesto es `NO SE SABE`.
   */
  it('⭐ `setsQueued: 0` con sets pendientes ⇒ NO SE SABE, jamás «el catálogo está al día»', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-2',
      setsQueued: 0,
      remaining: 7,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/NO SE SABE/i);
    expectNotGreen(notice);
    expect(notice.textContent).toMatch(/—/);
    expect(notice.textContent).toMatch(/7/);
    expect(notice.textContent).not.toMatch(/al día/i);
  });

  /** §32.5a — barrido terminado con resumen: HECHO con las dos cifras de ESCRITURA. */
  it('barrido terminado con resumen ⇒ HECHO con sets escritos y cartas escritas', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-3',
      setsQueued: 4,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-3',
      total: 4,
      done: 4,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:04:00.000Z',
      summary: {
        setsTotal: 4,
        setsWritten: 3,
        setsImported: 2,
        setsRefreshed: 1,
        setsNoop: 1,
        setsFailed: 0,
        cardsUpserted: 431,
        fromReleaseDate: '2024/01/01',
        setsSkippedOutOfRange: 0,
        setsSkippedUnknownDate: 0,
        failures: [],
      },
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/HECHO/i);
    expect(notice.textContent).toMatch(/3 sets actualizados/);
    expect(notice.textContent).toMatch(/431 cartas escritas/);
    // ⛔ H3: el total encolado es CONTEXTO y sólo aparece detrás de «de», nunca abriendo la frase.
    expect(notice.textContent).not.toMatch(/^\s*HECHO\s*4/);
    // §M2-CS.1: este barrido NO escribe precios ⇒ el aviso NO puede prometerlos.
    expect(notice.textContent).not.toMatch(/precios/i);
  });

  /**
   * ⭐ El barrido escribió en CERO sets habiendo encolado trabajo ⇒ `NO SE HIZO`. Éste es D2 a
   * escala de barrido: antes, «terminó sin excepción» bastaba para el verde.
   */
  it('⭐ barrido que no escribió NADA habiendo encolado sets ⇒ NO SE HIZO, no verde', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-4',
      setsQueued: 12,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-4',
      total: 12,
      done: 12,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:04:00.000Z',
      summary: {
        setsTotal: 12,
        setsWritten: 0,
        setsImported: 0,
        setsRefreshed: 0,
        setsNoop: 12,
        setsFailed: 0,
        cardsUpserted: 0,
        fromReleaseDate: '2024/01/01',
        setsSkippedOutOfRange: 0,
        setsSkippedUnknownDate: 0,
        failures: [],
      },
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/NO SE HIZO/i);
    expectWarning(notice);
    expect(notice.textContent).toMatch(/no quedó/i);
  });

  /** ⭐ CS-6 — el proceso se reinició (DEV-1): `NO SE SABE` + «—» + «revisa la lista». */
  it('⭐ CS-6: barrido sin resumen (estado perdido) ⇒ NO SE SABE + «—», nunca HECHO', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-5',
      setsQueued: 4,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-5',
      total: 4,
      done: 4,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:04:00.000Z',
      summary: null,
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/NO SE SABE/i);
    expectNotGreen(notice);
    expect(notice.textContent).toMatch(/—/);
    expect(notice.textContent).toMatch(/revísala|revisa/i);
  });

  /** §32.5a — la fuente caída (404/405 incluidos) es FALLÓ, y dice qué NO se tocó. */
  it('la fuente de catálogo caída ⇒ FALLÓ, y aclara que los precios existentes no se tocaron', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockRejectedValue(
      new ApiClientError(404, { code: 'NOT_FOUND', message: 'no such endpoint' }),
    );
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Importar sets nuevos/ }));

    const notice = await findNotice(/FALLÓ/i);
    expectNotGreen(notice);
    expect(notice.textContent).toMatch(/no se trajo ningún set nuevo/i);
    expect(notice.textContent).toMatch(/no se tocaron/i);
  });
});

/* ══════════════════ SUPERFICIE 3 · «Sincronizar todo (forzar)» (§32.5b) ══════════════════ */

describe('§32.5b · «Sincronizar todo (forzar)» — dos fases, un veredicto', () => {
  async function confirmForceAll() {
    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar todo \(forzar\)/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, sincronizar todo/ }));
  }

  it('§32.7: pide confirmación, la confirmación explica las DOS fases, y llama con force=true', async () => {
    const spy = vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-6',
      setsQueued: 12,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    renderWithProviders(<Harness />, 'es');
    fireEvent.click(await screen.findByRole('button', { name: /Sincronizar todo \(forzar\)/ }));

    // El cuerpo del diálogo es donde vive la explicación que antes estaba en una `*Hint` muerta.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/dos fases/i);
    expect(dialog.textContent).toMatch(/No borra nada: reescribe/i);
    fireEvent.click(await screen.findByRole('button', { name: /Sí, sincronizar todo/ }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ force: true }));
  });

  /**
   * ⭐⭐ **La segunda superficie del techlead.** Un barrido de variantes con `setsWritten: 0`,
   * `setsNoop: 37`, `setsFailed: 0` **no escribió nada** — pero `setsOk` (deprecado, §M2-CS.2)
   * vale 37 y antes se pintaba «35/37 sets refrescados» **en verde**. ⛔ Ningún consumidor puede
   * usar `setsOk` para un veredicto.
   */
  it('⭐⭐ `setsNoop` no cuenta como bueno: 0 escrituras ⇒ NO SE HIZO (⛔ ni verde ni «37/37»)', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-7',
      setsQueued: 37,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'refreshVariantsAll').mockResolvedValue({ jobId: 'rv-7', setsQueued: 37, remaining: 0 });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-7',
      total: 37,
      done: 37,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:02:00.000Z',
      summary: {
        setsTotal: 37, setsWritten: 5, setsImported: 0, setsRefreshed: 5, setsNoop: 32,
        setsFailed: 0, cardsUpserted: 120, failures: [],
        fromReleaseDate: '2024/01/01', setsSkippedOutOfRange: 0, setsSkippedUnknownDate: 0,
      },
    });
    vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue({
      running: false,
      jobId: 'rv-7',
      total: 37,
      done: 37,
      startedAt: '2026-09-10T18:02:00.000Z',
      finishedAt: '2026-09-10T18:06:00.000Z',
      summary: {
        setsTotal: 37,
        setsWritten: 0,
        setsNoop: 37,
        setsOk: 37, // ⛔ deprecado: «no reventó» ≠ «salió bien»
        setsFailed: 0,
        cardProductsUpserted: 0,
        pricesUpserted: 0,
        pending: 0,
        failures: [],
      },
    });
    renderWithProviders(<Harness />, 'es');
    await confirmForceAll();

    const notice = await findNotice(/NO SE HIZO/i);
    expectWarning(notice);
    expect(notice.textContent).toMatch(/no se escribió ni un precio ni una variante/i);
    expect(notice.textContent).toMatch(/Todo quedó como estaba/i);
    // ⛔ La cifra que mentía no se pinta en ninguna forma.
    expect(notice.textContent).not.toMatch(/37\/37/);
    expect(notice.textContent).not.toMatch(/refrescados/i);
  });

  /**
   * Control positivo de la acción 2 — y de paso, **el candado de la cifra**: la carta escrita
   * viene de `cardsUpserted` de la fase 1, ⛔ **jamás de `setsOk`** (que es «sets que no
   * reventaron»). Con cifras deliberadamente distintas (900 cartas vs 37 sets), un aviso que
   * volviera a leer `setsOk` pintaría «37» y este test caería.
   */
  it('las dos fases con escritura real ⇒ HECHO, y la cifra de cartas sale de lo ESCRITO', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-11',
      setsQueued: 37,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'refreshVariantsAll').mockResolvedValue({ jobId: 'rv-11', setsQueued: 37, remaining: 0 });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-11',
      total: 37,
      done: 37,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:02:00.000Z',
      summary: {
        setsTotal: 37, setsWritten: 37, setsImported: 4, setsRefreshed: 33, setsNoop: 0,
        setsFailed: 0, cardsUpserted: 900, failures: [],
        fromReleaseDate: '2024/01/01', setsSkippedOutOfRange: 0, setsSkippedUnknownDate: 0,
      },
    });
    vi.spyOn(api, 'getRefreshVariantsStatus').mockResolvedValue({
      running: false,
      jobId: 'rv-11',
      total: 37,
      done: 37,
      startedAt: '2026-09-10T18:02:00.000Z',
      finishedAt: '2026-09-10T18:06:00.000Z',
      summary: {
        setsTotal: 37, setsWritten: 37, setsNoop: 0, setsOk: 37, setsFailed: 0,
        cardProductsUpserted: 4200, pricesUpserted: 4100, pending: 0, failures: [],
      },
    });
    renderWithProviders(<Harness />, 'es');
    await confirmForceAll();

    const notice = await findNotice(/HECHO/i);
    expect(notice.className).toContain('border-success');
    expect(notice.textContent).toMatch(/4100 precios escritos/);
    expect(notice.textContent).toMatch(/900 cartas escritas/);
    // ⛔ El «cuántos toqué» NO es `setsOk`: si la cifra de cartas fuera 37, sería `setsOk`.
    expect(notice.textContent).not.toMatch(/37 cartas/);
  });

  /** La fase 2 arranca SOLA cuando la fase 1 reporta `running:false` con la pantalla abierta. */
  it('§32.5b: la fase 2 (`refresh-variants-all`) arranca sola al terminar la fase 1', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-8',
      setsQueued: 12,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 0,
      setsSkippedUnknownDate: 0,
    });
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-8',
      total: 12,
      done: 12,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:02:00.000Z',
      summary: {
        setsTotal: 12, setsWritten: 12, setsImported: 3, setsRefreshed: 9, setsNoop: 0,
        setsFailed: 0, cardsUpserted: 900, failures: [],
        fromReleaseDate: '2024/01/01', setsSkippedOutOfRange: 0, setsSkippedUnknownDate: 0,
      },
    });
    const phase2 = vi
      .spyOn(api, 'refreshVariantsAll')
      .mockResolvedValue({ jobId: 'rv-8', setsQueued: 12, remaining: 0 });
    renderWithProviders(<Harness />, 'es');
    await confirmForceAll();

    await waitFor(() => expect(phase2).toHaveBeenCalled());
  });

  /**
   * ⭐ CS-5 — la fase 1 terminó, la pestaña se cerró y la 2 nunca corrió. Al volver, el aviso lo
   * DICE (versalita propia) y ofrece la palanca. **Un verde aquí sería la mentira original.**
   */
  it('⭐ CS-5: si la segunda mitad no corrió, se dice y se ofrece terminarla (⛔ nunca verde)', async () => {
    window.localStorage.setItem(FORCE_ALL_PENDING_KEY, 'catalog-sync-all-9');
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      running: false,
      jobId: 'catalog-sync-all-9',
      total: 12,
      done: 12,
      startedAt: '2026-09-10T18:00:00.000Z',
      finishedAt: '2026-09-10T18:02:00.000Z',
      summary: {
        setsTotal: 12, setsWritten: 12, setsImported: 3, setsRefreshed: 9, setsNoop: 0,
        setsFailed: 0, cardsUpserted: 900, failures: [],
        fromReleaseDate: '2024/01/01', setsSkippedOutOfRange: 0, setsSkippedUnknownDate: 0,
      },
    });
    const phase2 = vi
      .spyOn(api, 'refreshVariantsAll')
      .mockResolvedValue({ jobId: 'rv-9', setsQueued: 12, remaining: 0 });
    renderWithProviders(<Harness />, 'es');

    const notice = await findNotice(/FALTA LA SEGUNDA MITAD/i);
    expectWarning(notice);
    expect(notice.textContent).toMatch(/los precios no se actualizaron/i);
    fireEvent.click(await screen.findByRole('button', { name: /Terminar la segunda mitad/ }));
    await waitFor(() => expect(phase2).toHaveBeenCalled());
  });

  /** ⭐ CS-6 — reinicio del proceso a mitad: el `jobId` anotado ya no existe ⇒ NO SE SABE. */
  it('⭐ CS-6: con el estado perdido tras un reinicio ⇒ NO SE SABE + «—»', async () => {
    window.localStorage.setItem(FORCE_ALL_PENDING_KEY, 'catalog-sync-all-10');
    // El backend se reinició: su estado en memoria ya no conoce ese barrido.
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(IDLE_CATALOG);
    renderWithProviders(<Harness />, 'es');

    const notice = await findNotice(/NO SE SABE/i);
    expectNotGreen(notice);
    expect(notice.textContent).toMatch(/—/);
  });
});

/* ══════════════════ NORMAS TRANSVERSALES DE LA SECCIÓN ══════════════════ */

describe('§32.2 / §32.10 · la forma de la sección', () => {
  /** ⭐ CS-7 — las TRES acciones se alcanzan sin abrir ningún menú. ⛔ Ningún overflow. */
  it('⭐ CS-7: las tres acciones se ven, y NINGUNA vive en un menú ⋯', async () => {
    renderWithProviders(<Harness />, 'es');
    expect(await screen.findByRole('button', { name: /Importar sets nuevos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sincronizar todo \(forzar\)/ })).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /Actualizar Surging Sparks/ })).length).toBeGreaterThan(0);
    // ⛔ §32.12.2: nada de menús kebab en ESTA tabla.
    expect(document.querySelector('[aria-haspopup="menu"]')).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  /**
   * §32.6 — lo que decían las cinco `*Hint` muertas vive ahora en **superficie permanente**: un
   * subtítulo bajo cada botón global. ⛔ Un `title`/tooltip **no cuenta como mostrado**.
   */
  it('§32.6: cada botón global lleva su subtítulo PERMANENTE (no un `title`)', async () => {
    renderWithProviders(<Harness />, 'es');
    const importBtn = await screen.findByRole('button', { name: /Importar sets nuevos/ });
    expect(importBtn).not.toHaveAttribute('title');
    expect(screen.getByText(/Cuenta como nuevo todo lo lanzado/)).toBeInTheDocument();
    expect(screen.getByText(/Dos fases: primero cartas e imágenes/)).toBeInTheDocument();
  });

  /**
   * §32.3 + H4 — el corte todavía no se puede leer ANTES de apretar (`remote-sets.catalogWindow`
   * no existe aún). Se dice que no se pudo leer; ⛔ no se inventa una fecha por defecto, y ⛔ no
   * se enlaza a M10, cuyo dial el contrato ya derogó (§M2-CS.4).
   */
  it('§32.3: sin dato de corte se pinta «—» y NO se enlaza a un dial derogado', async () => {
    renderWithProviders(<Harness />, 'es');
    expect(await screen.findByText(/no se puede leer antes de lanzar: —/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Cambiar la fecha/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/2024\/01\/01/);
  });

  /** §32.2 — los dos botones globales son `secondary`: el `primary` del panel sigue siendo único. */
  it('§32.2: ninguno de los dos botones globales es el primario del panel', async () => {
    renderWithProviders(<Harness />, 'es');
    const importBtn = await screen.findByRole('button', { name: /Importar sets nuevos/ });
    const forceBtn = screen.getByRole('button', { name: /Sincronizar todo \(forzar\)/ });
    expect(importBtn.className).not.toContain('bg-accent');
    expect(forceBtn.className).not.toContain('bg-accent');
  });

  /** ⭐ CS-10 — barrido sobre TODOS los avisos de la sección: ni «procesad*», ni ids crudos. */
  it('⭐ CS-10: ningún aviso de la sección dice «procesad*» ni enseña un id crudo', async () => {
    vi.spyOn(api, 'getRemoteSets').mockResolvedValue(remoteSets());
    vi.spyOn(linkRepair, 'repairCatalogLinks').mockResolvedValue(LINK_OK);
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();
    (await screen.findAllByTestId('unlinked-result'))[0]!;

    for (const n of notices()) {
      expect(n.textContent).not.toMatch(/procesad/i);
      expect(n.textContent).not.toMatch(/catalog-sync-\d/);
    }
  });
});
