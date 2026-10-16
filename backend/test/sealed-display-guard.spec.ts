/**
 * sealed-display-guard.spec.ts — EL CANDADO MECÁNICO del bug de sellado-display (§4.34a.2).
 *
 * ### El bug y por qué un candado, no más grep a mano
 * Un producto **sellado** se pintaba como su **carta ancla** (p. ej. «Exeggcute») porque las
 * superficies de display leían `item.card.name` sin rama de sellado. El resolutor único
 * `pieceDisplayIdentityOf` (`src/common/piece-display-identity.ts`) ya existe y centraliza la regla
 * (nombre de sellado: `SealedProduct` vivo → snapshot → «Sellado sin identificar»; ⛔ JAMÁS el ancla).
 *
 * La enumeración a mano del defecto **falló tres veces** (`ARCHITECTURE §4.34a.2(B)/(E)`): `grep
 * '\.card\.name'` no caza el acceso **aliaseado** (`const card = x.inventoryItem.card; … card.name`,
 * `const fromCase = …originalInventoryItem.card; fromCase?.name`). El dueño eligió la **opción
 * exhaustiva**: este candado escanea el código fuente de TODOS los módulos que producen display y
 * **FALLA** si encuentra una lectura de un campo de display de la carta ancla (`.card.name`,
 * `.card.number`, `.card.imageSmallUrl`, incluidos los aliases locales) **que no esté**:
 *   (a) resuelta por `pieceDisplayIdentityOf` (la línea que lo usa no lee `.card.<campo>` directo), o
 *   (b) en la ALLOWLIST explícita de abajo, con su razón de una línea.
 *
 * ### Qué NO es fuga (y por eso va a la allowlist)
 *  - el **nombre** de un sellado JAMÁS puede ser el ancla → eso es lo que el candado persigue;
 *  - el **número** del ancla NO lo produce el resolutor: un sellado lo oculta aguas abajo vía
 *    `productType`, o lo congela como HECHO del set (§5.2.6) — por eso los `.card.number` van a la
 *    allowlist con su razón;
 *  - la **imagen** del ancla es cola ACEPTADA (§5.2.6): una caja sin su foto sale sin foto, no mal
 *    rotulada;
 *  - superficies **single/graded/raw/accesorio** que NUNCA son sellado, y los `CardDTO` del ancla
 *    que viajan ADEMÁS del bloque de sellado (🔵 «por diseño», §4.34a.2(E)).
 *
 * ### Mantenible
 * Cada entrada de la allowlist trae `file`, `lines` (navegación humana) y `reason`. El match es por
 * **contenido de línea** (no por número): editar un fichero no rompe el candado por desplazamiento.
 * **El campo `lines` es LOAD-BEARING** (D-1 techlead, 2026-10-13): el candado afirma que cada entrada
 * casa con **EXACTAMENTE `lines.length`** accesos reales — no «≥1». Así, un acceso NUEVO con **texto de
 * línea idéntico** a uno ya allowlisteado, **en el mismo fichero**, sube el conteo por encima de
 * `lines.length` ⇒ **rojo**, forzando revisión (añadir su número a `lines` es la decisión humana que
 * el candado exige). Un acceso NUEVO sin resolver ni allowlist ⇒ **rojo**, con el fichero:línea y el
 * recordatorio de usar `pieceDisplayIdentityOf`. Una entrada de allowlist que ya no casa (conteo 0) ⇒
 * **rojo** (el censo no acumula entradas muertas).
 *
 * ### Límites del escáner (dichos, no escondidos) y su canario
 * Es un escáner estático sobre código con comentarios/strings fuera (via `stripComments`). El match
 * directo caza `card.name`/`card?.name` (cualquier variable llamada `card`) y `x.card.name`; los
 * aliases con OTRO nombre se cazan detectando `const X = ….card;` y rastreando `X.name/.number/
 * .imageSmallUrl`. Como todo análisis estático, tiene fronteras que **hoy ningún módulo escaneado
 * cruza** (verificado 2026-10-13) y que son límite aceptable para esta superficie (money-safe, solo
 * display):
 *   1. **regex-vs-división** — `stripComments` no distingue `a / b` de `/re/`, así que un literal de
 *      regex con `//` o apertura de bloque podría confundir el stripper (ver `strip-comments.ts`).
 *   2. **destructuring con renombre** — `const { card: c } = x; … c.name` NO se caza (solo se rastrea
 *      el alias por asignación `const X = ….card;`, no por patrón de desestructuración).
 *   3. **asignación de alias multilínea** — `ALIAS_ASSIGN` casa en UNA línea; `const x =\n  a.b.card;`
 *      partido en dos líneas no se detecta como alias.
 *   4. **parámetro/variable con nombre ≠ `card`** que reciba la carta ancla y de la que no se detecte
 *      la asignación `= ….card` (p. ej. un parámetro de función llamado `anchor`): su `.name` no suena.
 * El canario de este candado es la **mutación** descrita en `BACKEND_NOTES.md` (§sellado-display): una
 * copia directa `card.name` **y** una aliaseada (`const X = item.card; X.name`) en una superficie de
 * display ponen esta prueba **roja**. Estos cuatro límites quedan registrados como deuda de bajo riesgo
 * en `TECH_DEBT.md` (SD-D4). ⛔ No decide conducta de producción; es un instrumento de pruebas.
 *
 * ### Alcance: la lista `MODULES` ES la frontera del candado (menor de QA, 2026-10-13)
 * El candado solo ve los módulos de `MODULES` (abajo). `disputes`, `buylist` y `decks-meta` **NO se
 * escanean**: QA verificó que hoy ninguno es superficie de sellado (`BUYLIST_ACCEPTED_PRODUCT_TYPES =
 * ['raw']`; `decks-meta` pinta cartas sueltas). ⚠️ **Un módulo NUEVO que produzca display de una pieza
 * —o un camino de sellado añadido a `buylist`/`decks-meta`/`disputes`— DEBE agregarse a `MODULES`**, o
 * el candado queda ciego sobre él sin avisar. (SD-D4 en `TECH_DEBT.md`.)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './helpers/strip-comments';

const SRC = join(__dirname, '..', 'src', 'modules');

/**
 * Módulos que producen display de una pieza (API_CONTRACT/ARCHITECTURE §4.34a.2 + los que QA/techlead
 * cazaron fuera del alcance normado). El correo (`mail/`) se escanea también: compone avisos con
 * nombres de pieza.
 */
const MODULES = [
  'orders',
  'shipments',
  'vault',
  'payments',
  'catalog',
  'pricing',
  'inventory',
  'wishlist',
  'sales-analytics',
  'accessories',
  'mail',
] as const;

/** Campos de DISPLAY de la carta ancla que un sellado JAMÁS debe pintar como suyos. */
const FIELD = '(?:name|number|imageSmallUrl)';
/** `card.name` / `card?.name` / `x.card.name` — cualquier variable llamada `card` + el acceso directo. */
const DIRECT = new RegExp(`\\bcard\\??\\.${FIELD}\\b`);
/** `const X = a.b.card;` (RHS termina en `.card`) — para rastrear aliases con OTRO nombre que `card`. */
const ALIAS_ASSIGN = /^\s*(?:const|let)\s+(\w+)\s*=\s*[^;={}]*\.card\s*;?\s*$/;

type Hit = { file: string; line: number; text: string };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.e2e-spec.ts')) out.push(p);
  }
  return out;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const mod of MODULES) {
    const dir = join(SRC, mod);
    for (const file of walk(dir)) {
      const stripped = stripComments(readFileSync(file, 'utf8'));
      const lines = stripped.split('\n');
      // Aliases de `.card` con nombre distinto de `card` (el caso que el grep dejaba pasar).
      const aliases = new Set<string>();
      for (const ln of lines) {
        const m = ALIAS_ASSIGN.exec(ln);
        if (m && m[1] !== 'card') aliases.add(m[1]);
      }
      const aliasRe = aliases.size
        ? new RegExp(`\\b(?:${[...aliases].join('|')})\\??\\.${FIELD}\\b`)
        : null;
      const rel = file.slice(file.indexOf(join('src', 'modules')));
      lines.forEach((ln, idx) => {
        // Una línea que ya pasa por el resolutor único no lee el ancla directo: es segura por construcción.
        if (ln.includes('pieceDisplayIdentityOf')) return;
        if (DIRECT.test(ln) || (aliasRe && aliasRe.test(ln))) {
          hits.push({ file: rel.replace(/\\/g, '/'), line: idx + 1, text: ln.trim() });
        }
      });
    }
  }
  return hits;
}

/**
 * ALLOWLIST — EL CENSO EXHAUSTIVO de las lecturas del ancla que NO son fuga de sellado.
 * `file` = ruta relativa desde `src/modules`; `reason` = por qué NO es fuga. El match es por `file` +
 * `snippet` (contenido), no por número de línea. **`lines` es LOAD-BEARING** (D-1): su longitud ES el
 * nº de accesos que el candado espera para esa entrada, y lista las líneas donde viven (navegación
 * humana). Si dos accesos distintos comparten el mismo texto de línea en el mismo fichero, `lines` trae
 * ambos números y el conteo esperado es 2. Añadir un número a `lines` es la decisión humana que el
 * candado exige cuando aparece un acceso idéntico nuevo.
 */
type Allow = { file: string; snippet: string; lines: number[]; reason: string };

const ALLOWLIST: Allow[] = [
  // ───────────────────────── NÚMERO del ancla (el resolutor no lo produce) ─────────────────────────
  {
    file: 'src/modules/orders/guest-checkout.service.ts',
    snippet: 'number: oi.inventoryItem.card.number,',
    lines: [876],
    reason: 'number del ancla; el front lo OCULTA para sellado vía productType (§4.34a.2). name/imagen ya por el resolutor (:874/:886).',
  },
  {
    file: 'src/modules/orders/orders.service.ts',
    snippet: 'number: item.card.number,',
    lines: [877],
    reason: 'cardSnapshot: número del ancla CONGELADO como hecho del set (§5.2.6). name por el resolutor (:872).',
  },
  {
    file: 'src/modules/shipments/shipments.service.ts',
    snippet: 'number: card.number,',
    lines: [734],
    reason: 'toClientShipmentItem: number del ancla; el front lo oculta para sellado (productType en el DTO). name/imagen por el resolutor (identity).',
  },
  // ───────────────────────── IMAGEN del ancla (cola ACEPTADA, §5.2.6) ─────────────────────────
  {
    file: 'src/modules/orders/order-item-card.ts',
    snippet: 'return { ...facts, imageSmallUrl: card?.imageSmallUrl ?? null };',
    lines: [110],
    reason: 'resolveOrderItemCard: resuelve la IMAGEN (clase P) del acta; imagen del ancla es cola ACEPTADA (§5.2.6/§4.34a.2). El name ya viene resuelto en el acta.',
  },
  // ───────────────────────── Clave de ORDEN sobre el nombre YA RESUELTO ─────────────────────────
  {
    file: 'src/modules/vault/vault-physical-inventory.service.ts',
    snippet: 'return codeUnits(a.card.name, b.card.name) || codeUnits(a.folio, b.folio);',
    lines: [189],
    reason: 'clave de ORDEN sobre el `card.name` YA RESUELTO del DTO de preparationCardOf (§4.34a.2(E) ✅); no pinta ni filtra el ancla.',
  },
  // ───────────────────────── toCardDTO: CardDTO de la CARTA ancla (🔵 por diseño) ─────────────────────────
  {
    file: 'src/modules/catalog/catalog.service.ts',
    snippet: 'name: card.name,',
    lines: [268],
    reason: 'toCardDTO: builder del CardDTO de la carta ANCLA (el `card` es el sujeto, no la identidad de display de una pieza). El sellado no nombra por esta ruta (§4.34a.2(E) 🔵).',
  },
  {
    file: 'src/modules/catalog/catalog.service.ts',
    snippet: 'number: card.number,',
    lines: [269, 1877],
    reason: 'número del ancla en catalog.service.ts: toCardDTO (CardDTO ancla) y la revisión de estimaciones GRADED (graded nunca es sellado). Ambos leen el número del ancla legítimamente.',
  },
  {
    file: 'src/modules/catalog/catalog.service.ts',
    snippet: 'imageSmallUrl: card.imageSmallUrl,',
    lines: [282],
    reason: 'toCardDTO: imagen del CardDTO de la carta ANCLA (🔵 por diseño).',
  },
  {
    file: 'src/modules/catalog/catalog.service.ts',
    snippet: 'ogImageUrl: absoluteOgImageUrl(card.imageLargeUrl, card.imageSmallUrl),',
    lines: [1615],
    reason: 'v1.96⟨mkt-tienda⟩ §MKT.A: `ogImageUrl` de la FICHA de CARTA (`GET /catalog/cards/:cardId`); el `card` ES el sujeto de su propia ficha (single), NUNCA un ancla de sellado (🔵 por diseño). La ficha de SELLADO resuelve su og por `pieceDisplayIdentityOf` (display.imageSmallUrl), no por esta ruta.',
  },
  {
    file: 'src/modules/catalog/catalog.service.ts',
    snippet: 'cardName: card.name,',
    lines: [1875],
    reason: 'GradedEstimateReviewItemDTO: revisión de estimaciones GRADED (PSA/CGC); graded nunca es sellado.',
  },
  // ───────────────────────── Bounties: cartas RAW (productType:"raw" fijo) ─────────────────────────
  {
    file: 'src/modules/pricing/admin-bounties.service.ts',
    snippet: 'name: row.card.name,',
    lines: [340],
    reason: 'AdminBountyRowDTO: bounty de carta RAW (productType:"raw" fijo en el DTO); una carta suelta, nunca sellado.',
  },
  {
    file: 'src/modules/pricing/admin-bounties.service.ts',
    snippet: 'number: row.card.number,',
    lines: [341],
    reason: 'AdminBountyRowDTO: bounty RAW; número de la carta suelta.',
  },
  {
    file: 'src/modules/pricing/admin-bounties.service.ts',
    snippet: '...(row.card.imageSmallUrl ? { imageSmallUrl: row.card.imageSmallUrl } : {}),',
    lines: [342],
    reason: 'AdminBountyRowDTO: bounty RAW; imagen de la carta suelta.',
  },
  // ───────────────────────── price-review / M2 queue: identidad del ANCLA (contrato manda) ─────────────────────────
  {
    file: 'src/modules/pricing/price-review.service.ts',
    snippet: "name: card?.name ?? '',",
    lines: [399],
    reason: 'PriceReviewCaseDTO.card = identidad de la CARTA ancla (API_CONTRACT §D «para que el dueño reconozca la carta»). La identidad del sellado es `sealedProductId` aparte; el contrato manda el bloque `card` del ancla.',
  },
  {
    file: 'src/modules/pricing/price-review.service.ts',
    snippet: "number: card?.number ?? '',",
    lines: [401],
    reason: 'PriceReviewCaseDTO.card.number = número de la carta ANCLA (contrato §D).',
  },
  {
    file: 'src/modules/pricing/pricing.service.ts',
    snippet: 'cardName: card.name,',
    lines: [3224],
    reason: 'Cola M2 (pendingQueue): `cardName`/`card` = identidad de la CARTA ancla (el set al que pertenece). El NOMBRE del sellado va en `sealedProductName`, resuelto por pieceDisplayIdentityOf.',
  },
  {
    file: 'src/modules/pricing/pricing.service.ts',
    snippet: 'name: card.name,',
    lines: [3227],
    reason: 'Cola M2 (pendingQueue): `card.name` del ancla en el sub-DTO `card` (identidad de la carta). El nombre de sellado va aparte, resuelto.',
  },
  {
    file: 'src/modules/pricing/pricing.service.ts',
    snippet: 'number: card.number,',
    lines: [3228],
    reason: 'Cola M2 (pendingQueue): `card.number` del ancla en el sub-DTO `card`.',
  },
  // ───────────────────────── Export xlsx de inventario: columna "Carta"/"Número" = ancla (contrato) ─────────────────────────
  {
    file: 'src/modules/inventory/inventory.service.ts',
    snippet: "card: it.card?.name ?? '',",
    lines: [4058],
    reason: 'Export .xlsx (INVENTORY_EXPORT_COLUMNS, API_CONTRACT §export): columna "Carta" = la CARTA ancla (hermana de "Set"/"Número", también del ancla). Fuera del alcance normado §4.34a.2. ⚠️ confirmación de política al arquitecto (ver BACKEND_NOTES §P-1).',
  },
  {
    file: 'src/modules/inventory/inventory.service.ts',
    snippet: "number: it.card?.number ?? '',",
    lines: [4060],
    reason: 'Export .xlsx: columna "Número" = número de la carta ancla.',
  },
  // ───────────────────────── gradedIndex: pestaña GRADED (nunca sellado) ─────────────────────────
  {
    file: 'src/modules/inventory/sealed-graded.service.ts',
    snippet: "name: card?.name ?? '',",
    lines: [425],
    reason: 'gradedIndex (pestaña «Gradeadas»): GRADED (PSA/CGC), nunca sellado. El sealedIndex de este mismo fichero ya usa el resolutor.',
  },
  {
    file: 'src/modules/inventory/sealed-graded.service.ts',
    snippet: "number: card?.number ?? '',",
    lines: [426],
    reason: 'gradedIndex: número de la carta GRADED.',
  },
  {
    file: 'src/modules/inventory/sealed-graded.service.ts',
    snippet: '...(card?.imageSmallUrl ? { imageSmallUrl: card.imageSmallUrl } : {}),',
    lines: [428],
    reason: 'gradedIndex: imagen de la carta GRADED.',
  },
  {
    file: 'src/modules/inventory/sealed-graded.service.ts',
    snippet: 'x.card.name.localeCompare(y.card.name) ||',
    lines: [452],
    reason: 'gradedIndex: clave de ORDEN de la pestaña GRADED (nunca sellado).',
  },
  {
    file: 'src/modules/inventory/sealed-graded.service.ts',
    snippet: 'x.card.number.localeCompare(y.card.number) ||',
    lines: [453],
    reason: 'gradedIndex: clave de ORDEN (número) de la pestaña GRADED.',
  },
  // ───────────────────────── wishlist: cartas RAW (no hay wishlist de sellado) ─────────────────────────
  {
    file: 'src/modules/wishlist/wishlist-notify.service.ts',
    snippet: 'cardName: wi.card.name,',
    lines: [239],
    reason: 'Aviso de wishlist: la wishlist es de CARTAS (raw). El restock de SELLADO es otra ruta (sealedWaiting, ya por el resolutor).',
  },
  {
    file: 'src/modules/wishlist/wishlist-notify.service.ts',
    snippet: 'number: wi.card.number,',
    lines: [241],
    reason: 'Aviso de wishlist (carta raw): número de la carta.',
  },
  {
    file: 'src/modules/wishlist/wishlist-notify.service.ts',
    snippet: 'imageSmallUrl: wi.card.imageSmallUrl,',
    lines: [243],
    reason: 'Aviso de wishlist (carta raw): imagen de la carta.',
  },
  {
    file: 'src/modules/wishlist/wishlist.service.ts',
    snippet: 'card: { id: i.card.id, name: i.card.name, setName: i.card.set.name, number: i.card.number, imageSmallUrl: i.card.imageSmallUrl },',
    lines: [149],
    reason: 'WishlistItemDTO.card: la wishlist es de CARTAS (raw); el `card` ES el sujeto, no una pieza sellada.',
  },
  // ───────────────────────── sales-analytics: rama NO-sellado ─────────────────────────
  {
    file: 'src/modules/sales-analytics/sales-analytics.service.ts',
    snippet: "{ cardId: inv.cardId, name: inv.card.name, number: inv.card.number, setName: inv.card.set.name, finish: finishOf, productType: inv.productType as 'raw' | 'graded', pieces: 0, netCents: 0 };",
    lines: [400],
    reason: 'Rama `else` (productType !== "sealed"): el `if` de arriba desvía TODO sellado al resolutor (:389). Aquí solo raw/graded (anotado `as "raw" | "graded"`).',
  },
  // ───────────────────────── accesorios: no es una pieza sellada ─────────────────────────
  {
    file: 'src/modules/accessories/accessory-dto.ts',
    snippet: 'name: card.name,',
    lines: [107],
    reason: 'DTO de accesorio: un accesorio no es una pieza sellada; su `card` es la carta asociada, no una caja.',
  },
];

describe('candado sellado-display — ninguna superficie pinta el ancla de un sellado sin pasar por el resolutor', () => {
  const hits = scan();

  it('todo acceso al display del ancla está resuelto o en la allowlist con su razón', () => {
    const covered = (h: Hit) =>
      ALLOWLIST.some((a) => a.file === h.file && a.snippet === h.text);
    const violations = hits.filter((h) => !covered(h));
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}\n      ${v.text}`)
        .join('\n');
      throw new Error(
        `Acceso(s) al display de la carta ancla SIN resolver ni allowlist (bug de sellado-display, §4.34a.2):\n${msg}\n\n` +
          `Si es una pieza que PUEDE ser sellada: úsalo por \`pieceDisplayIdentityOf(item)\` (src/common/piece-display-identity.ts) — ` +
          `JAMÁS el \`card.name\` del ancla.\nSi NO puede ser sellada (single/graded/raw/accesorio) o es el \`card\` del ancla por diseño: ` +
          `añádelo a la ALLOWLIST de este fichero con su razón de una línea.`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('cada entrada de la allowlist casa con EXACTAMENTE `lines.length` accesos reales (conteo load-bearing, D-1)', () => {
    // `lines.length` es el nº de matches esperado (no «≥1»). Un acceso NUEVO con texto de línea idéntico
    // a uno ya allowlisteado, en el MISMO fichero, sube el conteo por encima de `lines.length` ⇒ rojo:
    // obliga a revisar y a subir el conteo esperado (añadir su número a `lines`). Y una entrada que ya no
    // casa (conteo 0 ≠ lines.length≥1) también es rojo: el censo no acumula entradas muertas.
    const mismatches = ALLOWLIST.map((a) => {
      const count = hits.filter((h) => h.file === a.file && h.text === a.snippet).length;
      return { a, count };
    })
      .filter(({ a, count }) => count !== a.lines.length)
      .map(
        ({ a, count }) =>
          `  ${a.file} :: ${a.snippet}\n      esperado ${a.lines.length} (lines=[${a.lines.join(', ')}]) · encontrado ${count}`,
      );
    expect(mismatches).toEqual([]);
  });

  it('el escaneo cubre todos los módulos que producen display (sanidad del recorrido)', () => {
    // Si un módulo se renombra/mueve, esto lo caza antes de que el candado quede ciego sin avisar.
    for (const mod of MODULES) {
      expect(() => statSync(join(SRC, mod))).not.toThrow();
    }
    // Hay accesos reales que mirar (si cae a 0, el escáner se rompió, no es que no haya nada).
    expect(hits.length).toBeGreaterThan(0);
  });
});
