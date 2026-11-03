// scripts/ids/ids-lib.mjs — funciones PURAS de la corrida en seco IDS-D1/IDS-D2 (API_CONTRACT §IDS.3).   · devops
//
// Alineado con la errata v1.116.2 (llave del lado del catálogo: `catalogMatchKey`) el 2026-11-03.
// ⚠️ Es un INSTRUMENTO de medición, no el código de producción. La regla que manda es la de
// API_CONTRACT §IDS.3; backend la implementa en `price-ingest` (paso stamped). Aquí se replica para medir
// ANTES de construir, y cada decisión de lectura que el contrato deja abierta va marcada «LECTURA DEVOPS»:
// si backend la resuelve distinto, el número cambia y hay que volver a correr esto.
// Sin red, sin BD, sin dependencias. Prueba: `node --test scripts/ids/ids-lib.test.mjs`.

/** Grupos TCGCSV fuente de productos de liga (constante del contrato IDS.3) y los de IDS-D2. */
export const STAMPED_SOURCE_GROUPS = [22880, 1539];
export const PROMO_STAMP_GROUPS = [22872, 24451];

/** Réplica de `TCGCSV_SUBTYPE_TO_FINISH` (backend/src/modules/pricing/pricing.types.ts:434). */
const SUBTYPE_TO_FINISH = {
  normal: 'normal',
  holofoil: 'holofoil',
  reverseholofoil: 'reverse_holo',
  '1steditionholofoil': 'first_edition_holofoil',
};
export function finishOf(subTypeName) {
  if (typeof subTypeName !== 'string') return null;
  return SUBTYPE_TO_FINISH[subTypeName.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null;
}

/** Réplica de `classifyCardProductKind` (tcgcsv-singles.provider.ts:139): el universo del empate es set_base|other. */
export function classifyCardProductKind(name) {
  const s = (name ?? '').toLowerCase();
  if (s.trim() === '') return 'other';
  if (s.includes('deck exclusive')) return 'deck_exclusive';
  if (/\b(promo|staff|league|prerelease|pre-release|jumbo)\b/.test(s)) return 'promo';
  return 'set_base';
}

/** Etiquetas entre paréntesis y corchetes, en orden: «X (League Cup) [Staff]» ⇒ ['League Cup', 'Staff']. */
export function tagsOf(name) {
  return [...String(name ?? '').matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Número normalizado: cada lado del «/» sin ceros a la izquierda si es numérico, si no en mayúsculas.
 * «057/191» ≡ «57/191»; «TG01/TG30» ⇒ «TG01/TG30». `null` si vacío.
 */
export function normalizeNumber(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  return s
    .split('/')
    .map((p) => {
      const t = p.trim();
      return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t.toUpperCase();
    })
    .join('/');
}

/**
 * Nombre de empate. LECTURA DEVOPS: el contrato dice «nombre sin (…)/[…]», pero TCGCSV mete el número en
 * el nombre con o sin guion («Pikachu ex - 057/191», «Shelmet 11/101 (Championship Series)», y en 1539
 * sin ceros: «Butterfree FB - 17/147» con Number «017/147»). Se quitan paréntesis, corchetes y el token
 * final con forma de número; después minúsculas, sin acentos, solo alfanuméricos.
 */
export function baseName(name) {
  let s = String(name ?? '').replace(/[([][^)\]]*[)\]]/g, ' ');
  s = s.replace(/\s*-?\s*[A-Za-z]{0,4}\d+[A-Za-z]?\s*\/\s*[A-Za-z]{0,4}\d+[A-Za-z]?\s*$/, ' '); // «… 11/101», «… - 057/191»
  s = s.replace(/\s+-\s*[A-Za-z]{0,6}\d+[A-Za-z]?\s*$/, ' '); // promos: «Quaquaval - 005», «Pikachu - XY202»
  s = s.replace(/\s+-\s*$/, ' ');
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** `baseMatchKey` (IDS.3): nombre normalizado | Number completo normalizado. `null` sin Number ⇒ fuera. */
export function baseMatchKey(name, number) {
  const n = normalizeNumber(number);
  if (n == null) return null;
  const b = baseName(name);
  if (b === '') return null;
  return `${b}|${n}`;
}

/**
 * `stampTypeOf(groupId, name)` (IDS.3). 22880 ⇒ prize_pack siempre. Resto, por etiqueta, fallando cerrado.
 * LECTURA DEVOPS (el contrato no fija precedencia): staff > prerelease > championship > league, porque
 * «(League Cup) [Staff]» y «(Regional Championships) [Staff]» existen en 1539 y el contrato lista «[Staff]»
 * como tipo propio; y «Championship» se mira antes que «League» por «(League) … Championship» (0 casos medidos,
 * pero así nunca se rotula «De liga» un campeonato — D-6 v3).
 */
export function stampTypeOf(groupId, name) {
  if (groupId === 22880) return 'prize_pack';
  const tags = tagsOf(name);
  const any = (re) => tags.some((t) => re.test(t));
  if (any(/^staff$/i) || any(/\bstaff\b/i)) return 'staff';
  if (any(/\bpre-?release\b/i)) return 'prerelease';
  if (any(/\bchampionships?\b|\bregional\b|\binternational\b|\bworlds?\b/i)) return 'championship';
  if (any(/\bleague\b/i)) return 'league';
  return null;
}

export const isCosmos = (name) => /cosmos\s*holo/i.test(String(name ?? ''));

/** Número COMPLETO (con total) al final del nombre, con o sin guion («Pikachu ex - 057/191», «Shelmet 11/101»), o null.
 *  Réplica de `numberFromProductName` (backend/src/common/card-version.ts): «- 005» (sin total) NO se lee del nombre. */
export function numberFromProductName(name) {
  const s = String(name ?? '').replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /\s*-?\s*([A-Za-z]{0,6}\d+[A-Za-z]?\s*\/\s*[A-Za-z]{0,6}\d+[A-Za-z]?)\s*$/.exec(s);
  return m ? m[1].replace(/\s+/g, '') : null;
}

/**
 * Llave del LADO DEL CATÁLOGO (errata v1.116.2, API_CONTRACT §IDS.3; réplica de `catalogMatchKey` de card-version.ts):
 * el número del NOMBRE del producto solo si trae total; si no, `Card.number` + '/' + `CardSet.printedTotal`; ninguno ⇒ null.
 * ⛔ Nunca por un número sin total.
 */
export function catalogMatchKey({ name, cardNumber, printedTotal }) {
  const fromName = numberFromProductName(name);
  if (fromName) return baseMatchKey(name, fromName);
  if (cardNumber && printedTotal != null && printedTotal > 0) return baseMatchKey(name, `${cardNumber}/${printedTotal}`);
  return null;
}

/**
 * `Card.number` que tendría en el catálogo el producto TCGCSV: la parte de su `Number` antes del «/» («017/147» ⇒ «017»;
 * «17» ⇒ «17»). LECTURA DEVOPS: el instrumento no tiene la tabla Card; pokemontcg.io numera igual salvo ceros, que
 * `normalizeNumber` iguala. Sin `Number` ⇒ null.
 */
export const cardNumberOf = (number) => {
  const s = String(number ?? '').trim();
  return s === '' ? null : s.split('/')[0].trim() || null;
};

/**
 * Índice del universo base (lado del catálogo): key ⇒ [{productId, groupId, cardKey}] con los productos set_base|other.
 * `groups[i].printedTotal` = `CardSet.printedTotal` del set de pokemontcg.io que la escalera empata con ese grupo (o null).
 * `cardKey` aproxima `Card.id` (grupo + número normalizado): el backend cuenta CARTAS distintas por llave, no productos
 * (`buildCatalogIndex`: key ⇒ Set<cardId>), así que dos productos de la misma carta (p. ej. «(Poke Ball Pattern)») no
 * hacen ambiguo. LECTURA DEVOPS: el instrumento no tiene `CardProduct.cardId`.
 */
export function buildBaseIndex(groups) {
  const idx = new Map();
  for (const { groupId, products, printedTotal = null } of groups) {
    for (const p of products) {
      const kind = classifyCardProductKind(p.name);
      if (kind !== 'set_base' && kind !== 'other') continue;
      const cardNumber = cardNumberOf(p.number);
      const k = catalogMatchKey({ name: p.name, cardNumber, printedTotal });
      if (k == null) continue;
      const cardKey = cardNumber != null ? `${groupId}:${normalizeNumber(cardNumber)}` : `${groupId}:p${p.productId}`;
      const list = idx.get(k) ?? [];
      list.push({ productId: p.productId, groupId, cardKey });
      idx.set(k, list);
    }
  }
  return idx;
}

/** Candidatos distintos por carta (como el backend), conservando el primer producto de cada una. */
export function distinctCards(cands) {
  const seen = new Map();
  for (const c of cands) if (!seen.has(c.cardKey ?? c.productId)) seen.set(c.cardKey ?? c.productId, c);
  return [...seen.values()];
}

/**
 * Corrida en seco de IDS.3 para un grupo fuente. `products` = [{productId, name, number}];
 * `pricesByProduct` = Map productId ⇒ [{subTypeName, marketPrice}].
 * Devuelve el log del contrato {colgados, ambiguos, sinPareja, sinTipo, conPrecio} + `sinNumero` y el detalle.
 */
export function dryRunGroup(groupId, products, pricesByProduct, baseIndex) {
  const out = { grupo: groupId, total: products.length, sinNumero: 0, sinTipo: 0, colgados: 0, ambiguos: 0, sinPareja: 0, conPrecio: 0 };
  const detail = [];
  for (const p of products) {
    const key = baseMatchKey(p.name, p.number);
    if (key == null) { out.sinNumero += 1; detail.push({ ...p, result: 'sinNumero' }); continue; }
    const type = stampTypeOf(groupId, p.name);
    if (type == null) { out.sinTipo += 1; detail.push({ ...p, key, result: 'sinTipo' }); continue; }
    const cands = distinctCards(baseIndex.get(key) ?? []);
    const rows = pricesByProduct.get(p.productId) ?? [];
    const finishes = [...new Set(rows.map((r) => finishOf(r.subTypeName)).filter(Boolean))];
    const priced = rows.filter((r) => finishOf(r.subTypeName) && r.marketPrice != null && r.marketPrice > 0).length;
    const base = { ...p, key, type, finishes, subTypes: rows.map((r) => r.subTypeName), cands };
    if (cands.length === 1) {
      out.colgados += 1;
      out.conPrecio += priced;
      detail.push({ ...base, result: 'colgado', baseProductId: cands[0].productId, baseCardKey: cands[0].cardKey });
    } else if (cands.length >= 2) {
      out.ambiguos += 1;
      detail.push({ ...base, result: 'ambiguo' });
    } else {
      out.sinPareja += 1;
      detail.push({ ...base, result: 'sinPareja' });
    }
  }
  return { summary: out, detail };
}

/** Percentil por rango más cercano (nearest-rank), sobre enteros. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * s.length);
  return s[Math.max(0, rank - 1)];
}

// ---------------------------------------------------------------------------------------------------
// Réplica de la escalera set local ↔ grupo TCGCSV (backend/src/modules/pricing/providers/tcgcsv-group-match.ts
// y setNameCandidates de ppt-set-mapper.service.ts:178-196). Solo para acotar el universo «catálogo» de la
// medición (universo B); si backend cambia la escalera, este universo se re-mide.
export const normalizeSetName = (n) => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function setNameCandidates(n) {
  const full = normalizeSetName(n);
  const stripped = normalizeSetName(String(n ?? '').replace(/^\s*[A-Za-z0-9]{1,6}\s*:\s*/, ''));
  return stripped !== '' && stripped !== full ? [full, stripped] : [full];
}
function moduloOnePrefix(local, groupName) {
  const remote = setNameCandidates(groupName).filter((s) => s !== '');
  if (remote.length === 0) return false;
  if (local[0] === remote[0]) return true;
  const lp = local.length > 1, rp = remote.length > 1;
  if (lp === rp) return false;
  return (lp ? local[1] : local[0]) === (rp ? remote[1] : remote[0]);
}
function debased(localFull, groupName) {
  for (const c of setNameCandidates(groupName)) { const d = c.replace(/baseset$/, ''); if (d !== '' && d !== c && d === localFull) return true; }
  return false;
}
/** groupId si el empate es ÚNICO en el primer peldaño con candidatos; si no, null (como el backend). */
export function matchGroupForSet(setName, groups) {
  const t = setNameCandidates(setName).filter((s) => s !== '');
  if (t.length === 0) return null;
  const tiers = [
    groups.filter((g) => normalizeSetName(g.name) === t[0]),
    groups.filter((g) => moduloOnePrefix(t, g.name)),
    groups.filter((g) => debased(t[0], g.name)),
    groups.filter((g) => { const gn = normalizeSetName(g.name); return gn !== '' && (gn.includes(t[0]) || t[0].includes(gn)); }),
  ];
  for (const m of tiers) { if (m.length === 0) continue; return m.length === 1 ? m[0].groupId : null; }
  return null;
}

/** Filas de liga por carta colgada (producto stamped × acabado), D-IDS-O. */
export function rowsPerBase(detailRows) {
  const m = new Map();
  for (const d of detailRows) {
    if (d.result !== 'colgado') continue;
    const k = d.baseCardKey ?? d.baseProductId; // por carta, como la ficha (D-IDS-O)
    m.set(k, (m.get(k) ?? 0) + Math.max(d.finishes.length, 0));
  }
  return m;
}
