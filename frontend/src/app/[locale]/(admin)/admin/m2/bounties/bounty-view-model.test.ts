import { describe, it, expect } from 'vitest';
import type { AdminBountyRowDTO, BountyState } from '@/types/contract';
import {
  BOUNTY_CHIP_ORDER,
  BOUNTY_SORTS,
  BOUNTY_STATES,
  blockOfState,
  bountyPremium,
  buildBountyControlsRequest,
  hasAttentionRows,
  isBountyDraftDirty,
  isKnownBountyState,
  raisesSpend,
  savedToastFor,
  withBlockHeaders,
  zeroStatement,
} from './bounty-view-model';

/**
 * # bounty-view-model.test.ts — la mitad de FRONTEND de la tabla `API_CONTRACT §M2-B.6`
 *
 * Aquí viven los candados que no necesitan DOM. El resto —los que sí lo necesitan— está en
 * `BountiesView.test.tsx`. Cada bloque cita **la fila de §M2-B.6** o **la regla de §28** que
 * pone en rojo, porque un candado que nadie sabe romper a propósito no vale.
 *
 * ⛔ Lo que estos tests **no** hacen, y es deliberado: no re-asertan ninguna regla de servidor.
 * La clasificación de los cinco estados (B-1, B-2, B-8), el conteo sobre el conjunto (B-9, B-10),
 * el techo (B-4) y la semántica de omisión del `PUT` («omitido conserva») **viven donde vive el
 * endpoint**; duplicarlas aquí crearía dos candados que se tapan entre sí (§M2-B.6, nota final).
 * Lo que sí se prueba aquí es lo que **esta pantalla** puede romper sola: pintar el estado que
 * llegó, no derivarlo, no inventar cifras y **no meter en el cuerpo del `PUT` lo que el humano no
 * editó**.
 */

const counts = (over: Partial<Record<BountyState, number>> = {}): Record<BountyState, number> => ({
  activa: 0,
  rebasada: 0,
  invalida: 0,
  completada: 0,
  apagada: 0,
  ...over,
});

function row(state: string): AdminBountyRowDTO {
  return {
    cardId: `c-${state}`,
    setId: 's1',
    setName: 'Obsidian Flames',
    name: 'Charizard ex',
    number: '125',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'HOLOFOIL',
    state: state as BountyState,
    progress: { targetQty: 2, acquiredQty: 0, remainingQty: 2 },
    updatedAt: '2026-09-01T12:00:00.000Z',
    pricing: {
      buy: { suggestedCents: null, overrideCents: null, effectiveCents: null, source: 'market', premiumAtFloor: false },
      sell: { suggestedCents: null, overrideCents: null, effectiveCents: null, source: 'market', premiumAtFloor: false },
      bounty: {
        enabled: true,
        priceCents: 90000,
        targetQty: 2,
        acquiredQty: 0,
        completedAt: null,
        effective: false,
        curveQuoteCents: 95000,
      },
    },
  };
}

describe('§M2-B.0 — el enum del contrato, con sus CINCO valores y sin vocabulario paralelo', () => {
  it('conoce exactamente los cinco `state` del contrato, y ninguno más', () => {
    expect([...BOUNTY_STATES].sort()).toEqual(
      ['activa', 'apagada', 'completada', 'invalida', 'rebasada'].sort(),
    );
    // ⛔ El vocabulario `outbid`/`active`/`off` NO existe en la API: traducir a rótulos es trabajo
    // de i18n, jamás un enum paralelo (§M2-B.7, petición 4).
    for (const alien of ['outbid', 'active', 'off', 'completed']) {
      expect(isKnownBountyState(alien)).toBe(false);
    }
  });

  it('los CINCO chips van en el orden de la ATENCIÓN, no en el del enum (§28.2a)', () => {
    expect(BOUNTY_CHIP_ORDER).toEqual(['rebasada', 'invalida', 'activa', 'completada', 'apagada']);
    // Ninguno se funde con otro: tantas cubetas como valores tiene el enum.
    expect(new Set(BOUNTY_CHIP_ORDER).size).toBe(BOUNTY_STATES.length);
  });

  it('solo ofrece los TRES `sort` del endpoint (§28.2a: ordenar en el cliente rompe el eje)', () => {
    expect(BOUNTY_SORTS).toEqual(['attention_first', 'price_desc', 'updated_desc']);
  });
});

describe('§28.2a — los bloques son una PARTICIÓN del orden del servidor, no un reordenamiento', () => {
  it('`rebasada` e `invalida` comparten bloque; `completada` y `apagada` NO', () => {
    expect(blockOfState('rebasada')).toBe('attention');
    expect(blockOfState('invalida')).toBe('attention');
    expect(blockOfState('activa')).toBe('activa');
    // ⛔ v3.4: fundirlos borraría el PORQUÉ dejó de pagarse, que es el dato que la pantalla existe
    // para no perder (§M2-B.0).
    expect(blockOfState('completada')).toBe('completada');
    expect(blockOfState('apagada')).toBe('apagada');
    expect(blockOfState('completada')).not.toBe(blockOfState('apagada'));
  });

  it('inserta el encabezado donde CAMBIA el bloque, recorriendo la lista tal como vino', () => {
    const rows = ['rebasada', 'invalida', 'activa', 'completada', 'apagada'].map(row);
    const marked = withBlockHeaders(rows, true);
    expect(marked.map((m) => m.startsBlock)).toEqual([
      'attention',
      null, // `invalida` NO abre bloque nuevo: comparte el de atención
      'activa',
      'completada',
      'apagada',
    ]);
    // El orden de las filas es el que llegó: la pantalla no reordena (§28.13 nº9).
    expect(marked.map((m) => m.row.state)).toEqual(rows.map((r) => r.state));
  });

  it('con un `sort` distinto de `attention_first` NO se pinta ningún encabezado', () => {
    const marked = withBlockHeaders(['rebasada', 'activa'].map(row), false);
    expect(marked.every((m) => m.startsBlock === null)).toBe(true);
  });

  it('un `state` desconocido no abre bloque y no rompe la partición', () => {
    const marked = withBlockHeaders(['rebasada', 'zombi', 'activa'].map(row), true);
    expect(marked.map((m) => m.startsBlock)).toEqual(['attention', null, 'activa']);
  });

  it('sabe si hay filas del bloque ① a la vista', () => {
    expect(hasAttentionRows(['activa', 'apagada'].map(row))).toBe(false);
    expect(hasAttentionRows(['activa', 'invalida'].map(row))).toBe(true);
  });
});

describe('§28.5 — el cero que se dice, y las DOS veces que no se dice', () => {
  it('el cero TRANQUILIZADOR exige rebasada 0 · invalida 0 · truncated false', () => {
    expect(zeroStatement(counts({ activa: 12 }), false)).toBe('outbid');
  });

  it('con `invalida > 0` es el cero ACOTADO: «todos los encendidos pagan» sería FALSO', () => {
    expect(zeroStatement(counts({ activa: 12, invalida: 1 }), false)).toBe('outbidButNoPrice');
  });

  it('⭐ con la lista cortada NO se enuncia ningún cero: un cero de una lista cortada no es un cero', () => {
    expect(zeroStatement(counts(), true)).toBeNull();
    expect(zeroStatement(counts({ invalida: 1 }), true)).toBeNull();
  });

  it('con rebasados no hay frase de cero, haya lo que haya en las otras cubetas', () => {
    expect(zeroStatement(counts({ rebasada: 3 }), false)).toBeNull();
  });
});

describe('§28.4 — el PREMIUM es una RESTA, jamás un veredicto', () => {
  it('resta las dos cifras que ya vinieron, con su porcentaje sobre la tarifa', () => {
    expect(bountyPremium('rebasada', 90000, 95000)).toEqual({
      kind: 'below',
      amountCents: 5000,
      pct: expect.closeTo(5.263, 2),
    });
    expect(bountyPremium('activa', 250000, 210000)).toMatchObject({ kind: 'above', amountCents: 40000 });
  });

  it('⭐ la fila `invalida` no inventa NINGUNA cifra: ni la tarifa, ni `0`, ni `−100%`', () => {
    const p = bountyPremium('invalida', null, 78000);
    expect(p).toEqual({ kind: 'noPrice' });
    expect(p).not.toHaveProperty('amountCents');
  });

  it('`curveQuoteCents === null` es SIN TARIFA (la curva no resuelve), no un rebasado', () => {
    expect(bountyPremium('activa', 90000, null)).toEqual({ kind: 'noRate' });
  });

  it('una fila que no paga (`completada`/`apagada`) no tiene premium que enseñar', () => {
    expect(bountyPremium('apagada', 60000, 64000)).toEqual({ kind: 'off' });
    expect(bountyPremium('completada', 120000, 105000)).toEqual({ kind: 'off' });
  });

  it('un `state` desconocido no afirma nada sobre su dinero', () => {
    expect(bountyPremium('zombi', 90000, 95000)).toEqual({ kind: 'unknown' });
  });
});

describe('§28.6d — el toast se elige por el `state` NUEVO, no por lo que se tecleó', () => {
  it('un guardado que no arregla nada NO puede decir «listo»', () => {
    expect(savedToastFor('rebasada', 'rebasada')).toBe('savedStillOutbid');
  });

  it('de rebasado/sin precio a activo se dice que ya paga por encima', () => {
    expect(savedToastFor('rebasada', 'activa')).toBe('savedNowActive');
    expect(savedToastFor('invalida', 'activa')).toBe('savedNowActive');
  });

  it('seguir encendido sin precio TIENE frase propia: si ocurre, hay que verlo', () => {
    expect(savedToastFor('activa', 'invalida')).toBe('savedStillNoPrice');
  });

  it('activo que sigue activo se guarda y ya; apagado/completado llevan el toast de apagado', () => {
    expect(savedToastFor('activa', 'activa')).toBe('saved');
    expect(savedToastFor('activa', 'apagada')).toBe('turnedOff');
    expect(savedToastFor('activa', 'completada')).toBe('turnedOff');
  });

  it('si la fila ya no está en la relectura se dice lo único que consta: que se guardó', () => {
    expect(savedToastFor('rebasada', null)).toBe('saved');
  });
});

/**
 * ⭐⭐ **B-11 de §M2-B.6** (§M2-B.3 · §28.6f · `ARCHITECTURE §0-B.3` regla 9, *la regla de la
 * omisión*). Es una aserción sobre **la PETICIÓN**, no sobre la respuesta.
 *
 * Por qué muerde: el reenvío «defensivo» convierte una edición **parcial** en una **sobrescritura
 * total** sobre un endpoint **sin token de concurrencia** que escriben **dos** superficies. Entre
 * el render de la lista y el `PUT` cabe un cambio hecho en el drawer del binder, y el reenvío lo
 * revertiría en silencio **sobre el precio publicado del storefront**.
 */
describe('B-11 ⭐ — qué viaja en el `PUT`, y sobre todo QUÉ NO', () => {
  const stored = { enabled: true, priceCents: 90000, targetQty: 2 };

  it('editar SOLO el precio no mete `sellOverrideCents` ni `buyOverrideCents` en el cuerpo', () => {
    const body = buildBountyControlsRequest(stored, { ...stored, priceCents: 100000 });
    expect(Object.keys(body).sort()).toEqual(['bounty', 'gradeKey', 'productType']);
    expect(body).not.toHaveProperty('sellOverrideCents');
    expect(body).not.toHaveProperty('buyOverrideCents');
    expect(body.bounty).toEqual({ enabled: true, priceCents: 100000 });
  });

  it('el objetivo que no se tocó NO viaja: campo omitido ⇒ no se toca (se cita, no se compensa)', () => {
    const body = buildBountyControlsRequest(stored, { ...stored, priceCents: 100000 });
    expect(body.bounty).not.toHaveProperty('targetQty');
  });

  it('⛔ jamás `targetQty: null`: borrar el objetivo se ataja en el formulario, no en el servidor', () => {
    const body = buildBountyControlsRequest(stored, { ...stored, targetQty: null });
    expect(body.bounty.targetQty).toBeUndefined();
    expect('targetQty' in body.bounty).toBe(false);
  });

  it('apagar manda SOLO el interruptor: precio, objetivo y contador se conservan por omisión', () => {
    const body = buildBountyControlsRequest(stored, { ...stored, enabled: false });
    expect(body.bounty).toEqual({ enabled: false });
  });

  it('⛔ `state`, `effective`, `curveQuoteCents` y `progress` son SALIDA: nunca entran al cuerpo', () => {
    const body = buildBountyControlsRequest(stored, { ...stored, priceCents: 100000, targetQty: 3 });
    const json = JSON.stringify(body);
    for (const salida of ['state', 'effective', 'curveQuoteCents', 'progress', 'remainingQty', 'acquiredQty']) {
      expect(json).not.toContain(salida);
    }
  });

  it('la identidad de la variante viaja siempre, y es la de esta pantalla: `raw` / `raw:NM`', () => {
    const body = buildBountyControlsRequest(stored, { ...stored, priceCents: 100000 });
    expect(body.productType).toBe('raw');
    expect(body.gradeKey).toBe('raw:NM');
  });
});

describe('§28.6b/c — sin cambios no se guarda, y la fricción va en la dirección del dinero', () => {
  const stored = { enabled: true, priceCents: 90000, targetQty: 2 };

  it('`Guardar` sabe cuándo no hay nada que guardar', () => {
    expect(isBountyDraftDirty(stored, { ...stored })).toBe(false);
    expect(isBountyDraftDirty(stored, { ...stored, priceCents: 90100 })).toBe(true);
  });

  it('SUBE el gasto: subir precio, subir objetivo o encender ⇒ pasa por la ventana', () => {
    expect(raisesSpend(stored, { ...stored, priceCents: 100000 })).toBe(true);
    expect(raisesSpend(stored, { ...stored, targetQty: 3 })).toBe(true);
    expect(raisesSpend({ ...stored, enabled: false }, { ...stored, enabled: true })).toBe(true);
    // Poner precio a un `invalida` CUENTA como subir: es dinero que empieza a salir (§28.6g).
    expect(raisesSpend({ enabled: true, priceCents: null, targetQty: 2 }, stored)).toBe(true);
  });

  it('BAJA o DETIENE el gasto ⇒ sin ventana (se hace y se ofrece `Deshacer`)', () => {
    expect(raisesSpend(stored, { ...stored, priceCents: 80000 })).toBe(false);
    expect(raisesSpend(stored, { ...stored, targetQty: 1 })).toBe(false);
    expect(raisesSpend(stored, { ...stored, enabled: false })).toBe(false);
  });
});
