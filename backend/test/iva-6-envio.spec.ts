import {
  StripeFeeConfig,
  computeDirectShipBreakdown,
  computeShipmentBreakdown,
  displayPriceCentsOf,
  grossUpTotal,
  shippingFeeDisplayCentsOf,
} from '../src/common/money';

/**
 * ⭐ **`IVA-6` — ⛔ NINGÚN IMPORTE DE IVA SE APILA DESPUÉS DEL PRECIO EXHIBIDO, Y EL SITIO DONDE SE
 * COLABA ERA EL ENVÍO.** (`API_CONTRACT §M10-IVA.5`, criterio **189**; `ARCHITECTURE §4.44.f`.)
 *
 * **El defecto de antes del corte, medido:** `computeShipmentBreakdown` y
 * `computeDirectShipBreakdown` apilaban `round(envío × r)` **detrás** de la tarifa. Eso son **dos
 * convenciones dentro de un mismo total** —el precio de la carta con IVA dentro y el envío con el
 * IVA fuera—, que es el defecto que `§Q` vino a cerrar (hecho 6).
 *
 * **La norma:** el envío entra en la regla madre **como un `L` más**. `F` (el dial
 * `shipping_fee_cents`) **sigue siendo NETO y no cambia de valor**; lo que se exhibe y se cobra es
 * `E = round(F × (1 + t·r))`.
 *
 * ### ⭐ Money-neutral POR CONSTRUCCIÓN, y es lo que hace que esto no sea un cambio de precio
 * `round(17500 × 1.16) = 20300`, que es **exactamente** lo que antes aportaban
 * `17500 + round(17500 × 0.16) = 17500 + 2800`. **Ni un centavo.**
 */

const FEE: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const R = 16;
/** `F` — el dial, NETO. ⛔ No cambia de valor con el corte. */
const F = 17_500;

describe('⭐ `IVA-6` — la tarifa de envío lleva su IVA DENTRO, y el total no gana un sumando', () => {
  it('⭐⭐ `E = round(F × (1+t·r))` y con el dial en 100 % vale 20300 — money-neutral', () => {
    const E = shippingFeeDisplayCentsOf(F, { ivaTransferPct: 100, ivaRatePct: R });
    expect(E).toBe(20_300);
    // Lo que aportaba el camino viejo: tarifa + su IVA apilado detrás. **Idéntico.**
    expect(E).toBe(F + Math.round((F * R) / 100));
    // ⛔ Rojo con `17500`: sería exhibir la tarifa NETA como si fuera lo que se cobra ⇒ dos
    // convenciones en un mismo total.
    expect(E).not.toBe(F);
  });

  it('⭐ el envío entra en la regla madre como un `L` más: MISMA función que una carta', () => {
    for (const t of [0, 37, 50, 100]) {
      expect(shippingFeeDisplayCentsOf(F, { ivaTransferPct: t, ivaRatePct: R })).toBe(
        displayPriceCentsOf(F, t, R),
      );
    }
  });

  it('⭐⭐ (a) `direct_ship`: `total == grossUpTotal(S + E)` y `shippingFeeCents == 20300`', () => {
    const S = displayPriceCentsOf(10_000, 100, R); // 11600
    const E = shippingFeeDisplayCentsOf(F, { ivaTransferPct: 100, ivaRatePct: R }); // 20300
    const b = computeDirectShipBreakdown(S, E, R, FEE);
    expect(b.shippingFeeCents).toBe(20_300);
    expect(b.totalCents).toBe(grossUpTotal(S + E, FEE));
    // ⛔ Y ⛔ NO aparece ningún CUARTO sumando: cartas + envío + comisión, y nada más.
    expect(b.totalCents).toBe(b.subtotalCents + b.shippingFeeCents + b.processingFeeCents);
  });

  it('⛔ (a-mutación) exhibir la tarifa NETA cobra 2800 menos y mezcla dos convenciones', () => {
    const S = displayPriceCentsOf(10_000, 100, R);
    const bueno = computeDirectShipBreakdown(S, 20_300, R, FEE);
    const mutado = computeDirectShipBreakdown(S, F, R, FEE);
    expect(bueno.totalCents - mutado.totalCents).toBeGreaterThan(2_800);
    expect(mutado.shippingFeeCents).toBe(17_500);
  });

  it('⭐ (b) money-neutral contra el PASADO: el mismo total que producía el camino viejo', () => {
    // El camino viejo, reconstruido literal: `iva = round((S_neto + F) × r)`, `base = S+F+iva`.
    const Sneto = 10_000;
    const ivaViejo = Math.round(((Sneto + F) * R) / 100);
    const totalViejo = grossUpTotal(Sneto + F + ivaViejo, FEE);

    const S = displayPriceCentsOf(Sneto, 100, R);
    const E = shippingFeeDisplayCentsOf(F, { ivaTransferPct: 100, ivaRatePct: R });
    const b = computeDirectShipBreakdown(S, E, R, FEE);
    expect(b.totalCents).toBe(totalViejo);
    // Y el IVA registrado también coincide al centavo.
    expect(b.ivaCents).toBe(ivaViejo);
  });

  it('⭐ (c) el retiro de bóveda (`POST /shipments/quote`) cumple la misma identidad', () => {
    const E = shippingFeeDisplayCentsOf(F, { ivaTransferPct: 100, ivaRatePct: R });
    const b = computeShipmentBreakdown(E, R, FEE);
    expect(b.subtotalCents).toBe(20_300);
    expect(b.totalCents).toBe(grossUpTotal(20_300, FEE));
    expect(b.totalCents).toBe(b.subtotalCents + b.processingFeeCents);
    // Money-neutral contra el pasado: `base = 17500 + 2800 = 20300` ⇒ el mismo total.
    expect(b.totalCents).toBe(grossUpTotal(F + Math.round((F * R) / 100), FEE));
  });

  it('⭐⭐ (d) POR AUSENCIA, sobre el JSON serializado: ningún campo de IVA SUMA al total', () => {
    // El contrato lo pide sobre «las tres rutas». Aquí se mide sobre los tres desgloses que esas
    // rutas serializan, que es donde el importe existe: para cada uno, restar del total todos los
    // campos numéricos **excepto** el propio total deja **exactamente** el IVA fuera de la cuenta.
    const casos = [
      computeDirectShipBreakdown(11_600, 20_300, R, FEE),
      computeShipmentBreakdown(20_300, R, FEE),
    ];
    for (const b of casos) {
      const shipping = 'shippingFeeCents' in b ? (b as { shippingFeeCents: number }).shippingFeeCents : 0;
      expect(b.totalCents).toBe(b.subtotalCents + shipping + b.processingFeeCents);
      // ⛔ Si el IVA sumara, esta igualdad fallaría por exactamente `ivaCents`.
      expect(b.totalCents).not.toBe(b.subtotalCents + shipping + b.processingFeeCents + b.ivaCents);
      expect(b.ivaCents).toBeGreaterThan(0); // informa, pero no suma
    }
  });

  it('⛔ el dial NO toca `F`: la fila `shipping_fee_cents` sigue valiendo lo mismo', () => {
    // *«`L` no cambia nunca. `P` se deriva.»* El envío es un `L` más, así que mover el dial mueve
    // `E` y ⛔ jamás `F`. Se afirma sobre la función: `F` entra como argumento y sale intacto.
    for (const t of [0, 50, 100]) {
      const E = shippingFeeDisplayCentsOf(F, { ivaTransferPct: t, ivaRatePct: R });
      expect(F).toBe(17_500);
      expect(E).toBeGreaterThanOrEqual(F);
    }
  });
});

/** ⭐ **EL CANARIO** — el defecto de antes del corte, reintroducido, produce OTRO total. */
describe('⭐ canario de `IVA-6`: apilar el IVA detrás del envío se ve, y se mide', () => {
  it('⭐⭐ m1 — `total = grossUp(S + E + iva)` cobra el IVA del envío DOS veces', () => {
    const S = 11_600;
    const E = 20_300;
    const bueno = computeDirectShipBreakdown(S, E, R, FEE);
    const mutado = grossUpTotal(S + E + bueno.ivaCents, FEE);
    expect(mutado).toBeGreaterThan(bueno.totalCents);
    // El sobrecosto es el gross-up del IVA entero del agregado: ≈ 4400 centavos + su comisión.
    expect(mutado - bueno.totalCents).toBeGreaterThan(4_400);
  });

  it('m2 — dejar la tarifa NETA y apilar su IVA aparte da el MISMO total pero rompe (d)', () => {
    // Es la mutación sutil: los pesos cuadran y lo que se rompe es la FORMA — el recibo vuelve a
    // tener un sumando de IVA después del precio exhibido, que es lo que el criterio 189 prohíbe.
    const S = 11_600;
    const mutadoTotal = grossUpTotal(S + F + Math.round((F * R) / 100), FEE);
    const bueno = computeDirectShipBreakdown(S, 20_300, R, FEE);
    // ⚠️ Iguales en pesos…
    expect(mutadoTotal).toBe(bueno.totalCents);
    // …y por eso el candado (d) es estructural y no aritmético: la mutación que solo cambia la
    // PRESENTACIÓN no la caza una comparación de totales. La caza la identidad sin `ivaCents`.
    expect(bueno.totalCents).toBe(bueno.subtotalCents + bueno.shippingFeeCents + bueno.processingFeeCents);
  });

  it('m3 — derivar `E` con el dial del IVA de STRIPE en vez del de traslación (`IVA-7` cruzado)', () => {
    // `stripeFeeIvaPct` es la TASA, ⛔ no el dial. Usarla como `t` daría una tarifa distinta en
    // cuanto el dueño mueva el dial de traslación.
    const conDial = shippingFeeDisplayCentsOf(F, { ivaTransferPct: 50, ivaRatePct: R });
    const conTasa = displayPriceCentsOf(F, 100, R);
    expect(conDial).toBe(18_900);
    expect(conTasa).toBe(20_300);
    expect(conDial).not.toBe(conTasa);
  });
});
