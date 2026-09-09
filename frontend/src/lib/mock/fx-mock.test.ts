import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMockFxState,
  mockFx,
  mockFxWorld,
  setMockFxWorld,
  setMockFxRefreshPlan,
  MOCK_FX_HARD_FALLBACK_RATE,
  type MockFxWorld,
} from './fixtures';
import { getFx, updateFx, refreshFx, setFxMode } from '@/lib/api';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ **UN MOCK QUE SIEMPRE DICE `banxico` Y SIEMPRE TRIUNFA NO PUEDE PROBAR NADA**
 *
 * Antes de este pase, el servidor falso de FX:
 *   - devolvía `source: 'banxico'` **siempre** en el refresco, y `'manual'` en cuanto se guardaba
 *     un número (la inferencia por VALOR que §M2-F.1 deroga);
 *   - no tenía forma de devolver `source: 'fallback'`, que el servidor **ya emite**;
 *   - no tenía bloque `refresh`, así que el desenlace del fetch **no existía** en el simulador.
 *
 * Resultado: las dos ramas que QA bloqueó (`fallback` y `failed`) eran **inalcanzables desde el
 * navegador y desde los tests**. Es la misma familia del hallazgo del buscador de bounties —
 * *«un mock puede ser más POBRE que el servidor; nunca más permisivo ni distinto»*— entrando por
 * la puerta del dinero.
 *
 * Este archivo fija que el simulador **puede llegar a los estados malos**.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const AUTO_WITH_BANXICO: MockFxWorld = {
  mode: 'auto',
  modeResolvedFrom: 'setting',
  bufferPct: 3,
  manualRate: null,
  automaticRate: 18.2,
  automaticEffectiveDate: '2026-09-08',
  automaticAgeDays: 1,
  automaticStatus: 'fresh',
};

/** Tabla `FxRate` vacía + modo `auto` + sin tasa manual — el fixture de FX-7. */
const AUTO_WITHOUT_ANY_RATE: MockFxWorld = {
  ...AUTO_WITH_BANXICO,
  automaticRate: null,
  automaticEffectiveDate: null,
  automaticAgeDays: null,
  automaticStatus: 'missing',
};

const PRISTINE = { ...mockFxWorld };

beforeEach(() => {
  setMockFxWorld({ ...PRISTINE });
  setMockFxRefreshPlan({ outcome: 'failed', reason: 'no_token' });
});

describe('mock de FX · puede llegar a `source: "fallback"` (B-1, candado FX-7)', () => {
  it('sin fila de Banxico y sin tasa manual, el simulador cotiza con el 18 de código', async () => {
    setMockFxWorld(AUTO_WITHOUT_ANY_RATE);
    const dto = await getFx();

    expect(dto.source).toBe('fallback');
    expect(dto.rate).toBe(MOCK_FX_HARD_FALLBACK_RATE);
    // ⛔ Y NO se disfraza de «la de Banxico»: nunca llegó ninguna (§M2-F.3 regla 5).
    expect(dto.automatic.rate).toBeNull();
    expect(dto.automatic.status).toBe('missing');
    expect(dto.manual.applied).toBe(false);
  });

  it('el MODO decide, no el valor: las tres resoluciones de §M2-F.1', () => {
    expect(buildMockFxState({ ...AUTO_WITH_BANXICO, manualRate: 19 }).source).toBe('banxico');
    expect(buildMockFxState({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: 19 }).source).toBe('manual');
    expect(buildMockFxState({ ...AUTO_WITHOUT_ANY_RATE, mode: 'manual', manualRate: null }).source).toBe('fallback');
  });

  it('las DOS tasas viajan siempre, rija la que rija (§M2-F.3 regla 1, candado FX-9)', () => {
    const manual = buildMockFxState({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: 19 });
    expect(manual.rate).toBe(19);
    expect(manual.automatic.rate).toBe(18.2);

    const auto = buildMockFxState({ ...AUTO_WITH_BANXICO, manualRate: 19 });
    expect(auto.rate).toBe(18.2);
    expect(auto.manual.rate).toBe(19);
  });

  it('⭐ guardar una tasa NO enciende el manual (I-FX2 · candado FX-2)', async () => {
    setMockFxWorld(AUTO_WITH_BANXICO);
    const dto = await updateFx({ rate: 25 });

    // El número se GUARDA…
    expect(dto.manual.rate).toBe(25);
    // …y ⛔ no rige, ni cambia el modo, ni reprecia el catálogo.
    expect(dto.mode).toBe('auto');
    expect(dto.rate).toBe(18.2);
    expect(dto.source).toBe('banxico');
    expect(dto.manual.applied).toBe(false);
  });
});

describe('mock de FX · puede devolver los TRES desenlaces del refresco (B-2, candado FX-8)', () => {
  it('`failed` no toca el estado y trae motivo, sin cifra traída', async () => {
    setMockFxWorld(AUTO_WITH_BANXICO);
    setMockFxRefreshPlan({ outcome: 'failed', reason: 'no_token' });
    const dto = await refreshFx();

    expect(dto.refresh.outcome).toBe('failed');
    expect(dto.refresh.reason).toBe('no_token');
    expect(dto.refresh.fetchedRate).toBeNull();
    // El fetch no ocurrió ⇒ la tasa de Banxico sigue siendo la de antes.
    expect(dto.automatic.rate).toBe(18.2);
    expect(mockFx.automatic.effectiveDate).toBe('2026-09-08');
  });

  it('`updated` escribe la fila nueva y la deja fresca', async () => {
    setMockFxWorld(AUTO_WITH_BANXICO);
    setMockFxRefreshPlan({ outcome: 'updated', fetchedRate: 18.6312 });
    const dto = await refreshFx();

    expect(dto.refresh.outcome).toBe('updated');
    expect(dto.refresh.fetchedRate).toBe(18.6312);
    expect(dto.automatic.rate).toBe(18.6312);
    expect(dto.automatic.status).toBe('fresh');
    expect(dto.rate).toBe(18.6312);
  });

  it('`unchanged` es un éxito que no mueve nada, y ⛔ no lleva motivo', async () => {
    setMockFxWorld(AUTO_WITH_BANXICO);
    setMockFxRefreshPlan({ outcome: 'unchanged', fetchedRate: 18.2 });
    const dto = await refreshFx();

    expect(dto.refresh.outcome).toBe('unchanged');
    expect(dto.refresh.reason).toBeNull();
    expect(dto.rate).toBe(18.2);
  });

  it('⭐ el refresco corre en modo `manual` y NO cambia cuál rige (§M2-F.5)', async () => {
    setMockFxWorld({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: 19 });
    setMockFxRefreshPlan({ outcome: 'updated', fetchedRate: 18.6312 });
    const dto = await refreshFx();

    // Actualiza la cifra de COMPARACIÓN…
    expect(dto.automatic.rate).toBe(18.6312);
    // …y la que rige sigue siendo la del dueño.
    expect(dto.rate).toBe(19);
    expect(dto.mode).toBe('manual');
    expect(dto.source).toBe('manual');
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * v1.63.3 — LA REGLA MECÁNICA DE `applied`, Y EL INTERRUPTOR
 *
 * El contrato **redefinió `applied`**: se deriva de **`source`**, no del `mode`. La regla, en una
 * línea: *«exactamente una de las dos `applied` es `true` ⟺ `source` la nombra; con
 * `source: "fallback"` las DOS son `false`»*. Un simulador que la viole enseña a la pantalla a
 * derivar `applied` del modo — que es justo lo que §30.3a prohíbe.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('mock de FX · `applied` se deriva de `source` (v1.63.3)', () => {
  const WORLDS: MockFxWorld[] = [
    AUTO_WITH_BANXICO,
    AUTO_WITHOUT_ANY_RATE,
    { ...AUTO_WITH_BANXICO, manualRate: 19 },
    { ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: 19 },
    { ...AUTO_WITHOUT_ANY_RATE, mode: 'manual', manualRate: 19 },
    // ⚠️ El estado ILEGAL de la 4ª fila de §M2-F.1 («manual sin número»), alcanzable sólo por SQL.
    { ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: null },
    { ...AUTO_WITHOUT_ANY_RATE, mode: 'manual', manualRate: null },
  ];

  it('⭐ en TODOS los mundos: `source` nombra a la rama aplicada, y `fallback` no nombra a ninguna', () => {
    for (const world of WORLDS) {
      const dto = buildMockFxState(world);
      expect(dto.manual.applied, JSON.stringify(world)).toBe(dto.source === 'manual');
      expect(dto.automatic.applied, JSON.stringify(world)).toBe(dto.source === 'banxico');
      if (dto.source === 'fallback') {
        expect(dto.manual.applied).toBe(false);
        expect(dto.automatic.applied).toBe(false);
      }
      // Nunca las dos a la vez: sólo una tasa rige.
      expect(dto.manual.applied && dto.automatic.applied).toBe(false);
    }
  });

  it('⭐ `mode: "manual"` con `manual.applied: false` ES alcanzable, y es lo que el front debe obedecer', () => {
    const dto = buildMockFxState({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: null });
    expect(dto.mode).toBe('manual');
    expect(dto.manual.applied).toBe(false);
  });
});

describe('mock de FX · el interruptor `PUT /admin/fx/mode` (§M2-F.2)', () => {
  it('⭐ alterna N veces SIN volver a teclear el número, y ⛔ nunca lo borra (I-FX1 · I-FX3)', async () => {
    setMockFxWorld({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: 19 });

    for (let i = 0; i < 3; i++) {
      const toAuto = await setFxMode({ mode: 'auto' });
      expect(toAuto.rate).toBe(18.2);
      expect(toAuto.source).toBe('banxico');
      expect(toAuto.manual.rate).toBe(19);

      const toManual = await setFxMode({ mode: 'manual' });
      expect(toManual.rate).toBe(19);
      expect(toManual.source).toBe('manual');
    }
  });

  it('materializa el modo: `modeResolvedFrom` pasa de `legacy` a `setting`', async () => {
    setMockFxWorld({ ...AUTO_WITH_BANXICO, modeResolvedFrom: 'legacy', mode: 'manual', manualRate: 19 });
    const dto = await setFxMode({ mode: 'auto' });
    expect(dto.modeResolvedFrom).toBe('setting');
  });

  it('pedir `manual` sin número guardado ⇒ `422 FX_MANUAL_RATE_MISSING`, y el modo NO cambia (I-FX4)', async () => {
    setMockFxWorld(AUTO_WITH_BANXICO);
    await expect(setFxMode({ mode: 'manual' })).rejects.toMatchObject({
      status: 422,
      code: 'FX_MANUAL_RATE_MISSING',
    });
    expect(mockFx.mode).toBe('auto');
  });

  it('⭐ pasar a `auto` SIN tasa de Banxico exige el acuse, y trae el número al que se saltaría', async () => {
    setMockFxWorld({ ...AUTO_WITHOUT_ANY_RATE, mode: 'manual', manualRate: 19 });

    await expect(setFxMode({ mode: 'auto' })).rejects.toMatchObject({
      status: 422,
      code: 'FX_NO_AUTOMATIC_RATE',
      details: { currentRate: 19, fallbackRate: MOCK_FX_HARD_FALLBACK_RATE },
    });
    // ⛔ El modo NO cambió: la precondición contesta, no aplica a medias.
    expect(mockFx.mode).toBe('manual');
    expect(mockFx.rate).toBe(19);

    const acked = await setFxMode({ mode: 'auto', acknowledgeNoAutomaticRate: true });
    expect(acked.source).toBe('fallback');
    expect(acked.rate).toBe(MOCK_FX_HARD_FALLBACK_RATE);
    // El número del dueño sigue guardado, aunque ya no rija.
    expect(acked.manual.rate).toBe(19);
    expect(acked.manual.applied).toBe(false);
  });

  it('⛔ con `stale` NO se pide acuse: hay número real que el humano puede juzgar', async () => {
    setMockFxWorld({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: 19, automaticStatus: 'stale', automaticAgeDays: 40 });
    const dto = await setFxMode({ mode: 'auto' });
    expect(dto.source).toBe('banxico');
    expect(dto.rate).toBe(18.2);
  });
});

describe('mock de FX · la 4ª fila de §M2-F.1 (`FX-23`): «manual sin número» NO cae al 18', () => {
  it('⭐ con una fila de Banxico, rige ÉSA — y el `mode` sigue diciendo `manual` (no se repara)', () => {
    const dto = buildMockFxState({ ...AUTO_WITH_BANXICO, mode: 'manual', manualRate: null });

    expect(dto.rate).toBe(18.2);
    expect(dto.source).toBe('banxico');
    expect(dto.mode).toBe('manual');
    expect(dto.manual.rate).toBeNull();
    // ⛔ Rojo si `manual.applied` fuera `true` sobre un número que no existe (la mentira que
    // v1.63.3 borró), o si rigiera el literal que nadie tecleó.
    expect(dto.manual.applied).toBe(false);
    expect(dto.automatic.applied).toBe(true);
  });

  it('sin fila de Banxico, ahí SÍ manda el respaldo, y las DOS `applied` quedan en `false`', () => {
    const dto = buildMockFxState({ ...AUTO_WITHOUT_ANY_RATE, mode: 'manual', manualRate: null });

    expect(dto.rate).toBe(MOCK_FX_HARD_FALLBACK_RATE);
    expect(dto.source).toBe('fallback');
    expect(dto.manual.applied).toBe(false);
    expect(dto.automatic.applied).toBe(false);
  });
});
