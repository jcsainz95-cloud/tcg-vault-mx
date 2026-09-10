import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import * as api from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  CatalogSyncStatusResponse,
  RefreshVariantsResponse,
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

/** Dispara la acción de fila («Sincronizar este set») del set de la fixture. */
async function repairSurgingSparks() {
  const [btn] = await screen.findAllByRole('button', { name: /Sincronizar Surging Sparks/ });
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

/* ══════════════════ SUPERFICIE 1 · la acción de fila (§32.5c — aquí se corrige D2) ══════════════ */

describe('§32.5c · «Sincronizar este set» — la superficie que quemó al dueño', () => {
  /**
   * ⭐⭐ **CS-1, el encargo entero en un test.** Un set que no resuelve en TCGCSV devuelve
   * `pricesUpserted: 0` y `cardProductsUpserted: 0`. Antes eso salía **verde** con
   * «191 cartas procesadas · 0 precios». Ahora: versalita `NO SE HIZO`, tono `warning`, **cero
   * cifras de contexto**, y la frase dice **la causa** y **la consecuencia**.
   */
  it('⭐⭐ CS-1: 0 precios y 0 variantes ⇒ NO SE HIZO, en warning, sin cifras y con la consecuencia', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue({
      ...REFRESH_OK,
      cardsProcessed: 0,
      cardProductsUpserted: 0,
      pricesUpserted: 0,
    });
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/NO SE HIZO/i);
    // (a) La palabra se lee antes que el color, y el color NO es verde.
    expectWarning(notice);
    // (b) La causa y la consecuencia, que es la pregunta real del dueño: «¿lo dejé peor?».
    expect(notice.textContent).toMatch(/no se escribió ningún precio ni ninguna variante/i);
    expect(notice.textContent).toMatch(/TCGCSV/);
    expect(notice.textContent).toMatch(/precios siguen como estaban/i);
    // (c) ⛔ CERO cifras de contexto: el «191» es exactamente el número que produjo la quemada.
    expect(notice.textContent).not.toMatch(/191/);
    // (d) H8: «procesadas» queda PROHIBIDA en un aviso de resultado.
    expect(notice.textContent).not.toMatch(/procesad/i);
  });

  /**
   * Control positivo — el candado tiene que poder decir que sí. Con escritura real, verde.
   * Sin este caso, «nunca pintes verde» se podría cumplir cableando el warning a la fuerza.
   */
  it('H1 (control positivo): con escritura real SÍ hay verde, y con su recibo al lado', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue(REFRESH_OK);
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/HECHO/i);
    expect(notice.className).toContain('border-success');
    // El verde deja de ser una respuesta y pasa a ser una respuesta CON RECIBO (§32.7.2).
    expect(notice.textContent).toMatch(/236 precios escritos/);
    expect(notice.textContent).toMatch(/240 variantes actualizadas/);
  });

  /** ⭐ CS-2 — una cifra ausente se pinta «—», nunca `0`, y degrada el veredicto (H4 + paso 2). */
  it('⭐ CS-2: `cardsProcessed: null` ⇒ «—» y PARCIAL (⛔ jamás un 0 en su lugar)', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue({ ...REFRESH_OK, cardsProcessed: null });
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/PARCIAL/i);
    expectWarning(notice);
    expect(notice.textContent).toMatch(/—/);
    expect(notice.textContent).toMatch(/no lo pudo medir/i);
    // Lo que SÍ se midió se sigue diciendo: «no lo sé» no borra lo que sí se contó.
    expect(notice.textContent).toMatch(/236 precios escritos/);
  });

  /**
   * ⭐ CS-3 / regla dura 4 — **una fase que no depende de la fuente caída NO se cancela porque la
   * otra falle**. Si la fuente de catálogo no responde, los precios se actualizan igual, la
   * segunda fase SE LLAMA, y el aviso nombra lo que faltó (H9).
   */
  it('⭐ CS-3: si la fase 1 falla, la fase 2 corre igual y el aviso nombra lo que faltó', async () => {
    vi.spyOn(api, 'syncCatalog').mockRejectedValue(
      new ApiClientError(502, { code: 'UPSTREAM_ERROR', message: 'pokemontcg.io no respondió' }),
    );
    const refresh = vi.spyOn(api, 'refreshVariants').mockResolvedValue(REFRESH_OK);
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/PARCIAL/i);
    expectWarning(notice);
    expect(refresh).toHaveBeenCalledWith({ setId: 'sv08' });
    expect(notice.textContent).toMatch(/no se pudieron traer/i);
    expect(notice.textContent).toMatch(/236 precios escritos/);
  });

  /** §32.5c — las dos fuentes caídas: no corrió nada ⇒ FALLÓ, y con `role="alert"` (§32.10). */
  it('las dos fuentes caídas ⇒ FALLÓ, interrumpe (role=alert) y dice que nada se tocó', async () => {
    vi.spyOn(api, 'syncCatalog').mockRejectedValue(new ApiClientError(502, { code: 'UPSTREAM_ERROR', message: 'x' }));
    vi.spyOn(api, 'refreshVariants').mockRejectedValue(new ApiClientError(502, { code: 'UPSTREAM_ERROR', message: 'x' }));
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/FALLÓ/i);
    expect(notice.getAttribute('role')).toBe('alert');
    expectNotGreen(notice);
    expect(notice.textContent).toMatch(/no se importó ninguna carta y no se tocó ningún precio/i);
  });

  /** `pending > 0` es trabajo que quedó sin hacer ⇒ PARCIAL, aunque se hayan escrito precios. */
  it('§32.5c: `pending > 0` ⇒ PARCIAL y la cola de pendientes se nombra', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue({ ...REFRESH_OK, pending: 4 });
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/PARCIAL/i);
    expectWarning(notice);
    expect(notice.textContent).toMatch(/4 variantes quedaron sin precio/i);
  });

  /**
   * §32.4c — ⛔ **identificadores técnicos fuera de la frase del dueño**. La acción de fila
   * llamaba a `catalog.syncDone`, que pintaba «Sync encolado: 0 set(s) (job catalog-sync-…)»:
   * un `jobId` crudo, un sustantivo falso («encolado» sobre un endpoint síncrono) y una cifra
   * que era `setsWritten`. Nada de eso puede volver.
   */
  it('§32.4c: ni «encolado», ni `jobId`, ni «procesadas» en la frase de la fila', async () => {
    vi.spyOn(api, 'refreshVariants').mockResolvedValue(REFRESH_OK);
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();

    const notice = await findNotice(/HECHO/i);
    expect(notice.textContent).not.toMatch(/encolad/i);
    expect(notice.textContent).not.toMatch(/job [a-z-]*\d/i);
    expect(notice.textContent).not.toMatch(/procesad/i);
  });

  /**
   * §32.1 — la fila NO importada es lo que reemplazó al `backfill` a ciegas: se señala en la
   * tabla y se trae desde ahí. Su botón NO puede estar deshabilitado.
   */
  it('§32.1: el botón de la fila también está disponible en un set NO importado', async () => {
    renderWithProviders(<Harness />, 'es');
    const [btn] = await screen.findAllByRole('button', { name: /Sincronizar Temporal Forces/ });
    expect(btn).not.toBeDisabled();
  });
});

/* ══════════════════ SUPERFICIE 2 · «Importar sets nuevos» (§32.5a) ══════════════════ */

describe('§32.5a · «Importar sets nuevos» — la acción de rutina', () => {
  /** ⭐ CS-4 — el cero DEMOSTRABLE: `SIN CAMBIOS`, tono neutro, y la frase nombra el corte. */
  it('⭐ CS-4: sin nada nuevo ⇒ SIN CAMBIOS (neutro, NO verde) y la frase nombra la fecha de corte', async () => {
    vi.spyOn(api, 'syncAllCatalog').mockResolvedValue({
      jobId: 'catalog-sync-all-1',
      setsQueued: 0,
      remaining: 0,
      fromReleaseDate: '2024/01/01',
      setsSkippedOutOfRange: 3,
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
    expect((await screen.findAllByRole('button', { name: /Sincronizar Surging Sparks/ })).length).toBeGreaterThan(0);
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
    vi.spyOn(api, 'refreshVariants').mockResolvedValue(REFRESH_OK);
    renderWithProviders(<Harness />, 'es');
    await repairSurgingSparks();
    await findNotice(/HECHO/i);

    for (const n of notices()) {
      expect(n.textContent).not.toMatch(/procesad/i);
      expect(n.textContent).not.toMatch(/catalog-sync-\d/);
    }
  });
});
