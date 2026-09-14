/**
 * iva-transfer.ts — ⭐⭐ **LA PUERTA DEL DIAL DE TRASLACIÓN DEL IVA: su ARITMÉTICA, PURA.**
 * (`API_CONTRACT §M10-IVA.1`/`§M10-IVA.2`/`§M10-IVA.9`, `ARCHITECTURE §4.44`/`§4.55`, criterio **213**.)
 *
 * ### Qué vive aquí y qué ⛔ NO
 * Aquí vive **la posición del dial** —`P`, la base, el IVA residual, el neto y el total cobrado— y
 * **el delta en pesos** que el criterio **188** obliga a mostrar **antes** de guardar. ⛔ Aquí NO vive
 * ninguna lectura de base de datos, ningún HTTP y ninguna escritura: **es una función de los dos
 * diales y del precio de ejemplo**, y por eso se puede asertar al centavo contra las cifras que
 * `PROJECT §Q.4` publica sin levantar nada.
 *
 * ### ⛔ `IVA-7`: por qué esto NO toca `getStripeFee()`, ni al revés
 * La comisión entra aquí **como PARÁMETRO** (`StripeFeeConfig`), nunca como lectura. La dirección de
 * la dependencia es **preview → comisión**, jamás **comisión → dial**: `getStripeFee()` sigue sin
 * contener una sola referencia a `IVA_TRANSFER_PCT`. *Si el dial de traslación entrara en el cálculo
 * de la comisión, **mover un precio movería una comisión**.*
 *
 * ### ⭐ Por qué la aritmética es ENTERA y no `L × 1.16`
 * `P = round(L × (1 + t·r))` se evalúa como **`L + round(L × t × r / 10000)`** con `t` y `r` enteros
 * en `[0,100]`. Es la **misma** cifra —`round(L×(1+t·r)) = L + round(L×t·r)`, y con `r = 16` no hay
 * empate en `.5` para ningún `t` ni ningún `L` (`IVA-4(d)`)— pero evita meter `1.16` (que **no es
 * representable en binario**) en una multiplicación que decide dinero. Igual la base:
 * `round(P / (1+r))` se evalúa como `round(P × 100 / (100+r))`.
 *
 * **Cota de rango:** `L × t × r ≤ MAX_CENTS × 100 × 100 ≈ 2.1e13`, muy por debajo de
 * `Number.MAX_SAFE_INTEGER` (`9.0e15`) ⇒ el producto intermedio es **exacto**, no aproximado.
 */
import {
  StripeFeeConfig,
  displayPriceCentsOf,
  grossUpTotal,
  taxBaseCentsOf,
} from '../../common/money';
import type { IvaDials } from '../../common/money';

/**
 * ⭐ **v1.75/D56 — `displayPriceCentsOf` y `taxBaseCentsOf` SE MUDARON a `common/money.ts`, y se
 * re-exportan desde aquí para no romper a nadie.**
 *
 * **Por qué se mudan:** desde D56 esa misma aritmética la necesitan el **catálogo** y el **checkout**
 * para derivar `P` en cada lectura. Dejarlas en el módulo del dial obligaría a `catalog` y a `orders`
 * a importar de `modules/settings/` para hacer una multiplicación de dinero. *La aritmética del
 * dinero es del núcleo; la puerta del dial es de settings.* Y, sobre todo: **una sola definición** —
 * si el preview del acuse y el precio que se cobra salieran de dos funciones distintas, el acuse del
 * criterio 188 podría cuadrar contra una cifra que el checkout no produce.
 */
export { displayPriceCentsOf, taxBaseCentsOf };
export type { IvaDials };

/** `IvaTransferPositionDTO` de `API_CONTRACT §M10-IVA.2`. Una posición del dial, en pesos. */
export interface IvaTransferPositionDTO {
  /** La FRACCIÓN DE TRASLACIÓN de esta posición (entero `[0,100]`). ⛔ No son puntos de IVA. */
  ivaTransferPct: number;
  /** `P = round(L × (1 + t·r))` — la cifra que se pinta y la que se suma. YA lleva el IVA dentro. */
  displayPriceCents: number;
  /** `round(P / (1 + r))`. */
  taxBaseCents: number;
  /** `P − taxBaseCents` — **RESIDUAL**. ⛔ Nunca 0, ni con el dial en 0 % (`IVA-8(a)`). */
  ivaCents: number;
  /** `= taxBaseCents`. El ingreso propio de la unidad (criterio **191**). */
  netRevenueCents: number;
  /** Gross-up con los diales de Stripe vigentes: lo que el cliente pagaría por esa unidad. */
  totalChargedCents: number;
}

/** `IvaTransferPreviewDTO` de `API_CONTRACT §M10-IVA.2`. */
export interface IvaTransferPreviewDTO {
  /** La **TASA** vigente (dial `iva_pct`). ⛔ No es el dial de traslación. */
  ivaRatePct: number;
  /** El `L` de ejemplo. */
  samplePriceCents: number;
  /** Con el dial **VIGENTE**. */
  current: IvaTransferPositionDTO;
  /** Con el `ivaTransferPct` propuesto. */
  proposed: IvaTransferPositionDTO;
  /** `proposed.netRevenueCents − current.netRevenueCents`. **Negativo = margen cedido.** */
  netDeltaPerUnitCents: number;
}

/**
 * ⭐⭐ **EL `L` CANÓNICO: MX$100.00.** (`§M10-IVA.2`, y es el de `PROJECT §Q.4`.)
 *
 * Tiene **dos papeles y hay que distinguirlos**, porque `REL-A` nació de confundirlos:
 *  - en el **`/preview`** es el **DEFAULT** de un eje que el llamante puede mover a voluntad dentro
 *    de `[1, {@link IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX}]` — explorar es libre, la lectura no tiene
 *    efectos;
 *  - en el **ACUSE del `PUT`** es el **ÚNICO valor legal** (`D-ACUSE-1`, `ARCHITECTURE §4.56.1`):
 *    la magnitud sobre la que se firma **la fija el servidor**. Ver
 *    {@link validateAckSamplePriceCents}.
 *
 * ⚠️ **Bajar esta constante pone ROJO el candado `IVA-14`** (`test/settings.iva-transfer-ack-canonical.spec.ts`)
 * y **tiene que hacerlo**: es la magnitud que decide si un movimiento del dial produce un costo
 * visible o un `0` fabricable. *Una constante que gobierna un acuse de dinero no se baja sin que
 * alguien se entere.*
 */
export const IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT = 10_000;

/**
 * ⭐⭐ **LA COTA SUPERIOR DE `samplePriceCents` — MX$1 000 000 — Y NO ES HIGIENE: SIN ELLA LA RUTA ES
 * UN `500` DESDE LA BARRA DE DIRECCIONES** (`API_CONTRACT §M10-IVA.2`, `ARCHITECTURE §9 · D-IVA-13`).
 *
 * `totalChargedCents` sale de `grossUpTotal`, que **LANZA** cuando el total excede `MAX_CENTS`
 * (*«total exceeds MAX_CENTS — order amount not representable»*), y ese `Error` **no lo mapea el
 * filtro global**. Con `samplePriceCents = 2_000_000_000` y el dial en 100, `P = 2.32e9 > MAX_CENTS`
 * ⇒ excepción ⇒ **`500` disparable por cualquiera con sesión `super_admin`**, que es exactamente la
 * clase que §0-Q existe para cerrar.
 *
 * ⚠️ **MEDIDO en su día, y NO era solo del `/preview`:** el validador del acuse admitía hasta
 * `MAX_CENTS`, así que **el `PUT` del acuse tenía el mismo `500`** —aceptaba `2_147_483_647`,
 * `displayPriceCentsOf` lo lleva a `2 491 081 030` y `grossUpTotal` lanza—. La cota se aplicó a
 * **las dos puertas**, no solo a la que el contrato nombró.
 *
 * ⭐ **Desde `D-ACUSE-1` (v1.76) esta cota ya NO es la que protege al `PUT`**: el acuse sólo admite
 * el `L` canónico ({@link validateAckSamplePriceCents}), que está **cuatro órdenes de magnitud** por
 * debajo. Esta constante gobierna hoy **el eje del `/preview`**, que conserva su rango entero — y
 * ahí sigue siendo lo único entre la barra de direcciones y un `500` sin mapear.
 *
 * **La cifra se elige MEDIDA, no redonda por gusto:** con el dial en 100 y `r = 16`, `P = 1.16e8` y
 * su gross-up ≈ `1.21e8` — **casi veinte veces por debajo** de `MAX_CENTS`, así que ningún dial ni
 * ninguna comisión configurable puede acercarlo al techo.
 */
export const IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX = 100_000_000;

/**
 * Una posición del dial, entera. **El servidor la calcula; ⛔ el frontend no multiplica nada**
 * (`ARCHITECTURE §4.44.i`): si el front computara el delta, el acuse probaría que el front sabe
 * multiplicar, **no que el dueño vio el costo real**.
 */
export function ivaTransferPosition(
  listPriceCents: number,
  ivaTransferPct: number,
  ivaRatePct: number,
  fee: StripeFeeConfig,
): IvaTransferPositionDTO {
  const displayPriceCents = displayPriceCentsOf(listPriceCents, ivaTransferPct, ivaRatePct);
  const taxBaseCents = taxBaseCentsOf(displayPriceCents, ivaRatePct);
  return {
    ivaTransferPct,
    displayPriceCents,
    taxBaseCents,
    // RESIDUAL, por resta. Ver `taxBaseCentsOf`.
    ivaCents: displayPriceCents - taxBaseCents,
    // `netRevenueCents == taxBaseCents` bajo `IVA_INCLUSIVE` (criterio 191). Es la MISMA decisión
    // que `money.netRevenueCents()` toma sobre una fila persistida; aquí es sobre una hipótesis.
    netRevenueCents: taxBaseCents,
    totalChargedCents: grossUpTotal(displayPriceCents, fee),
  };
}

/**
 * ⭐⭐ **El preview entero: las dos posiciones y el delta en pesos.**
 *
 * `netDeltaPerUnitCents` es **la cifra del criterio 188**: con `L = MX$100.00`, `r = 16` y el dial
 * de **100 → 50** vale **`−690`** (−MX$6.90 por unidad).
 *
 * ⚠️ **El delta NO depende de los diales de Stripe.** Depende de `r`, del dial vigente y del
 * propuesto, y de nada más — por eso el `409 IVA_TRANSFER_ACK_STALE` es estable frente a un cambio
 * de comisión que ocurra entre que el dueño mira la pantalla y pulsa guardar. *Un acuse que caducara
 * por algo que no es lo que se está decidiendo enseñaría a reintentar sin leer.*
 */
export function ivaTransferPreview(params: {
  currentPct: number;
  proposedPct: number;
  ivaRatePct: number;
  samplePriceCents: number;
  fee: StripeFeeConfig;
}): IvaTransferPreviewDTO {
  const { currentPct, proposedPct, ivaRatePct, samplePriceCents, fee } = params;
  const current = ivaTransferPosition(samplePriceCents, currentPct, ivaRatePct, fee);
  const proposed = ivaTransferPosition(samplePriceCents, proposedPct, ivaRatePct, fee);
  return {
    ivaRatePct,
    samplePriceCents,
    current,
    proposed,
    netDeltaPerUnitCents: proposed.netRevenueCents - current.netRevenueCents,
  };
}

/**
 * ⭐⭐ **`D-ACUSE-1` — EL `L` DEL ACUSE LO FIJA EL SERVIDOR: sólo se admite el CANÓNICO `10 000`.**
 * (`ARCHITECTURE §4.56.1`, `API_CONTRACT §M10-IVA.2` punto 3, hallazgo `REL-A` del pentester.)
 *
 * ### Qué validaba esto antes, y por qué no bastaba (medido EN VIVO, dial movido 100→50)
 * El validador anterior era un **rango** —`[1, 100 000 000]`— y rechazaba `0` con este argumento,
 * que era correcto pero **incompleto**: *«0 makes every net delta 0, which would turn the
 * acknowledgement into a no-op»*. Se le escapó que **`L` diminuto hace exactamente lo mismo**: el
 * delta es `round(P/(1+r))` de una posición menos la otra, y para `L` pequeño ese redondeo también
 * da `0`. El pentester firmó **`{ samplePriceCents: 1, previewedNetDeltaCents: 0 }`** y el dial se
 * movió **habiendo «mostrado» MX$0.00**, cuando el costo real a MX$100 es **−690 centavos por
 * unidad (~7 %)**. *Un peldaño por encima de `0` es el mismo agujero.*
 *
 * ### La norma, que es de CLASE y no de este endpoint
 * ⛔⛔ **El valor que un acuse confirma se calcula sobre una magnitud que fija el SERVIDOR. Queda
 * prohibido todo acuse cuyo efecto confirmado dependa de un argumento que viaja en la MISMA
 * petición que lo confirma.** *Un control cuyo parámetro elige la parte controlada no es un
 * control: es una casilla.*
 * ⭐ **Y su corolario, que es la mitad que evita leerla como una amputación: EXPLORAR ES LIBRE;
 * ACUSAR ES SOBRE UNA MAGNITUD FIJA.** El eje `samplePriceCents` del **`/preview`** ⛔ **no se
 * toca**: conserva su dominio entero `[1, {@link IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX}]`, porque es
 * una lectura **sin efectos** y *«¿y sobre una pieza de MX$2 000?»* es una pregunta legítima. Lo que
 * ⛔ no puede es que ese número **decida contra qué compara el servidor para permitir la escritura**.
 *
 * ### ⛔ Las tres alternativas descartadas, para que no vuelvan por la puerta de atrás
 *  1. ⛔ **Subir la cota inferior no cierra la clase, y es ARITMÉTICA, no opinión.** El delta es
 *     ≈ `L · (r/100)/(1+r/100) · Δt/100`: con `r = 16` hace falta `L ≳ 363` para que `Δt = 1` dé un
 *     centavo, pero **con `r = 1` hace falta `L ≳ 5 050`**. Cualquier cota elegida contra el `r` de
 *     hoy **se rompe sola al mover `iva_pct`, y en silencio**.
 *  2. ⛔ **No se calcula sobre un precio «representativo» del catálogo** (mediana, más vendido): una
 *     estadística **se mueve entre que el dueño mira la pantalla y pulsa guardar** ⇒ produciría
 *     `409 IVA_TRANSFER_ACK_STALE` **por algo que no es lo que se está decidiendo**. ⇒ constante.
 *  3. ⛔ **No se IGNORA el campo** usando el canónico por dentro: ignorar en silencio un campo de
 *     dinero deja al operador creyendo que su número contó. ⇒ **`422` explícito**. *Si el campo no
 *     manda, el servidor lo dice; no lo finge.*
 *
 * ### ⛔ Y lo que NO se añade: ninguna comprobación de «delta ≠ 0» en ejecución
 * Con el `L` canónico fijo, un delta `0` sólo puede ser **verdad** (`iva_pct = 0` ⇒ no hay IVA que
 * trasladar ⇒ mover el dial no cuesta nada), y bloquearlo **encerraría el dial** en esa
 * configuración. *Un acuse de cero deja de ser un problema en cuanto no se puede fabricar.* En su
 * lugar, el candado **`IVA-14`** vive en CI (`test/settings.iva-transfer-ack-canonical.spec.ts`) y
 * se pone rojo el día que alguien **baje la constante** o **reabra la elección al llamante** — que
 * es **cuándo** hay que enterarse, y no en el dial del dueño.
 *
 * ### Por qué el campo SE CONSERVA en el cuerpo en vez de retirarse
 * **(a)** el frontend **ya manda `10000`** (`IvaTransferSection.tsx:26` `SAMPLE_PRICE_CENTS` → `:92`
 * el `/preview` → `:147` el acuse) ⇒ **cero rework**; **(b)** deja constancia, en el cuerpo que se
 * audita, de **sobre qué `L` se firmó** — justo el hecho que `REL-A` volvió ambiguo.
 *
 * @returns el mensaje de error, o `null` si es el `L` canónico.
 */
export function validateAckSamplePriceCents(v: unknown): string | null {
  // `===` contra la constante: no hay rango que ampliar ni borde que empujar. Rechaza de un golpe
  // el `1` del PoC, los decimales, `NaN`/`Infinity`, las cadenas (`'10000'`) y el `undefined` que
  // llegara aquí sin pasar por la comprobación de campos a medias del caller.
  return v === IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT
    ? null
    : `must be exactly ${IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT} — the CANONICAL sample list ` +
        'price `L` (MX$100.00), which the SERVER fixes and the caller does not choose. An ' +
        'acknowledgement whose `L` travels in the same request it confirms is not a control: with ' +
        'a tiny `L` the net delta rounds to 0 and the acknowledgement signs off MX$0.00 for a ' +
        'change that really costs ~7% of every price (pentest REL-A). Exploring is free — ' +
        '`GET /admin/settings/iva-transfer/preview?samplePriceCents=` keeps its full range ' +
        `[1, ${IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX}] because it has no effects; acknowledging is ` +
        'over a fixed magnitude';
}

/**
 * ⭐⭐ **La puerta única del dial, tomada DENTRO de `tx`** — se libera sola al commit o al rollback.
 *
 * Mismo patrón y mismo motivo que `lockFxGate` (`S-FX-1`, `common/fx-mode.ts`): **candado → releer →
 * validar el acuse → escribir → auditar**. Sin él, dos `PUT` concurrentes leen ambos el dial vigente
 * `100`, los dos acuses cuadran, y el segundo commitea un valor cuyo costo en pesos **nunca se le
 * mostró a nadie** — porque se calculó contra un vigente que ya no existía. *El acuse existe para
 * afirmar «vi lo que cuesta ir de AQUÍ a allá»; sin candado, el «aquí» se mueve debajo.*
 *
 * ⚠️ Clave distinta de `FX_GATE_LOCK_KEY`: compartirla serializaría dos diales que no comparten
 * ningún invariante, y eso convierte un candado correcto en una cola.
 */
export const IVA_TRANSFER_GATE_LOCK_KEY = 64_440_950;

/** Lo mínimo que necesita {@link lockIvaTransferGate}: el handle de una transacción de Prisma. */
export interface IvaTransferGateLocker {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

/** Toma la puerta única del dial de traslación dentro de `tx` (`pg_advisory_xact_lock`). */
export async function lockIvaTransferGate(tx: IvaTransferGateLocker): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IVA_TRANSFER_GATE_LOCK_KEY})`;
}
