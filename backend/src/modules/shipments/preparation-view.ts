import { Finish, InventoryItem, SealedCondition, VaultLocation } from '@prisma/client';

/**
 * preparation-view.ts — los ayudantes PUROS de proyección de «Pedidos a preparar» (§M4-PREP).
 *
 * ⭐ v1.79 (§M4-VAULT) — se sacaron de `shipments.service.ts` **sin cambiar ni una línea de cuerpo**
 * para que la cubeta `vault` (cola, verbos de palomeo y vista física de `modules/vault/`) proyecte la
 * carta, la ubicación y la ausencia con **el mismo cuerpo** que la cubeta `ship` — ⛔ no una copia.
 * Sin estado, sin Prisma, sin Nest: cualquiera los importa sin crear un ciclo entre módulos.
 * (`byLocation`, el comparador de §M4P-ORDER, se queda en el servicio: su guarda de residuo lo lee ahí.)
 */

/**
 * §M4-PREP / CA #11 — el código `"UNASSIGNED"` **deja de viajar por el cable**. El back manda el
 * ESTADO (`kind`) y, cuando lo hay, el DATO (`label`), para que el front no compare strings.
 */
/**
 * §M4-PREP / CA #11 — el código `"UNASSIGNED"` **deja de viajar por el cable**. El back manda el
 * ESTADO y, con él, su etiqueta.
 *
 * ### ⭐⭐ v1.78.2 — UNIÓN DISCRIMINADA, ⛔ ya NO `{ kind; label? }`
 * Con `label` **opcional**, el estado `{kind:'assigned'}` —asignada, pero sin etiqueta a la que
 * caminar— era **representable**, y cada consumidor tenía que re-derivar con su propio predicado si
 * era caminable o no. Aquí `assigned` ⇒ **hay etiqueta**, por el tipo: el estado ilegal deja de
 * existir en vez de estar prohibido por un comentario.
 *
 * ### ⛔ Y esto REVIERTE una decisión mía, que el arquitecto refutó con una medición mejor
 * Yo había servido `{kind:'assigned'}` sin `label` ante una etiqueta en blanco, argumentando que
 * «`kind` describe la FILA y `label` el TEXTO: son dos hechos». El argumento es cierto **en la tabla**
 * y **ocioso en esta hoja**: este DTO no espeja `VaultLocation`, es la hoja de trabajo del operador,
 * cuya única pregunta es *«¿hay sitio al que caminar?»*. Y sobre todo, **estaba defendiendo un
 * fantasma** — re-medido por mí, no aceptado de palabra:
 *
 * ```
 * grep -rn "vaultLocation\.(create|update|upsert|createMany|updateMany)" src/ prisma/
 * ```
 * ⇒ **un solo escritor de producción**, `inventory.service.ts` · `createLocation`, que **compone**
 * `` `${box}-${row}-${slot}` `` ⇒ **siempre trae los dos guiones**, aunque los tres componentes
 * vinieran vacíos (`"--"`); los otros tres son *seeds* con etiqueta literal; y **ninguno actualiza
 * `label`**. El único sitio del repositorio que escribe una etiqueta en blanco es **mi propio
 * fixture de prueba**. ⇒ el estado que yo defendía **no lo produce el sistema**, y el precio de
 * defenderlo era un estado ilegal **permanente** en un DTO que otros consumen. *El dato gana.*
 */
export type LocationView = { kind: 'assigned'; label: string } | { kind: 'unassigned' };

/**
 * §M4-PREP — etiqueta del SELLADO. `Record<SealedCondition, string>` y no un `switch` con `default`:
 * un valor nuevo en el enum **rompe la compilación aquí**, en el punto exacto donde falta decidir
 * cómo se le habla al operador. (⛔ No es una lista literal de enum: las llaves son del `Record`
 * tipado, no un array a mano — §4.37.)
 */
export const SEALED_CONDITION_LABELS: Record<SealedCondition, string> = {
  mint: 'Mint',
  minor_box_damage: 'Minor box damage',
};

/**
 * ⭐⭐ **§M4-PREP v1.78.1 — «un hecho, una grafía». La ausencia se escribe `null`, y SOLO `null`.**
 *
 * ### El defecto que lo trae (`B-1`, bloqueante de QA, medido por HTTP contra Postgres real)
 * v1.78.1 declaró `null` como única marca de ausencia y ⛔ prohibió `""`. Este módulo lo cerró **a
 * medias**: `?? null` cae ante `null`/`undefined` **pero no ante `""` ni `"   "`**, así que una
 * fuente que existe VACÍA pasaba intacta por el cable. En la cola viva salieron **las tres grafías
 * del mismo hecho una debajo de otra**: `""`, `"   "` y `null`. *Cerrar «la llave no existe» y dejar
 * abierta «la llave existe vacía» no es medio arreglo: es el mismo defecto con menos superficie.*
 *
 * Y es alcanzable, no teórico: `guest-checkout.dto.ts` valida `recipientName` con `@IsString()
 * @MaxLength(120)` **sin `@IsNotEmpty()`**, y `auth.dto.ts` valida `name` con `@MinLength(1)`
 * **sin `trim`** ⇒ `""` y `"   "` llegan a la base. (⚠️ Endurecer esas DOS validaciones de ENTRADA
 * es más ancho y toca el checkout: queda como **seguimiento**, no en este pase.)
 *
 * ### Por qué un helper y no un `if` en cada campo
 * Es la lección de `§M5-T` aplicada a un DTO: *«el defecto no fue que a dos métodos les faltara un
 * `where`; fue que la regla estaba escrita en un solo sitio, así que faltar era gratis»*. Con la
 * regla en **una** función, un campo nullable nuevo que no la use es una omisión **visible** —y el
 * censo de `shipments.picking-list.spec.ts` la pone roja.
 *
 * ⛔ **Devuelve el valor ORIGINAL, sin recortar, cuando NO está en blanco.** El `trim()` decide si
 * hay ausencia; ⛔ no «arregla» el dato. Misma doctrina que `parseEnumFilter` (§0-Q: *el `trim()`
 * decide si viene VACÍO, no normaliza el token*). Recortar aquí convertiría `"Ana "` en otro dato
 * del que el operador no pidió cambio.
 */
export function nullIfBlank(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v.trim() === '' ? null : v;
}

/**
 * §M4-PREP / §6.A — apellido **DERIVADO** (último token del nombre), para el archivero alfabético.
 *
 * ⚠️ **FRÁGIL A PROPÓSITO y NO BLOQUEA NADA.** No existe apellido estructurado en el modelo
 * (`User.name` y `addressSnapshot.recipientName` son **un solo string**), y derivarlo falla con
 * apellidos compuestos o con otro orden de nombre. Es la **etiqueta de ordenación visual**, no un
 * dato de negocio: ningún flujo depende de él. La alternativa —columna nueva + captura nueva— es
 * cambio de modelo, fuera del alcance de una rebanada de solo lectura.
 *
 * **v1.78.1 — `fullName === null ⇒ lastName === null` POR CONSTRUCCIÓN**, no por coincidencia: la
 * ausencia se propaga, no se traduce. También `null` si el nombre viene en blanco. Un nombre de UN
 * solo token SÍ devuelve ese token — un mononombre se archiva bajo su propia letra, y devolver
 * `null` tiraría información de archivo que sí tenemos.
 */
export function lastNameOf(fullName: string | null): string | null {
  if (fullName === null) return null;
  const tokens = fullName
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return tokens.length === 0 ? null : tokens[tokens.length - 1];
}

/**
 * §M4-PREP — `conditionLabel` se compone **EN EL BACK** (⛔ no en el front) para no repetir la
 * lógica `graded/raw/sealed` en cada cliente. Precedencia, en este orden:
 *
 * 1. `gradingCompany` + `gradeValue` ⇒ `"PSA 9"` — hacen falta **los dos**: una gradeada a medio
 *    capturar no dice «PSA» a secas, cae al siguiente escalón.
 * 2. `rawCondition` ⇒ `"NM"`.
 * 3. `sealedCondition` ⇒ etiqueta legible (`SEALED_CONDITION_LABELS`).
 *
 * Cadena vacía si la pieza no tiene ninguna de las tres (fila incompleta): el contrato declara
 * `conditionLabel: string` y esta cola no es el sitio donde se descubre una captura a medias.
 */
export function conditionLabelOf(item: {
  gradingCompany: InventoryItem['gradingCompany'];
  gradeValue: string | null;
  rawCondition: InventoryItem['rawCondition'];
  sealedCondition: SealedCondition | null;
}): string {
  if (item.gradingCompany && item.gradeValue) return `${item.gradingCompany} ${item.gradeValue}`;
  if (item.rawCondition) return item.rawCondition;
  if (item.sealedCondition) return SEALED_CONDITION_LABELS[item.sealedCondition];
  return '';
}

/**
 * §M4-PREP / CA #11 — estado + su etiqueta. ⛔ `"UNASSIGNED"` ya no viaja por el cable.
 *
 * ⭐ **v1.78.2 — el blanco se enruta a `unassigned`, no a un `assigned` sin etiqueta.** La pregunta
 * que esta hoja contesta es *«¿hay sitio al que caminar?»*, y una etiqueta en blanco responde que
 * **no** exactamente igual que la ausencia de fila. Es lo que mi propio comentario ya admitía sin
 * darse cuenta cuando decía que esa carta ordena al final *«exactamente igual de no-caminable»*:
 * si se ordena igual y se lee igual, **es el mismo estado**, y tener dos nombres para él solo
 * obliga a cada consumidor a saberlo. ⛔ No se acuña un tercer `kind`.
 *
 * ⭐ `nullIfBlank` **sigue siendo necesario aquí** (no se tira con el cambio de destino): es lo que
 * distingue «etiqueta» de «hueco», y sin él `label: "  "` volvería al cable como cuarta grafía de
 * la ausencia — que es `B-1` otra vez. Lo que cambia es **a dónde enruta**, no que haga falta.
 */
export function locationViewOf(location: VaultLocation | null): LocationView {
  const label = location ? nullIfBlank(location.label) : null;
  return label === null ? { kind: 'unassigned' } : { kind: 'assigned', label };
}

/** Lo que `preparationCardOf` lee de la pieza: su carta (+set) y los tres ejes de condición. */
export type PreparationCardSource = {
  finish: Finish;
  gradingCompany: InventoryItem['gradingCompany'];
  gradeValue: string | null;
  rawCondition: InventoryItem['rawCondition'];
  sealedCondition: SealedCondition | null;
  card: { name: string; imageSmallUrl: string | null; set: { name: string } | null };
};

/** El objeto de §M4-PREP: la carta de una línea de preparación. `PreparationCardDTO` para las dos cubetas y la vista física. */
export interface PreparationCardDTO {
  name: string;
  setName: string | null;
  finish: Finish;
  /** Compuesta EN EL BACK por precedencia (ver `conditionLabelOf`). */
  conditionLabel: string;
  imageSmallUrl: string | null;
}

/**
 * §M4-PREP — la identidad de catálogo de la carta, UN cuerpo para `ship`, `vault` y la vista física
 * (§M4-VAULT.3/.11: *«el MISMO objeto de §M4-PREP»*).
 */
export function preparationCardOf(item: PreparationCardSource): PreparationCardDTO {
  return {
    name: item.card.name,
    // El SET, prominente para ENVÍO: mapea a la carpeta por set del archivero.
    // ⭐ `nullIfBlank` — este campo es el que el orquestador cazó: mutar `?? null` a `?? ''`
    // **sobrevivía a las 5611 unitarias**. Es la misma clase que `B-1` sentada en el campo de al
    // lado, sin candado. Ahora la cierra el helper y la vigila el censo de blancos.
    setName: nullIfBlank(item.card.set?.name),
    finish: item.finish,
    conditionLabel: conditionLabelOf(item),
    // Una URL en blanco es una imagen que no existe, y se dice con la misma grafía que las
    // demás ausencias. (Antes pasaba directa: `null` desde el catálogo sí, `''` también.)
    imageSmallUrl: nullIfBlank(item.card.imageSmallUrl),
  };
}
