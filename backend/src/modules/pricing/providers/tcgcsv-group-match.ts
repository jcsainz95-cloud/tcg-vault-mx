import { TcgcsvGroupRef } from '../pricing.types';
import { setNameCandidates } from '../ppt-set-mapper.service';

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
 * ⚠️ **PENDIENTE DECLARADO, no olvido:** hoy sólo la consume el provider de PRECIO
 * (`TcgcsvSinglesBulkPriceProvider`). `CardProductResolverService.resolveGroupId` **conserva su
 * copia** porque ese fichero estaba siendo editado por otro pase en paralelo cuando se hizo este
 * cambio, y dos agentes sobre el mismo fichero es exactamente lo que la propiedad de archivos de
 * `CLAUDE.md` existe para evitar. La adopción allí es un follow-up de UNA línea (sustituir el bloque
 * por `matchTcgcsvGroupByName`) y está anotada en `docs/BACKEND_NOTES.md`; hasta entonces, la ruta de
 * ESTRUCTURA sigue teniendo el mismo defecto que esta ruta ya no tiene. *Se dice en vez de
 * arreglarse a medias.*
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
 *     (vía `setNameCandidates`: `"SV08: Pitch Black"` ⇒ `['sv08pitchblack','pitchblack']`). **Es el
 *     peldaño nuevo.**
 *  3. **`contains`** — contención bidireccional del nombre completo. Idéntico al peldaño 2 de antes;
 *     se conserva como red para nombres que difieren por más que el prefijo.
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
 * algoritmo viejo. Los peldaños quedan **anidados** (`1 ⊆ 2 ⊆ 3`) —el peldaño 1 es el de antes, y
 * empatar módulo un prefijo de un solo lado implica contención— así que sólo puede pasar
 * `null → groupId` (un set congelado vuelve a repreciarse). ⛔ Nunca `groupId → null` (perder un set
 * que funcionaba) ni `groupId → OTRO groupId` (repreciar un set con los precios de otro).
 */

/** Peldaño de la escalera por el que se resolvió el match (observabilidad; no gobierna dinero). */
export type TcgcsvGroupMatchTier = 'exact' | 'exact_unprefixed' | 'contains';

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

/** Normaliza un nombre de grupo/set para el match S-D3: minúsculas, solo alfanuméricos. */
function normalizeGroupName(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
