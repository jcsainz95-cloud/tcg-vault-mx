import type { AdminBountyRowDTO, BountyState } from '@/types/contract';

/**
 * bounty-view-model.ts — M2 › Bounties (§28, contrato §M2-B).
 *
 * ### ⛔⛔ LO QUE ESTE ARCHIVO NO HACE, Y ES LO IMPORTANTE
 * **No deriva el estado de un bounty.** El `state` llega resuelto del servidor (§M2-B.1, marca
 * `<!-- CANON: estado-de-bounty -->` en el contrato) y esta pantalla **lo pinta, lo agrupa y lo
 * cuenta, pero no lo recalcula** — ni cruzando `enabled`/`effective`/`completedAt`, ni comparando
 * `PAGAMOS` con `TARIFA VIGENTE` en el navegador, ni «solo para el color» (§28.0 regla «el estado
 * lo dice el servidor», §28.13 nº1). *Quien decide si un bounty paga es el servidor contra la curva
 * vigente; una pantalla que lo dedujera sería la quinta implementación del mismo predicado y la
 * única que nadie puede probar.*
 *
 * Lo único que aquí se **calcula** es el PREMIUM, que es **una resta de dos cifras que ya vinieron**
 * y sirve para leer, no para clasificar: ⛔ está prohibido deducir el estado de su signo (§28.4).
 */

/** El enum del contrato, en el orden en que lo escribe §M2-B.0. */
export const BOUNTY_STATES: readonly BountyState[] = [
  'activa',
  'rebasada',
  'invalida',
  'completada',
  'apagada',
];

/**
 * Los CINCO chips, **en el orden de la ATENCIÓN, no en el del enum** (§28.2a). Ninguno se funde con
 * otro y ninguno se esconde al llegar a cero: un chip que se esfuma convierte «no hay» en «no se
 * está mirando», que es el defecto que esta pantalla vino a corregir.
 */
export const BOUNTY_CHIP_ORDER: readonly BountyState[] = [
  'rebasada',
  'invalida',
  'activa',
  'completada',
  'apagada',
];

/** Las tres opciones de orden del endpoint. ⛔ No se ofrece ninguna que el servidor no tenga. */
export const BOUNTY_SORTS = ['attention_first', 'price_desc', 'updated_desc'] as const;

/**
 * Los CUATRO bloques de la tabla (§28.2a). Son una **PARTICIÓN del orden que mandó el servidor**,
 * jamás un reordenamiento: `rebasada` e `invalida` comparten bloque porque el servidor ya los pone
 * juntos y primero, y porque dicen la misma noticia (*encendido y no está pagando su premium*).
 * `completada` y `apagada` NO lo comparten: «ya conseguí lo que quería» y «alguien decidió dejar de
 * ofrecer» no son lo mismo, y fundirlas borra el porqué dejó de pagarse.
 */
export type BountyBlock = 'attention' | 'activa' | 'completada' | 'apagada';

const BLOCK_OF: Record<BountyState, BountyBlock> = {
  rebasada: 'attention',
  invalida: 'attention',
  activa: 'activa',
  completada: 'completada',
  apagada: 'apagada',
};

/**
 * Bloque de una fila, o `null` si el `state` no es de los cinco. Un estado desconocido **conserva
 * la posición que le dio el servidor** y no abre bloque nuevo: fabricar un grupo para él sería
 * reordenar, y reordenar es la puerta trasera por la que vuelve a colarse una regla de servidor al
 * navegador (§28.3, §28.13 nº9).
 */
export function blockOfState(state: string): BountyBlock | null {
  return BLOCK_OF[state as BountyState] ?? null;
}

/** ¿Es uno de los cinco valores del enum? Si no, la fila se pinta NEUTRA, jamás `ACTIVO`. */
export function isKnownBountyState(state: string): state is BountyState {
  return (BOUNTY_STATES as readonly string[]).includes(state);
}

/**
 * Recorre `data` **tal como vino** e inserta la marca de encabezado donde CAMBIA el bloque. Con un
 * `sort` distinto de `attention_first` los encabezados **no se pintan** (`grouped: false`): la lista
 * deja de estar agrupada por estado y fingir el grupo mentiría sobre el orden (§28.2a).
 */
export function withBlockHeaders(
  rows: AdminBountyRowDTO[],
  grouped: boolean,
): { row: AdminBountyRowDTO; startsBlock: BountyBlock | null }[] {
  let current: BountyBlock | null = null;
  return rows.map((row) => {
    const block = blockOfState(row.state);
    if (!grouped || block === null || block === current) return { row, startsBlock: null };
    current = block;
    return { row, startsBlock: block };
  });
}

/** ¿Hay alguna fila del bloque ① (ATENCIÓN) en lo que se está enseñando? */
export function hasAttentionRows(rows: AdminBountyRowDTO[]): boolean {
  return rows.some((r) => blockOfState(r.state) === 'attention');
}

/**
 * ### Los filtros de IDENTIDAD que lleva puestos la pantalla (§28.5 v3.5)
 *
 * **Definición normativa, y es mecánica:** un filtro es *de identidad* **si `counts` lo respeta**
 * (`API_CONTRACT §M2-B.1`). Escrita así, la regla sobrevive a que el contrato cambie.
 *
 * Hoy hay **exactamente uno**: la búsqueda `q`, y **cuenta solo con texto tras `trim`** — una `q`
 * vacía o de solo espacios **no acota nada**.
 *
 * - ⛔ **Los chips de estado NO entran**, y la razón es verificable: **`counts` IGNORA el filtro de
 *   estado** (§28.2a), así que con `REBASADOS` o `APAGADOS` puestos `counts.rebasada` sigue siendo
 *   el número del sistema entero y el cero sigue siendo verdadero. *El chip no acota el conjunto de
 *   la pregunta: la responde.*
 * - ⛔ **La paginación tampoco**: no toca `counts`.
 * - `setId`/`finish` entrarían aquí **el día que existan** en esta pantalla (§28.2b, hoy **no
 *   aprobados** — `BNT-D10`). Se añaden **a este objeto y a esta función, y a ningún otro sitio**:
 *   ni el copy ni §28.5 se tocan, que es justo para lo que la condición se escribió en genérico.
 */
export interface BountyIdentityFilters {
  q: string;
}

export function hasIdentityFilter(filters: BountyIdentityFilters): boolean {
  return filters.q.trim() !== '';
}

/**
 * ### El CERO que se dice — y las TRES veces que NO se dice (§28.5, tabla normativa v3.5)
 *
 * Las cuatro condiciones son **excluyentes**: se cumple exactamente una, y por eso aquí no hay
 * precedencias que razonar más allá del orden en que se leen.
 *
 * 1. `truncated === true` ⇒ **ningún cero**: con la lista cortada los conteos también están
 *    incompletos, y un `counts.rebasada: 0` truncado **no es un cero, es un «no lo sé»**. Manda
 *    sobre todo lo demás: *«el recorte que hace falta nombrar primero es el que el humano no
 *    provocó»*.
 * 2. **(v3.5)** hay un **filtro de identidad** puesto ⇒ **`filtered`**, *sea cual sea `counts`*. Con
 *    un filtro, `counts.rebasada: 0` significa *«ninguno **entre los que buscaste**»* y **la
 *    pantalla no tiene de dónde sacar el otro número**: el servidor no manda un conteo sin filtrar.
 *    Mismo «no lo sé» que la lista cortada, distinta mano recortando. ⛔ **Y no se acota la frase,
 *    se retira**: el portador es la **versalita** (§28.3 canal 2), y una salvedad colgada de la
 *    subordinada no desarma una versalita que ya se leyó.
 * 3. `counts.invalida > 0` ⇒ el cero **acotado por el estado**: la frase tranquilizadora afirma
 *    sobre *todos* los encendidos, y con un `invalida` vivo eso es **falso** — ese bounty está
 *    encendido y no paga nada.
 *
 * ⚠️ Se decide sobre `counts` (**el conjunto clasificado**), jamás contando las filas de la página.
 *
 * ⚠️ `identityFiltered` es un parámetro **obligatorio y sin valor por defecto, a propósito**: un
 * default lo volvería olvidable, y olvidarlo devuelve exactamente el defecto que v3.5 vino a cerrar
 * —la pantalla diciendo *«todos los encendidos pagan»* sobre un conjunto que el humano acotó—.
 * Candado: §28.14 caso 19.
 */
export function zeroStatement(
  counts: Record<BountyState, number>,
  truncated: boolean,
  identityFiltered: boolean,
): 'outbid' | 'outbidButNoPrice' | 'filtered' | null {
  if (truncated) return null;
  if (identityFiltered) return 'filtered';
  if (counts.rebasada !== 0) return null;
  return counts.invalida === 0 ? 'outbid' : 'outbidButNoPrice';
}

/**
 * El PREMIUM de una fila: **una resta de las dos cifras que ya vinieron**, nunca un veredicto.
 * ⛔ Prohibido deducir el estado de su signo: un premium negativo **no** «hace» rebasada a la fila
 * (§28.4). *Si el signo y el `state` no coincidieran, manda el `state` y lo que hay es un defecto
 * que reportar — no una fila que repintar.*
 *
 * Los cuatro casos sin resta, en el orden en que se resuelven:
 * - `off` — la fila no paga (`completada`/`apagada`): no hay premium que enseñar.
 * - `noPrice` — no hay precio (la fila `invalida`): ⛔ no se rellena con la tarifa, ni con `0`, ni
 *   con `−100%`. **El hueco es la señal; taparlo con un número la borra.**
 * - `noRate` — `curveQuoteCents === null`: la curva **no resuelve**. Significa una cosa y solo una,
 *   y **nunca** «está apagado».
 * - `unknown` — `state` fuera del enum: no se afirma nada sobre su dinero.
 */
export type BountyPremium =
  | { kind: 'above' | 'below'; amountCents: number; pct: number }
  | { kind: 'off' | 'noPrice' | 'noRate' | 'unknown' };

export function bountyPremium(
  state: string,
  priceCents: number | null,
  curveQuoteCents: number | null,
): BountyPremium {
  if (!isKnownBountyState(state)) return { kind: 'unknown' };
  if (state === 'completada' || state === 'apagada') return { kind: 'off' };
  if (priceCents == null || priceCents <= 0) return { kind: 'noPrice' };
  if (curveQuoteCents == null || curveQuoteCents <= 0) return { kind: 'noRate' };
  const diff = priceCents - curveQuoteCents;
  return {
    kind: diff < 0 ? 'below' : 'above',
    amountCents: Math.abs(diff),
    pct: Math.abs((diff / curveQuoteCents) * 100),
  };
}

/** Clave estable de una fila: el par (carta, acabado) que identifica la variante `raw:NM`. */
export function bountyRowKey(row: { cardId: string; finish: string }): string {
  return `${row.cardId}|${row.finish}`;
}

/**
 * El toast que se pinta tras guardar (§28.6d, tabla normativa). **Se elige por el `state` NUEVO
 * —el que devolvió la RELECTURA—, jamás por lo que se tecleó.** Pintar `ACTIVO` en optimista tras
 * teclear un precio que sigue por debajo sería mentir en el sitio exacto que esta pantalla existe
 * para evitar; y un guardado exitoso que no arregla nada **no puede decir «listo»**.
 *
 * `after === null` = la fila ya no está en la respuesta (se la llevó el filtro o la paginación):
 * entonces se dice lo único que consta, que se guardó. *No se inventa un estado que no llegó.*
 */
export type BountySavedToast = 'saved' | 'savedNowActive' | 'savedStillOutbid' | 'savedStillNoPrice' | 'turnedOff';

export function savedToastFor(before: string, after: BountyState | null): BountySavedToast {
  if (after === null) return 'saved';
  if (after === 'apagada' || after === 'completada') return 'turnedOff';
  if (after === 'invalida') return 'savedStillNoPrice';
  if (after === 'rebasada') return 'savedStillOutbid';
  if (after === 'activa') {
    return before === 'rebasada' || before === 'invalida' ? 'savedNowActive' : 'saved';
  }
  return 'saved';
}

// ---------------------------------------------------------------------------
// ⛔⛔ QUÉ VIAJA EN EL `PUT`, Y QUÉ NO — §M2-B.3 + §28.6f + ARCHITECTURE §0-B.3 regla 9
// ---------------------------------------------------------------------------

/** Lo único que esta pantalla edita: los tres campos del bounty. */
export interface BountyDraft {
  enabled: boolean;
  priceCents: number | null;
  targetQty: number | null;
}

/**
 * Arma el cuerpo del `PUT /admin/pricing/variant-controls/:cardId/:finish` (§M2-B.2: **cero
 * endpoints nuevos**; se reusa el que ya existe, con sus cinco guardas y su auditoría).
 *
 * **La pantalla manda EXACTAMENTE lo que el humano editó**: `bounty.enabled`, `bounty.priceCents`,
 * `bounty.targetQty` y la identidad de la variante (`productType`/`gradeKey`). **Nada más.**
 *
 * ⛔⛔ **NO manda `sellOverrideCents` ni `buyOverrideCents`. Nunca. Ni siquiera «tal como los
 * leyó».** No es una omisión por descuido, es la regla de dinero:
 * - **Campo omitido ⇒ no se toca** — la semántica está normada UNA vez, en el contrato (marca
 *   `<!-- CANON: semantica-de-omision -->`), y **no se transcribe aquí**: se cita.
 * - **El reenvío «defensivo» era el peligro, no la duda.** Convierte una edición **parcial** en una
 *   **sobrescritura total** sobre un endpoint **sin token de concurrencia** que escriben **dos**
 *   superficies. Entre el render de esta lista y el `PUT` cabe un cambio hecho en el drawer del
 *   binder, y el reenvío lo **revertiría en silencio sobre el precio publicado del storefront**:
 *   un *lost update* de dinero.
 * - **⚠️ Y no se copia el patrón de `VariantPriceConsole`** (el drawer del binder), que sí manda los
 *   tres controles: ahí es correcto porque **ese formulario es el dueño de los tres y el humano los
 *   tiene delante**. *La diferencia no es el endpoint: es qué tenía delante la persona al guardar.*
 *
 * También son **salida y jamás entrada**: `state`, `effective`, `curveQuoteCents`, `progress` y
 * `remainingQty`. ⛔ No se «devuelven» al servidor «para que no se pierdan».
 *
 * Candado: **B-11** de §M2-B.6 / §28.14 caso 11 — una aserción sobre la PETICIÓN, no sobre la
 * respuesta. La mitad de servidor («omitido conserva») está cerrada donde vive el endpoint y **no
 * se re-asierta aquí**: dos candados sobre la misma regla se tapan entre sí.
 */
export function buildBountyControlsRequest(
  stored: BountyDraft,
  draft: BountyDraft,
): { productType: 'raw'; gradeKey: 'raw:NM'; bounty: { enabled: boolean; priceCents?: number; targetQty?: number } } {
  const bounty: { enabled: boolean; priceCents?: number; targetQty?: number } = {
    // `enabled` viaja SIEMPRE: el endpoint lo exige cuando el objeto `bounty` está presente
    // (`bounty.enabled must be a boolean`), y es además uno de los tres campos que §M2-B.3 declara
    // propios de esta pantalla. No es un reenvío defensivo: es la forma del campo que se edita.
    enabled: draft.enabled,
  };
  // Solo lo que CAMBIÓ. Un valor idéntico al persistido no se manda: mandarlo no conserva nada que
  // la omisión no conserve ya, y normaliza el hábito que la regla 9 prohíbe.
  if (draft.priceCents != null && draft.priceCents !== stored.priceCents) {
    bounty.priceCents = draft.priceCents;
  }
  // ⛔ **Jamás `targetQty: null`**: el `null` explícito significa «limpia», y limpiar el objetivo de
  // un bounty vivo es exactamente lo que el criterio 164 prohíbe (`422 BOUNTY_TARGET_REQUIRED`).
  // Un objetivo vacío se ataja en el formulario con ese mismo copy, no se manda al servidor.
  if (draft.targetQty != null && draft.targetQty !== stored.targetQty) {
    bounty.targetQty = draft.targetQty;
  }
  return { productType: 'raw', gradeKey: 'raw:NM', bounty };
}

/** ¿El borrador cambia algo respecto de lo persistido? (`Guardar` deshabilitado sin cambios.) */
export function isBountyDraftDirty(stored: BountyDraft, draft: BountyDraft): boolean {
  return (
    stored.enabled !== draft.enabled ||
    stored.priceCents !== draft.priceCents ||
    stored.targetQty !== draft.targetQty
  );
}

/**
 * ### La fricción va en la DIRECCIÓN DEL DINERO (§28.0, §28.6c)
 *
 * `true` ⇒ diálogo de confirmación con los dos importes. Lo que **sube** lo que pagamos (subir el
 * precio, subir el objetivo, **encender**) pasa por la ventana; lo que **baja o detiene** el gasto
 * se guarda y ofrece `Deshacer`. *Poner la misma fricción en las dos direcciones enseña a confirmar
 * sin leer, y entonces la ventana deja de proteger la que importa.*
 *
 * Poner precio a un `invalida` **cuenta como subir**: es dinero que empieza a salir.
 */
export function raisesSpend(stored: BountyDraft, draft: BountyDraft): boolean {
  if (!draft.enabled) return false;
  if (!stored.enabled) return true; // encender
  if (draft.priceCents != null && (stored.priceCents == null || draft.priceCents > stored.priceCents)) return true;
  if (draft.targetQty != null && (stored.targetQty == null || draft.targetQty > stored.targetQty)) return true;
  return false;
}
