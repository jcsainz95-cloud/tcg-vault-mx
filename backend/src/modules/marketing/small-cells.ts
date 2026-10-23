/**
 * small-cells.ts — 🔒💰 CANDADO DE CELDAS PEQUEÑAS del Panel de Marketing (Brief 2 §5.2, PM-A1;
 * ARCHITECTURE §13.5/§13.7; API_CONTRACT §MKT.D/E/§MKT.G.10). PURO (sin IO), para poder probarlo a mano (N=1).
 *
 * Regla única que protege a UNA persona detrás de una cifra agregada (API_CONTRACT §MKT.H.14, v1.107):
 *  - En toda tabla CON DIMENSIÓN (`utm_*`, puerta, carta, estado, día): si el nº de **sujetos distintos** (`subjects`:
 *    pedidos, solicitudes o usuarios; R1) es `< 5` ⇒ el conteo publicado sale «< 5» y **todo MX$/derivado de esa
 *    fila sale `'oculta'`** — ni ticket medio, ni ofertado, ni pagado.
 *  - **Por componente** (b1-b3, `applySmallCellsByComponent`): cada parte de la fila (pedidos, solicitudes) con su N;
 *    una parte chica no tapa la otra, y la suma de las dos no destapa ninguna (SEC-MKT-1).
 *  - **Orden (R0):** solo con valores publicados. Las visibles en el orden de entrada (que el llamador da por valor
 *    publicado o por estructura), después las ocultas por clave asc y «Otros» al final. ⛔ Nunca por el N real de una oculta.
 *  - **Supresión coherente mes↔semanas (§MKT.G.10, D-MKT-PANEL-4):** el llamador pasa `forcedHidden` = las claves
 *    ocultas en ALGUNA semana que toca el mes; en el mes salen **«oculta»** (conteo) y null (MX$) aunque N≥5.
 *  - **Supresión complementaria (R3a):** si tras lo anterior queda **UNA sola** celda oculta («< 5» u «oculta») en la
 *    tabla, se agrupa con la **siguiente más chica ≠ 0** en una fila «Otros (< 5 c/u)» (ambas ocultas), de modo
 *    que el total menos las visibles no despeje una sola celda. `N = 0` ⇒ `0` visible (R1).
 *
 * ⛔ El conteo real de una fila oculta NUNCA viaja: se reemplaza por el centinela.
 * ⛔ Los TOTALES SIN DIMENSIÓN (a1/a2 de la semana) NO pasan por aquí: se muestran exactos.
 *
 * 🔒 CRUCES ENTRE TABLAS (MKT-TL2, §MKT.H.14 R3b/R4): lo de aquí es LOCAL a una tabla. Lo que una tabla publica y otra
 * del mismo periodo despeja (b2 = Σ b1 de una puerta, g1 ≡ b2[Promoción]…) lo cierra `enforceFamily`
 * (`marketing-populations.ts`), que el servicio aplica a cada familia antes de pintar; el auditor independiente es
 * `test/marketing-cross-table.audit.spec.ts` (prueba 3).
 *
 * Régimen (`CellPrivacy`, API_CONTRACT v1.103 §MKT.G.2): `'small_cells'` aplica todo lo anterior; `'exact'` lo
 * salta (cifras reales, sin «Otros»). Es un PARÁMETRO del mismo cálculo, no un segundo camino. Solo la pantalla
 * del dueño (`GET …/panel` con sesión `super_admin`) usa `'exact'`; toda salida fuera de pantalla, `'small_cells'`.
 */

declare const OWNER_EXACT: unique symbol;
/**
 * Régimen exacto como tipo MARCADO (techlead D3, 2026-10-18): el literal `'exact'` a pelo NO es asignable a
 * `CellPrivacy`, así que una salida no puede nacer exacta por escribir la palabra. El único productor es
 * `MarketingController.panelPrivacy()` (cast explícito, vigilado por `test/marketing-panel-privacy.spec.ts`).
 * En ejecución sigue siendo la cadena `'exact'` (viaja así en `ScreenPayload.privacy`).
 */
export type ExactPrivacy = 'exact' & { readonly [OWNER_EXACT]: true };
/** Régimen de privacidad de las celdas de una salida del panel. */
export type CellPrivacy = 'small_cells' | ExactPrivacy;

/** Umbral de la regla: por debajo de 5 se oculta (PM-A1). */
export const SMALL_CELL_THRESHOLD = 5;

/** Centinela de conteo con N<5. El conteo real nunca viaja. */
export const SMALL_CELL_SENTINEL = '< 5' as const;
/** Centinela de conteo con N≥5 ocultado por la supresión coherente mes↔semanas (§MKT.G.10). */
export const SMALL_CELL_HIDDEN = 'oculta' as const;
export type SuppressedCount = typeof SMALL_CELL_SENTINEL | typeof SMALL_CELL_HIDDEN;

/** Etiqueta de la fila agrupada por supresión complementaria. */
export const OTROS_LABEL = 'Otros (< 5 c/u)';

/**
 * Una celda/fila dimensionada antes de aplicar la regla.
 * `money` reúne TODO campo monetario o derivado de dinero que debe ocultarse si `count < 5`
 * (MX$, ticket medio, MX$ ofertado, MX$ pagado…). `count` es el N REAL (no viaja si se oculta).
 */
export interface DimensionRow {
  /** Etiqueta de la dimensión, YA escapada por el llamador si viene de fuera (utm_*, término…). Clave de cruce mes↔semanas. */
  key: string;
  /** Valor PUBLICADO del conteo si la fila queda visible (d1: piezas; d3: altas; el resto: = `subjects`). */
  count: number;
  /**
   * Sujetos DISTINTOS detrás de la fila (§MKT.H.14 R1): lo que decide el umbral. d1: pedidos distintos; d3: usuarios
   * distintos; GA4/SC: la unidad de la fuente. Obligatorio: una tabla nueva no puede nacer sin decir qué cuenta.
   */
  subjects: number;
  money: Record<string, number | null>;
}

/** Fila ya saneada para pantalla/export/endpoint. `count` es número exacto o un centinela. */
export interface SafeRow {
  key: string;
  count: number | SuppressedCount;
  /** En una fila oculta, cada valor es `'oculta'` (API_CONTRACT v1.106 §MKT.G.5: `null` es solo «sin dato»). */
  money: Record<string, number | null | typeof SMALL_CELL_HIDDEN>;
  /** true solo en la fila «Otros (< 5 c/u)» (agrupación por supresión complementaria). */
  otros?: boolean;
}

/** Fila oculta: toda cifra acompañante pasa a `'oculta'`, ⛔ nunca `null` (que significa «sin dato», C-P1). */
const blankMoney = (money: Record<string, number | null>): Record<string, typeof SMALL_CELL_HIDDEN> => {
  const out: Record<string, typeof SMALL_CELL_HIDDEN> = {};
  for (const k of Object.keys(money)) out[k] = SMALL_CELL_HIDDEN;
  return out;
};

const isHidden = (c: SafeRow['count']): boolean => c === SMALL_CELL_SENTINEL || c === SMALL_CELL_HIDDEN;

/** Componente único de una tabla de una parte: `plan` es el caso de un componente de `planByComponent` (MKT-TL9). */
const ONE = '\u0001';

/**
 * Núcleo de una tabla de UN componente: el mismo cálculo que `planByComponent` con una sola parte (R1 «N = 0 ⇒ 0»,
 * coherencia `forcedHidden` y R3a «pareja ≠ 0», desempate por clave con `byKey`). Lo único propio de una parte es
 * la PRESENTACIÓN de R3a: la sola oculta y su pareja salen juntas en «Otros (< 5 c/u)». Lo comparten `applySmallCells` (las
 * filas) y `hiddenKeys` (las claves, para la coherencia mes↔semanas y la familia).
 */
function plan(rows: DimensionRow[], forcedHidden: ReadonlySet<string>) {
  const asParts: ComponentRow[] = rows.map((r) => ({ key: r.key, parts: { [ONE]: { count: r.count, subjects: r.subjects, money: r.money } } }));
  const forced = new Set([...forcedHidden].map((k) => cellId(k, ONE)));
  const { state, r3a } = planByComponent(asParts, forced);
  const safe: SafeRow[] = rows.map((r, i) => {
    const st = state[i][0];
    return st === 'visible' ? { key: r.key, count: r.count, money: { ...r.money } } : { key: r.key, count: st, money: blankMoney(r.money) };
  });
  const hiddenIdx = safe.map((r, i) => (isHidden(r.count) ? i : -1)).filter((i) => i >= 0);
  return { safe, hiddenIdx, grouped: r3a[0] ? { loneIdx: r3a[0].lone, partnerIdx: r3a[0].partner } : null };
}

/**
 * Aplica la regla de celdas pequeñas a una tabla dimensionada. Devuelve filas seguras EN EL ORDEN DE
 * ENTRADA; si hubo supresión complementaria, la fila «Otros (< 5 c/u)» va al final (y las dos que la
 * componen desaparecen de su posición). Determinista: «la siguiente más chica» desempata por `key`.
 *
 * ⚠️ El llamador decide QUÉ tablas tienen dimensión. Los totales sin dimensión no se pasan por aquí.
 */
export function applySmallCells(
  rows: DimensionRow[],
  privacy: CellPrivacy = 'small_cells',
  forcedHidden: ReadonlySet<string> = new Set(),
): SafeRow[] {
  // Régimen exacto: cifras reales, sin centinela ni agrupación (mismo orden de entrada).
  if (privacy === 'exact') return rows.map((r) => ({ key: r.key, count: r.count, money: { ...r.money } }));
  const { safe, grouped } = plan(rows, forcedHidden);
  const drop = new Set(grouped ? [grouped.loneIdx, grouped.partnerIdx] : []);
  const kept = safe.filter((_, i) => !drop.has(i));
  // R0 (§MKT.H.14): visibles en su orden de entrada; las ocultas, después y por clave (⛔ nunca por su N real).
  const visible = kept.filter((r) => !isHidden(r.count));
  const hidden = kept.filter((r) => isHidden(r.count)).sort((a, b) => byKey(a.key, b.key));
  const out = [...visible, ...hidden];
  // La fila «Otros»: ambos componentes ocultos (conteo centinela, dinero «oculta») ⇒ nada deducible. Va al final.
  if (grouped) out.push({ key: OTROS_LABEL, count: SMALL_CELL_SENTINEL, money: blankMoney(rows[grouped.loneIdx].money), otros: true });
  return out;
}

/** Desempate por clave: determinista e independiente de la configuración regional del proceso. */
const byKey = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Claves que `applySmallCells(rows, 'small_cells', forcedHidden)` deja ocultas: las de N<5, las forzadas y la pareja de una
 * fila «Otros». Es lo que el mes hereda de cada semana (§MKT.G.10 paso 1) y lo que la familia (R3b/R4) parte de cada tabla.
 */
export function hiddenKeys(rows: DimensionRow[], forcedHidden: ReadonlySet<string> = new Set()): Set<string> {
  return new Set(plan(rows, forcedHidden).hiddenIdx.map((i) => rows[i].key));
}

/** ¿Está oculto el conteo de esta fila? (helper para export/serialización). */
export function isSuppressed(count: number | SuppressedCount): count is SuppressedCount {
  return isHidden(count);
}

// ─────────────────────── Por componente (b1-b3; API_CONTRACT §MKT.H.14 R0, R1, R3a y MKT.G.10) ───────────────────────

/** Identidad de una celda para la coherencia mes↔semanas: (clave, componente). */
export type CellId = string;
export const cellId = (key: string, component: string): CellId => `${component}\u0000${key}`;

/** Una parte (componente) de una fila: conteo publicado, sujetos distintos y sus MX$/derivadas. */
export interface ComponentPart {
  count: number;
  subjects: number;
  money: Record<string, number | null>;
}
/** Fila con varios componentes (b1-b3: `pedidos` y `solicitudes`). El orden de `parts` es el orden de R0. */
export interface ComponentRow {
  key: string;
  parts: Record<string, ComponentPart>;
}
export interface SafePart {
  count: number | SuppressedCount;
  money: Record<string, number | null | typeof SMALL_CELL_HIDDEN>;
}
/** Fila saneada: conserva su clave aunque algún componente salga oculto (b1-b3 no tienen «Otros»). */
export interface SafeComponentRow {
  key: string;
  parts: Record<string, SafePart>;
}

type PartState = 'visible' | SuppressedCount;

/**
 * Estado de cada (fila, componente): R1 (`0 < sujetos < 5` ⇒ «< 5»; 0 ⇒ 0 visible), coherencia (`forced` ⇒ «oculta») y
 * R3a local: una columna con UNA sola oculta oculta también, en su sitio, la visible más chica ≠ 0 (desempate por clave).
 * `r3a[j]` dice qué pareja eligió R3a en la columna `j` (la tabla de una parte la presenta como «Otros»).
 */
function planByComponent(
  rows: ComponentRow[],
  forced: ReadonlySet<CellId>,
): { comps: string[]; state: PartState[][]; r3a: ({ lone: number; partner: number } | null)[] } {
  const comps = rows.length ? Object.keys(rows[0].parts) : [];
  const state: PartState[][] = rows.map((r) =>
    comps.map((c): PartState => {
      const n = r.parts[c].subjects;
      if (n > 0 && n < SMALL_CELL_THRESHOLD) return SMALL_CELL_SENTINEL;
      return forced.has(cellId(r.key, c)) ? SMALL_CELL_HIDDEN : 'visible';
    }),
  );
  const r3a = comps.map((c, j) => {
    const lone = state.map((st, i) => (st[j] !== 'visible' ? i : -1)).filter((i) => i >= 0);
    if (lone.length !== 1) return null;
    const partner = rows
      .map((r, i) => ({ i, key: r.key, n: r.parts[c].count }))
      .filter((x) => state[x.i][j] === 'visible' && x.n !== 0)
      .sort((a, b) => a.n - b.n || byKey(a.key, b.key))[0];
    if (!partner) return null;
    state[partner.i][j] = SMALL_CELL_HIDDEN;
    return { lone: lone[0], partner: partner.i };
  });
  return { comps, state, r3a };
}

/**
 * Umbral POR COMPONENTE (§MKT.H.14 R1): cada parte de la fila con su propio N de sujetos; una parte oculta lleva su conteo
 * en «< 5»/«oculta» y SUS MX$ en «oculta»; las demás partes no cambian. Orden R0: por el valor publicado de cada componente,
 * en el orden de `parts` (número desc; oculto después), y por clave. `exact`: cifras reales en el orden de entrada.
 */
export function applySmallCellsByComponent(
  rows: ComponentRow[],
  privacy: CellPrivacy,
  forced: ReadonlySet<CellId> = new Set(),
): SafeComponentRow[] {
  const copy = (p: ComponentPart): SafePart => ({ count: p.count, money: { ...p.money } });
  if (privacy === 'exact') {
    return rows.map((r) => ({ key: r.key, parts: Object.fromEntries(Object.entries(r.parts).map(([c, p]) => [c, copy(p)])) }));
  }
  const { comps, state } = planByComponent(rows, forced);
  const safe: SafeComponentRow[] = rows.map((r, i) => ({
    key: r.key,
    parts: Object.fromEntries(
      comps.map((c, j) => {
        const st = state[i][j];
        return [c, st === 'visible' ? copy(r.parts[c]) : { count: st, money: blankMoney(r.parts[c].money) }];
      }),
    ),
  }));
  const cmp = (a: SafeComponentRow, b: SafeComponentRow): number => {
    for (const c of comps) {
      const x = a.parts[c].count;
      const y = b.parts[c].count;
      if (typeof x === 'number' && typeof y === 'number') {
        if (x !== y) return y - x;
      } else if (typeof x === 'number' || typeof y === 'number') {
        return typeof x === 'number' ? -1 : 1;
      }
    }
    return byKey(a.key, b.key);
  };
  return safe.sort(cmp);
}

/**
 * (clave, componente) que `applySmallCellsByComponent(rows, 'small_cells', forced)` deja ocultos: lo que el mes hereda de cada
 * semana y lo que la familia (R3b/R4) parte de cada tabla.
 */
export function hiddenCellIds(rows: ComponentRow[], forced: ReadonlySet<CellId> = new Set()): Set<CellId> {
  const { comps, state } = planByComponent(rows, forced);
  const out = new Set<CellId>();
  rows.forEach((r, i) => comps.forEach((c, j) => state[i][j] !== 'visible' && out.add(cellId(r.key, c))));
  return out;
}
