import { TcgcsvGroupRef } from '../pricing.types';
import { normalizeSetName, setNameCandidates } from '../ppt-set-mapper.service';
import { promoGroupFor } from '../../catalog/promo-set-groups';

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
  const t = ladderTier(setName, groups);
  if (t === 'empty') return { groupId: null, failure: 'empty_name', candidates: 0, candidateNames: [] };
  if (t === null) return { groupId: null, failure: 'no_match', candidates: 0, candidateNames: [] };
  if (t.matches.length === 1) return { groupId: t.matches[0].groupId, tier: t.tier, candidates: 1 };
  // Peldaño con candidatos pero AMBIGUO ⇒ se para aquí (money-safe: no se relaja el criterio).
  return {
    groupId: null,
    failure: 'ambiguous',
    candidates: t.matches.length,
    candidateNames: t.matches.slice(0, MAX_REPORTED_CANDIDATES).map((g) => g.name),
  };
}

/** El primer peldaño de la escalera con algún candidato (`null` = ninguno; `'empty'` = el nombre normaliza a vacío). Base de `matchTcgcsvGroupByName` y de B3. */
export function ladderTier(setName: string, groups: readonly TcgcsvGroupRef[]): { tier: TcgcsvGroupMatchTier; matches: TcgcsvGroupRef[] } | null | 'empty' {
  const targets = setNameCandidates(setName).filter((s) => s !== '');
  if (targets.length === 0) return 'empty';
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

  for (const t of tiers) if (t.matches.length > 0) return t;
  return null;
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

// ============================ §AUTO-ENLACE fase 3 — B3 (mapeo set → grupo) ============================
//
// B3 se CONSTRUYE ENCIMA de la escalera de arriba y SOLO añade resultados: si la escalera ya resolvía un grupo ÚNICO, B3 ni se mira
// (monotonía: jamás `groupId → OTRO groupId`). Solo convierte `ambiguous`/`no_match` en un grupo cuando una regla DERIVADA de los datos
// de TCGCSV y del set lo deja en UNO; si no, devuelve candidatos y no adivina. Reglas (DECISIONES §AUTO-ENLACE 6):
//  (i)   «&» ≡ «and», acentos, puntuación y mayúsculas.
//  (ii)  prefijos de código «XX -»/«SV08:» fuera, de UN solo lado (dos prefijos DISTINTOS = dos colecciones).
//  (iii) familias derivables: «McDonald's … AAAA» ⇒ el grupo con la marca y el mismo año; prefijo de serie («EX Dragon» ⇔ «Dragon» con serie EX);
//        base de era («Sun & Moon» ⇔ «SM Base Set»).
//  (iv)  empate ⇒ fecha: `publishedOn` del grupo vs `releaseDate` del set (≤ 45 días); se acepta solo si queda UNO.
//        (El desempate por nº de productos vs `printedTotal` necesita `getProducts` por candidato: `listGroups` no trae conteos ⇒ no se hace aquí;
//        el caso queda como excepción con candidatos.)
//  (v)   tabla curada SOLO para el residuo irreductible (cada fila con su prueba).

export interface B3SetInfo {
  name: string;
  series?: string | null;
  releaseDate?: string | null;
  externalId?: string | null;
}

/** Tabla curada de residuo irreductible (sin regla derivable). Cada fila lleva su prueba en `test/auto-link-b3.spec.ts`. Quitarla es el rollback. */
export const B3_RESIDUE_GROUPS: readonly { ptcgSetId: string; groupId: number; note: string }[] = [
  { ptcgSetId: 'basep', groupId: 1418, note: 'Wizards Black Star Promos ⇒ «WoTC Promo» (1999-07-01 = 1999/07/01)' },
  { ptcgSetId: 'np', groupId: 1423, note: 'Nintendo Black Star Promos ⇒ «Nintendo Promos»' },
  { ptcgSetId: 'hsp', groupId: 1453, note: 'HGSS Black Star Promos ⇒ «HGSS Promos»' },
  { ptcgSetId: 'bp', groupId: 1455, note: 'Best of Game ⇒ «Best of Promos» (2002-12-01 = 2002/12/01)' },
  { ptcgSetId: 'tk1a', groupId: 1543, note: 'EX Trainer Kit Latias ⇒ «EX Trainer Kit 1: Latias & Latios»' },
  { ptcgSetId: 'tk1b', groupId: 1543, note: 'EX Trainer Kit Latios ⇒ «EX Trainer Kit 1: Latias & Latios»' },
  { ptcgSetId: 'tk2a', groupId: 1542, note: 'EX Trainer Kit 2 Plusle ⇒ «EX Trainer Kit 2: Plusle & Minun»' },
  { ptcgSetId: 'tk2b', groupId: 1542, note: 'EX Trainer Kit 2 Minun ⇒ «EX Trainer Kit 2: Plusle & Minun»' },
];

/** Nombre → [completo, sin prefijo de código] (si lo trae). «&»≡«and»; el prefijo es `XX:`/`XX -` de hasta 6 caracteres alfanuméricos. */
export function b3NameKeys(raw: string | null | undefined): string[] {
  const base = (raw ?? '').replace(/&/g, ' and ');
  const full = normalizeSetName(base);
  const stripped = normalizeSetName(base.replace(/^\s*[A-Za-z0-9]{1,6}\s*[:\-–]\s*/, ''));
  return stripped !== '' && stripped !== full ? [full, stripped] : [full];
}

function matchModuloOnePrefix(local: string[], remote: string[]): boolean {
  if (local[0] === '' || remote[0] === '') return false;
  if (local[0] === remote[0]) return true;
  const lp = local.length > 1;
  const rp = remote.length > 1;
  if (lp === rp) return false; // ambos o ninguno con prefijo ⇒ ya lo decidió el nombre completo
  return (lp ? local[1] : local[0]) === (rp ? remote[1] : remote[0]);
}

function parseDay(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw.replace(/\//g, '-'));
  return Number.isFinite(t) ? t : null;
}

const DAY_MS = 86_400_000;
export const B3_DATE_WINDOW_DAYS = 45;
function withinDays(set: B3SetInfo, g: TcgcsvGroupRef, days: number): boolean {
  const a = parseDay(set.releaseDate);
  const b = parseDay(g.publishedOn);
  return a != null && b != null && Math.abs(a - b) <= days * DAY_MS;
}

export type B3Tier = 'residue' | 'date' | 'amp_and_prefix' | 'series_prefix' | 'era_base' | 'mcdonalds';

function yearOf(raw: string | null | undefined): string | null {
  return /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(raw ?? '')?.[1] ?? null;
}

/**
 * B3 puro (sin red): `{groupId, tier}` si una regla deja UN grupo; `null` si no. Se llama SOLO cuando la escalera no resolvió.
 * `ladder` = lo que la escalera encontró (`ambiguous` con sus candidatos completos) para el desempate por fecha.
 */
export function resolveGroupB3(set: B3SetInfo, groups: readonly TcgcsvGroupRef[]): { groupId: number; tier: B3Tier } | null {
  const one = (m: TcgcsvGroupRef[], tier: B3Tier): { groupId: number; tier: B3Tier } | null => (m.length === 1 ? { groupId: m[0].groupId, tier } : null);
  // (v) residuo curado: solo si el grupo SIGUE existiendo en TCGCSV.
  const res = B3_RESIDUE_GROUPS.find((r) => r.ptcgSetId === set.externalId);
  if (res && groups.some((g) => g.groupId === res.groupId)) return { groupId: res.groupId, tier: 'residue' };

  const local = b3NameKeys(set.name);
  if (local[0] === '') return null;

  // (iv) empate de la escalera ⇒ fecha ≤ 45 días, solo si queda UNO.
  const lad = ladderTier(set.name, groups);
  // Peldaños de IGUALDAD: se desempata por fecha. Peldaño de CONTENCIÓN: solo candidatos más CORTOS que el nombre local (el grupo «Expedition» dentro
  // de «Expedition Base Set»); uno más largo («Evolutions Deck» ⊃ «Evolutions») + fecha cercana no basta para ligar.
  if (lad && lad !== 'empty' && lad.matches.length > 1) {
    const pool = lad.tier === 'contains' ? lad.matches.filter((g) => local[0].includes(b3NameKeys(g.name)[0])) : lad.matches;
    const r = one(pool.filter((g) => withinDays(set, g, B3_DATE_WINDOW_DAYS)), 'date');
    if (r) return r;
  }

  // (i)+(ii) «&»≡«and» y prefijos «XX -»/«XX:» de un solo lado.
  const amp = groups.filter((g) => matchModuloOnePrefix(local, b3NameKeys(g.name)));
  const ampOne = one(amp, 'amp_and_prefix') ?? (amp.length > 1 ? one(amp.filter((g) => withinDays(set, g, B3_DATE_WINDOW_DAYS)), 'date') : null);
  if (ampOne) return ampOne;

  // (iii-a) McDonald's: marca + año (del nombre; si no, del `releaseDate`); el grupo trae el mismo año en el nombre, o no trae año y se publicó ese año.
  if (local[0].includes('mcdonalds')) {
    const y = yearOf(set.name) ?? yearOf(set.releaseDate);
    if (y) {
      const brand = groups.filter((g) => normalizeSetName(g.name).includes('mcdonalds'));
      const named = brand.filter((g) => yearOf(g.name) === y);
      const r = one(named, 'mcdonalds') ?? (named.length === 0 ? one(brand.filter((g) => yearOf(g.name) == null && (g.publishedOn ?? '').startsWith(y)), 'mcdonalds') : null);
      if (r) return r;
    }
  }

  // (iii-b) prefijo de serie: «EX Dragon» ⇔ «Dragon» con serie «EX».
  const seriesKey = normalizeSetName((set.series ?? '').replace(/&/g, ' and '));
  if (seriesKey.length >= 2) {
    const sp = groups.filter((g) => {
      const k = b3NameKeys(g.name);
      return k.some((x) => x.startsWith(seriesKey) && x.length > seriesKey.length && x.slice(seriesKey.length) === local[0]);
    });
    const r = one(sp, 'series_prefix');
    if (r) return r;
    // (iii-c) base de era: el set se llama como su serie ⇒ «<iniciales> Base Set» («Sun & Moon» ⇒ «SM Base Set»).
    if (local[0] === seriesKey) {
      const initials = (set.series ?? '').replace(/&/g, ' ').split(/\s+/).filter((w) => w && w.toLowerCase() !== 'and').map((w) => w[0].toLowerCase()).join('');
      if (initials.length >= 2) {
        const r2 = one(groups.filter((g) => b3NameKeys(g.name).includes(`${initials}baseset`)), 'era_base');
        if (r2) return r2;
      }
    }
  }
  return null;
}

export interface GroupCandidate {
  groupId: number;
  name: string;
  publishedOn: string | null;
  productCount: number | null;
  score: number;
}

/** Candidatos (máx. 5, mejor primero) para la lista de excepciones. Puntaje 0..100 = parecido de palabras (60) + contención (15) + cercanía de fecha (25). Sin red. */
export function scoreGroupCandidates(set: B3SetInfo, groups: readonly TcgcsvGroupRef[], limit = 5): GroupCandidate[] {
  const words = (raw: string): Set<string> => new Set(raw.replace(/&/g, ' and ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean));
  const lw = words(set.name);
  const lkey = b3NameKeys(set.name);
  const out: GroupCandidate[] = [];
  for (const g of groups) {
    const gw = words(g.name);
    const inter = [...lw].filter((w) => gw.has(w)).length;
    const union = new Set([...lw, ...gw]).size || 1;
    let score = Math.round((inter / union) * 60);
    const gk = b3NameKeys(g.name);
    if (gk.some((k) => lkey.some((l) => l !== '' && k !== '' && (k.includes(l) || l.includes(k))))) score += 15;
    const a = parseDay(set.releaseDate);
    const b = parseDay(g.publishedOn);
    if (a != null && b != null) {
      const d = Math.abs(a - b) / DAY_MS;
      score += d <= B3_DATE_WINDOW_DAYS ? 25 : d <= 365 ? 10 : 0;
    }
    if (score >= 30) out.push({ groupId: g.groupId, name: g.name, publishedOn: g.publishedOn ? g.publishedOn.slice(0, 10) : null, productCount: null, score: Math.min(100, score) });
  }
  return out.sort((x, y) => y.score - x.score || x.groupId - y.groupId).slice(0, limit);
}

/**
 * P-PROMOS-VIEJAS (ARCHITECTURE §5.13) — ÚNICA función que decide el grupo TCGCSV de un set local, compartida por
 * `CardProductResolverService.resolveGroupId` (estructura) y `TcgcsvSinglesBulkPriceProvider.resolveGroupId` (precio).
 * PRECEDENCIA: (1) tabla fija `PTCG_PROMO_GROUPS` por `externalId`; (2) `pptSetId` numérico; (3) nombre
 * (`matchTcgcsvGroupByName`, último recurso). La tabla gana incluso si PPT escribió otro id (1400/1430 son sets base).
 * `listGroups` solo se llama si se llega al peldaño 3.
 */
export async function resolveTcgcsvGroupForSet(
  set: {
    name: string;
    pptSetId: string | null;
    externalId?: string | null;
    series?: string | null;
    releaseDate?: string | null;
    /** §AUTO-ENLACE fase 3: grupo de CARTAS guardado en el set; solo `confirmed` manda, `auto` es informativo (se recalcula). */
    cardGroupId?: number | null;
    cardGroupVia?: string | null;
  },
  listGroups: () => Promise<readonly TcgcsvGroupRef[]>,
): Promise<{ groupId: number; via: 'promo_table' | 'confirmed' | 'ppt_set_id' | 'name' | 'b3' } | Extract<TcgcsvGroupMatch, { groupId: null }>> {
  const promo = promoGroupFor(set.externalId);
  if (promo) return { groupId: promo.groupId, via: 'promo_table' };
  // Precedencia (contrato §6): tabla de promos > confirmado > regla automática > `pptSetId` numérico > nombre. Dos matices declarados:
  // `pptSetId` va ANTES del nombre/B3 (monotonía: un set ya resuelto por PPT no se mueve de grupo), y un confirmado cuyo grupo ya no existe
  // en `listGroups` NO cae a otra fuente: devuelve `no_match` ⇒ motivo `group_none` y vuelve a la lista.
  if (set.cardGroupVia === 'confirmed' && set.cardGroupId != null) {
    const groups = await listGroups();
    if (groups.some((g) => g.groupId === set.cardGroupId)) return { groupId: set.cardGroupId, via: 'confirmed' };
    return { groupId: null, failure: 'no_match', candidates: 0, candidateNames: [] };
  }
  if (set.pptSetId && /^\d+$/.test(set.pptSetId)) return { groupId: parseInt(set.pptSetId, 10), via: 'ppt_set_id' };
  const groups = await listGroups();
  const match = matchTcgcsvGroupByName(set.name, groups);
  if (match.groupId != null) return { groupId: match.groupId, via: 'name' };
  const b3 = resolveGroupB3(set, groups);
  if (b3) return { groupId: b3.groupId, via: 'b3' };
  return match;
}
