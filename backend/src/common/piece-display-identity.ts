import { ProductType } from '@prisma/client';

/**
 * piece-display-identity.ts — EL resolutor único de «identidad de display de una pieza»
 * (ARCHITECTURE §4.34a.2(C), v1.94⟨sellado-display⟩).
 *
 * ### El defecto que lo trae
 * El primer pedido real destapó que un producto **sellado** se pintaba como su **carta ancla**
 * (p. ej. «Exeggcute») en 15 superficies de pedido/fulfillment/correo, porque todas leían
 * `item.card.name` sin rama de sellado. La identidad del sellado (`SealedProduct.name` →
 * snapshot `sealedProductName`) existía y se mostraba bien en la tienda (§4.34a); solo la zona de
 * pedido se quedó fuera de la cascada — y la razón de que se quedara fuera es que la regla vivía
 * **copiada en cuatro servicios**. Por eso aquí vive **UNA sola vez**.
 *
 * ### La regla (normativa)
 *  - **Discriminante:** `isSealed = productType === 'sealed'` (⛔ nunca `!('rawCondition' in …)`).
 *  - **Nombre de un sellado (cascada §4.34a):** `sealedProduct?.name` (vivo, si se unió por
 *    `sealedProductId`) → `sealedProductName` (snapshot por-pieza) → **«Sellado sin identificar»**.
 *    ⛔ **El nombre JAMÁS cae al `card.name` del ancla**: ante un «no sé» no se pinta un valor que
 *    parezca bueno (misma doctrina que §4.34a.1 / la cola de M1 P-79c). Un sellado tampoco enseña
 *    `card.number` ni el `finish` del ancla — por eso este resolutor **no devuelve** ni número ni
 *    acabado: quien los emita debe omitirlos para sellado.
 *  - **Imagen de un sellado:** `sealedImageUrl` (snapshot) → `sealedProduct?.imageUrl` (vivo, donde
 *    se unió) → `card.imageSmallUrl` (ancla) → `null`. La imagen del ancla **sí** es cola aceptada
 *    (clase P, §5.2.6): la caja no sale mal rotulada por no tener su foto, solo sin foto propia.
 *  - **No-sellado:** `card.name` / `card.imageSmallUrl`, exactamente como hoy.
 *
 * ### Money-safe
 * Solo display/identidad. ⛔ No toca precio, importe ni valuación.
 */

/** Lo que el operador ve cuando un sellado no tiene nombre resoluble. ⛔ JAMÁS el `card.name` del ancla. */
export const UNIDENTIFIED_SEALED_NAME = 'Sellado sin identificar';

/**
 * Entrada del resolutor. Todas las superficies de §4.34a.2(B) la satisfacen con las columnas que ya
 * cargan (`productType` + el snapshot por-pieza `sealedProductName`/`sealedImageUrl`); el peldaño
 * `sealedProduct` vivo es **opcional**: solo se usa donde el servicio ya une el `SealedProduct`
 * (⛔ este resolutor no abre un join oportunista, §5.2.5).
 */
export type PieceDisplayIdentitySource = {
  productType: ProductType;
  card: { name: string; imageSmallUrl?: string | null } | null | undefined;
  sealedProductId?: string | null;
  sealedProductName?: string | null;
  sealedImageUrl?: string | null;
  // Peldaño vivo OPCIONAL y estructuralmente laxo: muchos lectores unen `sealedProduct` con otra
  // proyección (p. ej. solo el precio del dueño). `name`/`imageUrl` opcionales ⇒ cualquier forma del
  // join es asignable, y si no trajeron el nombre la cascada cae al snapshot — sin romper al llamador.
  sealedProduct?: { name?: string | null; imageUrl?: string | null } | null;
};

export type PieceDisplayIdentity = {
  name: string;
  imageSmallUrl: string | null;
  isSealed: boolean;
};

/**
 * Primer valor NO EN BLANCO (una fuente que existe vacía cuenta como ausente — misma doctrina
 * `nullIfBlank` de `preparation-view.ts`: el `trim()` DECIDE si hay valor, no lo normaliza).
 */
function firstNonBlank(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

/** §4.34a.2(C) — EL resolutor. Puro; sin Prisma, sin Nest, sin estado. */
export function pieceDisplayIdentityOf(item: PieceDisplayIdentitySource): PieceDisplayIdentity {
  const isSealed = item.productType === 'sealed';
  if (!isSealed) {
    return {
      name: item.card?.name ?? '',
      imageSmallUrl: item.card?.imageSmallUrl ?? null,
      isSealed: false,
    };
  }
  const name = firstNonBlank(item.sealedProduct?.name, item.sealedProductName) ?? UNIDENTIFIED_SEALED_NAME;
  const imageSmallUrl = firstNonBlank(
    item.sealedImageUrl,
    item.sealedProduct?.imageUrl,
    item.card?.imageSmallUrl,
  );
  return { name, imageSmallUrl, isSealed: true };
}

/**
 * El nombre de sellado **real** (vivo → snapshot), o `null` si no hay ninguno. Separado de
 * `pieceDisplayIdentityOf` para que el acta congele `sealedProductName` SOLO cuando hay un nombre
 * de verdad (⛔ nunca congela la copia «Sellado sin identificar», que es un display, no un hecho).
 */
export function resolvedSealedName(item: {
  sealedProduct?: { name?: string | null } | null;
  sealedProductName?: string | null;
}): string | null {
  return firstNonBlank(item.sealedProduct?.name, item.sealedProductName);
}
