import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fx from './fixtures';
import { computeBreakdown } from '@/lib/api';

/**
 * ⭐⭐ **CRITERIO 196 — «el modo mock/desarrollo no contradice al sistema real».**
 *
 * *«con el dial en un valor distinto del default, el modo mock no muestra una cifra que el sistema
 * real no produciría … lo que no puede es parecer real y estar mal»*.
 *
 * Este fichero es el candado de esa frase, y mide **dinero**, no forma: compara contra las **tres
 * filas publicadas** de `API_CONTRACT §M10-IVA.2` (que son las del criterio **188** y las de
 * `PROJECT §Q.4`). Si el simulador no las produce, el simulador está mal — ⛔ no se ajusta la tabla.
 */

/** Mueve el dial por su **única puerta**, con el acuse que el propio simulador exige. */
function setDial(pct: number) {
  const preview = fx.mockIvaTransferPreview({ ivaTransferPct: pct, samplePriceCents: 10000 });
  fx.applyMockIvaTransfer({
    ivaTransferPct: pct,
    acknowledgement: {
      samplePriceCents: 10000,
      previewedNetDeltaCents: preview.netDeltaPerUnitCents,
    },
  });
}

const DIAL_INICIAL = 100;
afterEach(() => setDial(DIAL_INICIAL));

describe('criterio 196 · el dial mueve los precios del catálogo simulado', () => {
  beforeEach(() => setDial(DIAL_INICIAL));

  /**
   * ⭐⭐ **EL DEFECTO QUE ESTE CANDADO EXISTE PARA IMPEDIR, dicho en una frase:** con `P` clavado en
   * el fixture, la pantalla del dial diría *«cediendo esto pierdes MX$6.90 por unidad»*, el dueño
   * guardaría… **y no se movería un solo precio del mock**. Es el acuse vacío que
   * `§M10-IVA.9.f.3(C)` describe para el sistema real, reproducido en desarrollo.
   *
   * ⛔ **Rojo si `mockListings` deja de re-derivarse**, o si alguien reasigna el array en vez de
   * mutarlo (los importadores se quedarían con el viejo y esto seguiría verde por accidente — por
   * eso se re-lee `fx.mockListings` en cada paso, sin capturar la referencia).
   */
  it('mover el dial cambia `displayPriceCents` de TODAS las piezas, y `L` no se mueve', () => {
    const pieza = 'inv-1002';
    const L = fx.mockListPriceCents(pieza);
    expect(L).toBe(140800);

    const a100 = fx.mockListings.find((l) => l.inventoryItemId === pieza)!.displayPriceCents!;
    expect(a100).toBe(Math.round(140800 * 1.16)); // 163328

    setDial(0);
    const a0 = fx.mockListings.find((l) => l.inventoryItemId === pieza)!.displayPriceCents!;
    expect(a0).toBe(140800); // dial 0 % ⇒ el exhibido ES el precio de lista
    expect(fx.mockListPriceCents(pieza)).toBe(140800); // ⛔ `L` NO se mueve: es la semilla

    setDial(50);
    const a50 = fx.mockListings.find((l) => l.inventoryItemId === pieza)!.displayPriceCents!;
    expect(a50).toBe(Math.round(140800 * 1.08)); // 152064
    expect(a0).toBeLessThan(a50);
    expect(a50).toBeLessThan(a100);
  });

  /**
   * ⭐ **Las TRES filas publicadas del contrato, al centavo.** `10000 → 11600 / 10800 / 10000`.
   * No es una aserción de forma: es la tabla que el dueño aprobó.
   */
  it.each([
    [100, 11600],
    [50, 10800],
    [0, 10000],
  ])('dial %i %% ⇒ P(10000) == %i', (pct, esperado) => {
    setDial(pct);
    expect(fx.mockIvaTransferPreview({ ivaTransferPct: pct, samplePriceCents: 10000 }).current.displayPriceCents).toBe(
      esperado,
    );
  });

  /**
   * ⛔⛔ **`IVA-8(b)` — `PUT /admin/settings { ivaTransferPct }` es `422` Y LA FILA NO SE MUEVE.**
   *
   * Se mide **en ejecución**, no solo por tipo: el `Partial<SettingsDTO>` cierra la puerta en
   * compilación, pero un `as any` o un JSON de red la dejan abierta. **Este caso encontró el hueco
   * de verdad**: antes de arreglarlo, un `setMockSettings` con el error de tipo suprimido metía la
   * clave dentro de `mockSettings`, y el candado de ausencia `IVA-8(f)` se caía a la prueba
   * siguiente.
   */
  it('⛔ `PUT /admin/settings` con la clave del dial es 422, y el dial NO se mueve', () => {
    setDial(50);
    expect(() =>
      // @ts-expect-error — `ivaTransferPct` NO está en `SettingsDTO` (contrato v1.75, `N-IVA9-2`).
      fx.setMockSettings({ ivaTransferPct: 0 }),
    ).toThrowError(/unknown setting key/);
    expect(fx.mockIvaTransferPreview({ ivaTransferPct: 50, samplePriceCents: 10000 }).current.ivaTransferPct).toBe(50);
    expect(Object.keys(fx.mockSettings)).not.toContain('ivaTransferPct');
  });

  /**
   * ⭐ **`IVA-8(f)` en el simulador, POR AUSENCIA:** la llave no existe en el cuerpo de
   * `GET /admin/settings`. ⛔ **Rojo en cuanto aparezca, aunque sea «solo lectura»** — su presencia
   * en el `GET` significa que entró en el mapa que gobierna también el `PUT`.
   */
  it('⛔ `mockSettings` NO contiene la llave del dial', () => {
    expect(Object.keys(fx.mockSettings)).not.toContain('ivaTransferPct');
  });
});

describe('criterio 196 · el desglose del mock reproduce la aritmética del servidor', () => {
  beforeEach(() => setDial(DIAL_INICIAL));

  /**
   * ⭐⭐ **EL DEFECTO PREEXISTENTE QUE ESTE PASE DESTAPA, y que no tenía nada que ver con el IVA:**
   * el gross-up del mock no escalaba la comisión de Stripe por `(1 + r)`, así que con base `11600`
   * cobraba **12345** donde el servidor cobra **12469** — **124 centavos menos por pedido**, en
   * desarrollo y en todo test que corriera contra mocks.
   *
   * Medido contra `backend/src/common/money.ts` `grossUpTotal`:
   * `ceil((base + fixed×1.16) / (1 − pct×1.16))`.
   */
  it('el total del carrito coincide con `grossUpTotal` del servidor (las tres filas)', () => {
    for (const [P, total] of [
      [11600, 12469],
      [10800, 11634],
      [10000, 10799],
    ] as const) {
      const b = computeBreakdown(P);
      expect(b.totalCents).toBe(total);
      expect(b.processingFeeCents).toBe(total - P);
    }
  });

  /**
   * ⭐⭐ **`IVA-2` EN EL MOCK, y es la línea de mayor riesgo del cambio.** La mutación es
   * `grossUpBase = subtotal + iva` sobre un subtotal que **ya** lleva el IVA dentro: produce
   * **+13.6 % a todos los clientes, en silencio**. Con `P = 11600` daría `14164` en vez de `12469`.
   *
   * ⛔ **Rojo si `totalCents > 12469`.**
   */
  it('⛔ el gross-up NO parte de `subtotal + iva` (candado IVA-2)', () => {
    const b = computeBreakdown(11600);
    expect(b.totalCents).toBe(12469);
    expect(b.totalCents).toBeLessThan(14164);
    // La identidad (b) del contrato, que es lo que lo hace estructural y no una constante copiada.
    expect(b.subtotalCents + (b.shippingFeeCents ?? 0) + b.processingFeeCents).toBe(b.totalCents);
  });

  /**
   * ⭐ **El IVA es RESIDUAL y ⛔ jamás 0** (`IVA-8(a)`), **ni con el dial en 0 %**: mover el dial
   * reduce **nuestro neto**, nunca el impuesto registrado.
   */
  it('el IVA es residual sobre el agregado y nunca 0, en las tres posiciones', () => {
    for (const [P, iva] of [
      [11600, 1600],
      [10800, 1490],
      [10000, 1379],
    ] as const) {
      const b = computeBreakdown(P);
      expect(b.ivaCents).toBe(iva);
      expect(b.ivaCents).toBeGreaterThan(0);
      expect(b.ivaCents).toBeLessThan(b.subtotalCents);
    }
  });

  /**
   * ⭐ **§M10-IVA.4 — el envío también lleva su IVA dentro, y el IVA se calcula sobre el AGREGADO.**
   * ⛔ No se reparte por líneas ni se redondea dos veces.
   */
  it('con envío, el IVA es residual del agregado y el total sigue sin sumarlo', () => {
    const b = computeBreakdown(11600, 20300);
    const G = 11600 + 20300;
    expect(b.ivaCents).toBe(G - Math.round(G / 1.16));
    expect(b.subtotalCents + b.shippingFeeCents! + b.processingFeeCents).toBe(b.totalCents);
  });

  /** El `16` ya no está clavado: el desglose lee la tasa del mismo dial que la pantalla escribe. */
  it('⛔ la tasa NO está clavada: sale de `mockSettings.ivaPct`', () => {
    try {
      fx.setMockSettings({ ivaPct: 8 });
      expect(computeBreakdown(10800).ivaRatePct).toBe(8);
    } finally {
      fx.setMockSettings({ ivaPct: 16 });
    }
  });
});
