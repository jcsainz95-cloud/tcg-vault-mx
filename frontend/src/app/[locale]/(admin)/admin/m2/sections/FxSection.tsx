'use client';

import { FxRateCard } from './fx/FxRateCard';

/**
 * Sección 3 de M2 · **Tipo de cambio**.
 *
 * ⚠️ **No es una pantalla nueva: es la tarjeta de FX que ya existía, REDISEÑADA** según
 * `DESIGN_SYSTEM §30` (contrato `§M2-F`, v1.63.3). Este fichero queda como el punto de montaje que
 * `M2View` conoce; toda la tarjeta vive en `./fx/FxRateCard`.
 *
 * Lo que el panel viejo hacía y **ya no está aquí**:
 *  - el **editor del colchón**: §30.1 lo saca de esta tarjeta («se muestra y se dice dónde se
 *    cambia»), y el dial vuelve a **M10 · Ajustes** (`PUT /admin/settings { fxBufferPct }`, la vía
 *    que el propio contrato recomienda). ⛔ Sin editor en ningún sitio, un dial de dinero sólo se
 *    tocaría con `curl` — que es exactamente lo que el back-office no acepta.
 *  - el campo de tasa suelto en reposo: ahora se entra a editar **por un acto explícito** (§30.9c).
 */
export function FxSection() {
  return <FxRateCard />;
}
