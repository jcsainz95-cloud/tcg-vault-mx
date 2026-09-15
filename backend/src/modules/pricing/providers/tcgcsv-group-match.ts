import { TcgcsvGroupRef } from '../pricing.types';
import { normalizeSetName, setNameCandidates } from '../ppt-set-mapper.service';

/**
 * Match `CardSet` local ↔ **grupo de TCGCSV** por NOMBRE (paso 2 de S-D3 / ARCHITECTURE §4.27d).
 *
 * ## Por qué existe este archivo (QA IMPORTANTE-3, P-47)
 *
 * La misma escalera de match vivía **copiada literalmente** en dos sitios —
 * `CardProductResolverService.resolveGroupId` (estructura, import/`--force`) y
 * `TcgcsvSinglesBulkPriceProvider.resolveGroupId` (**precio**, barrido diario)— pese a que
 * ARCHITECTURE las declara *«la misma lógica S-D3/§4.27d»*. Dos copias de una regla que el documento
 * afirma que es UNA es exactamente el terreno donde un arreglo se aplica en un lado y no en el otro:
 * es lo que pasó con el **prefijo de código de colección** (P-46), que se arregló en el mapeo de PPT
 * (`setNameCandidates`, `matchSet`) y en el sellado (`SealedProductService.matchScore`) pero **no**
 * aquí. Ahora la regla vive en UN sitio.
 *
 * ✅ **PENDIENTE CERRADO (2026-09-10):** la consumen **las DOS** rutas —
 * `TcgcsvSinglesBulkPriceProvider.resolveGroupId` (PRECIO, barrido diario) y
 * `CardProductResolverService.resolveGroupId` (ESTRUCTURA, import/`--force`). La copia que quedaba en
 * la ruta de estructura (el fichero estaba ocupado por otro pase cuando se extrajo esta escalera) ya
 * no existe: **no quedan dos implementaciones de esta regla**. La adopción se midió y se blindó con
 * su propia propiedad de monotonía en `test/card-product-resolver.spec.ts` — ver
 * `docs/BACKEND_NOTES.md` para las cifras y la única desviación declarada (nombres que normalizan a
 * vacío). ⚠️ Si aparece una tercera ruta que necesite este match, **llama a esta función**; copiarla
 * es cómo P-46 llegó a tres sitios y nunca al que movía dinero.
 *
 * ## El bug que cierra (dinero, y silencioso)
 *
 * TCGCSV nombra sus grupos **con prefijo** (`"SV08: Pitch Black"`); nuestro catálogo
 * (pokemontcg.io) **no** (`"Pitch Black"`). La versión anterior comparaba nombres normalizados con
 * `===` y, al no empatar nunca, caía a un `includes()` bidireccional. Ese `includes()` salvaba el
 * caso **mientras hubiera un solo candidato**; en cuanto TCGCSV publica un segundo grupo que también
 * contiene el nombre (`"Pitch Black Promos"`, `"Pitch Black Elite Trainer Box"`, …) había **DOS
 * candidatos ⇒ `null`** ⇒ el set entero **jamás se reprecia** y solo queda un `warn` en logs. No
 * inventa precios (eso sigue siendo cierto), pero **congela** los del set indefinidamente sin que
 * nadie se entere — que para el dueño es peor que un fallo ruidoso.
 *
 * ## La escalera (money-safe: sigue exigiendo match ÚNICO, nunca adivina)
 *
 * Se evalúa por PELDAÑOS y se usa **el primer peldaño con algún candidato**; si ese peldaño tiene más
 * de uno, se devuelve `null` **sin bajar al siguiente** (bajar sería relajar el criterio justo cuando
 * hay ambigüedad):
 *
 *  1. **`exact`** — igualdad del nombre normalizado COMPLETO en ambos lados. Idéntico al peldaño 1 de
 *     antes.
 *  2. **`exact_unprefixed`** — igualdad tolerando el prefijo de código **en UNO de los dos lados**
 *     (vía `setNameCandidates`: `"SV08: Pitch Black"` ⇒ `['sv08pitchblack','pitchblack']`). (P-47.)
 *  3. **`exact_debased`** — igualdad del nombre local COMPLETO contra el grupo remoto tras pelarle el
 *     prefijo **y** el sufijo descriptivo `Base Set` (`"SV01: Scarlet & Violet Base Set"` ⇒
 *     `"scarletviolet"` == local `"Scarlet & Violet"`). **Es el peldaño nuevo (P-46-bis).** Cierra la
 *     clase ENTERA de bases de era que quedaba sin precio: nombres cortos de era (`Scarlet & Violet`,
 *     `Sword & Shield`, `XY`) que eran subcadena de VARIOS grupos de su era (la base + los promos) y por
 *     eso caían al peldaño `contains` AMBIGUO ⇒ `null`. Compara contra el local COMPLETO y sólo pela el
 *     lado remoto, así que es una RESTRICCIÓN de `contains` (todo lo que empata aquí, `contains` lo
 *     incluía) ⇒ la monotonía se conserva: sólo `null → groupId`, jamás `groupId → OTRO`.
 *  4. **`contains`** — contención bidireccional del nombre completo. Idéntico al peldaño 2 de antes;
 *     se conserva como red para nombres que difieren por más que el prefijo/sufijo.
 *
 * ⚠️ **«En UNO de los dos lados» es una restricción DELIBERADA, y la propiedad de monotonía la
 * obligó** (la primera versión de este archivo no la tenía y el test la cazó). Si se pelan los dos
 * prefijos a la vez, `"SV08: Pitch Black"` y `"ME05: Pitch Black"` pasan a ser «el mismo nombre» —
 * y son, literalmente, **dos colecciones distintas**. Con ambos prefijos presentes y DISTINTOS no
 * hay match: el prefijo es información, no ruido; sólo se ignora cuando **un lado no lo trae**, que
 * es exactamente la asimetría real entre TCGCSV (prefija) y pokemontcg.io (no prefija).
 *
 * ⭐ **La escalera NO puede resolver MENOS que la versión anterior**, y se prueba como PROPIEDAD por
 * fuerza bruta en `test/tcgcsv-group-match.spec.ts` contra una reimplementación literal del
 * algoritmo viejo. Los peldaños quedan **anidados** (`1 ⊆ 2 ⊆ 3 ⊆ 4`) —el peldaño 1 es el de antes,
 * empatar módulo un prefijo de un solo lado implica contención, y empatar el local COMPLETO contra el
 * grupo pelado de su sufijo `Base Set` TAMBIÉN implica contención (el núcleo vive dentro del grupo)—
 * así que sólo puede pasar `null → groupId` (un set congelado vuelve a repreciarse). ⛔ Nunca
 * `groupId → null` (perder un set que funcionaba) ni `groupId → OTRO groupId` (repreciar con precios
 * de otro).
 */

/** Peldaño de la escalera por el que se resolvió el match (observabilidad; no gobierna dinero). */
export type TcgcsvGroupMatchTier = 'exact' | 'exact_unprefixed' | 'exact_debased' | 'contains';

/** Por qué NO se resolvió un `groupId` ÚNICO. Viaja a la señal visible (AuditLog), no solo al log. */
export type TcgcsvGroupMatchFailure =
  /** El nombre local normaliza a vacío (no hay nada con qué empatar). */
  | 'empty_name'
  /** Ningún grupo empató en ningún peldaño. */
  | 'no_match'
  /** El peldaño más estricto con candidatos tenía MÁS DE UNO ⇒ no se adivina. */
  | 'ambiguous';

export type TcgcsvGroupMatch =
  | { groupId: number; tier: TcgcsvGroupMatchTier; candidates: 1 }
  | { groupId: null; failure: TcgcsvGroupMatchFailure; candidates: number; candidateNames: string[] };

/** Cuántos nombres de candidatos se llevan a la señal (para no hinchar el `after` del AuditLog). */
const MAX_REPORTED_CANDIDATES = 5;

/**
 * Resuelve el grupo TCGCSV de un set por nombre. Devuelve el `groupId` SOLO si el match es ÚNICO en
 * el peldaño más estricto que tenga candidatos; si no, devuelve el motivo y los candidatos (para que
 * el llamador pueda dejar una señal que un humano vea sin abrir los logs).
 */
export function matchTcgcsvGroupByName(
  setName: string,
  groups: readonly TcgcsvGroupRef[],
): TcgcsvGroupMatch {
  const targets = setNameCandidates(setName).filter((s) => s !== '');
  if (targets.length === 0) {
    return { groupId: null, failure: 'empty_name', candidates: 0, candidateNames: [] };
  }
  const target = targets[0]; // el nombre COMPLETO normalizado (peldaños 1 y 3)

  const tiers: Array<{ tier: TcgcsvGroupMatchTier; matches: TcgcsvGroupRef[] }> = [
    {
      tier: 'exact',
      matches: groups.filter((g) => normalizeGroupName(g.name) === target),
    },
    {
      tier: 'exact_unprefixed',
      matches: groups.filter((g) => namesMatchModuloOnePrefix(targets, g.name)),
    },
    {
      // P-46-bis — pela ADEMÁS el sufijo descriptivo `Base Set` del GRUPO remoto (TCGplayer nombra las
      // bases de era `"SV01: Scarlet & Violet Base Set"`, `"XY Base Set"`), y empata contra el nombre
      // LOCAL COMPLETO (`target`). Sólo dispara para grupos que terminan en `Base Set`; para el resto es
      // inerte, por lo que McDonald's/EX Trainer Kit (sin ese sufijo) no ven ningún cambio.
      tier: 'exact_debased',
      matches: groups.filter((g) => debasedGroupMatchesFullLocal(target, g.name)),
    },
    {
      tier: 'contains',
      matches: groups.filter((g) => {
        const gn = normalizeGroupName(g.name);
        return gn !== '' && (gn.includes(target) || target.includes(gn));
      }),
    },
  ];

  for (const { tier, matches } of tiers) {
    if (matches.length === 0) continue;
    if (matches.length === 1) return { groupId: matches[0].groupId, tier, candidates: 1 };
    // Peldaño con candidatos pero AMBIGUO ⇒ se para aquí (money-safe: no se relaja el criterio).
    return {
      groupId: null,
      failure: 'ambiguous',
      candidates: matches.length,
      candidateNames: matches.slice(0, MAX_REPORTED_CANDIDATES).map((g) => g.name),
    };
  }
  return { groupId: null, failure: 'no_match', candidates: 0, candidateNames: [] };
}

/**
 * ¿Empatan los nombres ignorando el prefijo de código **de un solo lado**?
 *
 * `local` llega ya como sus candidatos (`[full]` o `[full, stripped]`; longitud 2 ⇔ trae prefijo).
 * Reglas, en orden:
 *  - nombres completos iguales ⇒ sí (incluye el caso «los dos prefijados con el MISMO prefijo»);
 *  - exactamente uno de los dos trae prefijo y, pelado ése, coinciden ⇒ sí;
 *  - los dos traen prefijo y son DISTINTOS ⇒ **no** (son dos colecciones distintas).
 */
function namesMatchModuloOnePrefix(localCandidates: string[], groupName: string): boolean {
  const remote = setNameCandidates(groupName).filter((s) => s !== '');
  if (remote.length === 0) return false;
  const localFull = localCandidates[0];
  const remoteFull = remote[0];
  if (localFull === remoteFull) return true;
  const localHasPrefix = localCandidates.length > 1;
  const remoteHasPrefix = remote.length > 1;
  if (localHasPrefix === remoteHasPrefix) return false; // ambos o ninguno ⇒ ya lo decidió el `full`
  const localKey = localHasPrefix ? localCandidates[1] : localFull;
  const remoteKey = remoteHasPrefix ? remote[1] : remoteFull;
  return localKey === remoteKey;
}

/**
 * ¿El grupo remoto, tras pelarle el prefijo de código Y el sufijo `Base Set`, es EXACTAMENTE el nombre
 * local COMPLETO? (peldaño `exact_debased`, P-46-bis).
 *
 * Se compara SIEMPRE contra `localFull` (el nombre local completo normalizado), NUNCA contra un local
 * "pelado", y ADEMÁS `localFull` es SIEMPRE subcadena del grupo normalizado completo (el núcleo vive
 * dentro del nombre del grupo). Esa doble restricción es la que preserva la MONOTONÍA money-safe: si
 * este peldaño empata un grupo `G`, entonces `contains` también lo habría incluido, así que sólo puede
 * convertir `null → groupId` (rescatar un set congelado), nunca `groupId → OTRO groupId`.
 *
 * Ejemplos: `"SV01: Scarlet & Violet Base Set"` ⇒ núcleo `"scarletviolet"` == local `"Scarlet &
 * Violet"`; `"XY Base Set"` ⇒ `"xy"` == local `"XY"`. En cambio `"Scarlet & Violet Black Star Promos"`
 * NO termina en `Base Set` ⇒ su núcleo es `"scarletvioletblackstarpromos"` ≠ `"scarletviolet"` ⇒ jamás
 * cruza (money-safe: la base nunca roba los precios de los promos).
 */
function debasedGroupMatchesFullLocal(localFull: string, groupName: string): boolean {
  if (localFull === '') return false;
  // Candidatos del grupo (completo y —si trae prefijo de código— sin él), a cada uno se le quita el
  // sufijo `baseset`. Sólo cuenta si el sufijo REALMENTE estaba (si no, este peldaño no aporta nada
  // que `exact`/`exact_unprefixed` no cubrieran ya).
  for (const cand of setNameCandidates(groupName)) {
    const debased = cand.replace(/baseset$/, '');
    if (debased !== '' && debased !== cand && debased === localFull) return true;
  }
  return false;
}

/**
 * Normaliza un nombre de grupo/set para el match S-D3. Delega en `normalizeSetName` (fuente ÚNICA) para
 * heredar el plegado de diacríticos (P-46-ter, `é`→`e`): minúsculas, sin marcas de acento, solo
 * alfanuméricos.
 */
function normalizeGroupName(raw: string | null | undefined): string {
  return normalizeSetName(raw);
}
