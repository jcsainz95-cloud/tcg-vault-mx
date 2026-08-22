/**
 * master-set-groups.ts — Mapa curado padre→subset para SETS MULTI-PARTE / MASTER SET COMBINADO
 * (P-27, v1.33-master-set-multipart · PROJECT §L · ARCHITECTURE §4.31 · API_CONTRACT v1.33).
 *
 * QUÉ ES: un set de aniversario/especial que pokemontcg.io publica como ≥2 set-ids (el principal +
 * su(s) subset(s) con id propio) se PRESENTA como UN master set combinado (Celebrations `cel25` +
 * Classic Collection `cel25c` = 50 cartas). Este mapa gobierna esa agrupación.
 *
 * REGLA DURA — MONEY-SAFE (ARCHITECTURE §4.31e, CA-68/CA-72): este mapa es **SOLO LECTURA de
 * PRESENTACIÓN**. NUNCA es fuente de verdad. Ninguna ruta de escritura/dinero (alta por lote,
 * bulk-publish, adjustments, órdenes/checkout, pricing/sync, buylist) lo consulta. Cada `Card`/pieza
 * conserva su `setId` REAL; `scopeWhere` y las agregaciones filtran por `cardId` (llaveado a su set
 * real). Activar, desactivar o extender el mapa NO ejecuta ninguna escritura de datos ni re-llavea nada.
 *
 * DÓNDE: constante curada (NO columna de schema ni tabla — sin migración; extensible con una línea,
 * CA-69). Las CLAVES son el `externalId` de pokemontcg.io (estables y humanos: "cel25"), NO el UUID
 * local del `CardSet` (que varía por entorno). El servicio resuelve `externalId → CardSet.id` local
 * por join, y valida al boot que cada `externalId` mapeado exista importado (warning si no; ver §4.31a).
 */

/** Un subset con id propio que se pliega bajo su principal (N por principal, en orden de bloque). */
export interface MasterSetSubset {
  /** `externalId` de pokemontcg.io del subset (p. ej. "cel25c"). */
  externalId: string;
  /** Etiqueta del separador/encabezado del bloque en el binder (p. ej. "Classic Collection"). */
  label: string;
  /** Orden del bloque del subset DESPUÉS del principal (1, 2, …). El principal es siempre order 0. */
  order: number;
}

/** Un grupo padre→subset. `primary` = `externalId` del principal (su `name` nombra al master). */
export interface MasterSetGroup {
  /** `externalId` del set PRINCIPAL (p. ej. "cel25"). */
  primary: string;
  /** Subsets con id propio, en orden de bloque. Soporta N subsets (CA-70). */
  subsets: MasterSetSubset[];
}

/**
 * Mapa curado. Arranca con Celebrations (CONFIRMADO). Los candidatos Shiny-Vault-con-id-propio
 * quedan COMENTADOS hasta validar sus `externalId` REALES contra el catálogo (no hay DB aquí para
 * verificarlos; no se shippea a ciegas — ARCHITECTURE §4.31a). Para activar uno: descomentar la línea
 * (la validación al boot avisará si el `externalId` no está importado).
 */
export const MASTER_SET_GROUPS: MasterSetGroup[] = [
  // ── CONFIRMADO (caso testigo, criterios 65–67): Celebrations (2021) = 25 principal + 25 subset = 50.
  { primary: 'cel25', subsets: [{ externalId: 'cel25c', label: 'Classic Collection', order: 1 }] },

  // ── CANDIDATOS — SUJETOS A VALIDACIÓN por backend contra el catálogo REAL antes de activar.
  //    Patrón "Shiny Vault con id propio". Verificar el `externalId` EXACTO del principal Y del subset
  //    en pokemontcg.io / el catálogo local antes de descomentar (no shippear a ciegas):
  // { primary: 'swsh45', subsets: [{ externalId: 'swsh45sv', label: 'Shiny Vault', order: 1 }] }, // Shining Fates — VALIDAR
  // { primary: 'sm115',  subsets: [{ externalId: 'sma',      label: 'Shiny Vault', order: 1 }] }, // Hidden Fates — VALIDAR
];

// Los helpers leen `MASTER_SET_GROUPS` EN VIVO (no índices pre-construidos): el mapa es curado y
// diminuto (el costo de iterar es nulo) y así los tests pueden inyectar un grupo temporal como fixture
// (CA-70/CA-71) sin re-cablear el módulo. `undefined`/vacío entra sin match (retrocompat total).

/** Grupo cuyo PRINCIPAL es `externalId`, o `undefined` si `externalId` no es principal de ninguno. */
export function groupForPrimaryExternalId(externalId: string): MasterSetGroup | undefined {
  if (!externalId) return undefined;
  return MASTER_SET_GROUPS.find((g) => g.primary === externalId);
}

/** `externalId` del principal de un `externalId` de SUBSET, o `undefined` si no es subset de ninguno. */
export function parentExternalIdOf(subsetExternalId: string): string | undefined {
  if (!subsetExternalId) return undefined;
  const g = MASTER_SET_GROUPS.find((grp) => grp.subsets.some((s) => s.externalId === subsetExternalId));
  return g?.primary;
}

/** Metadatos ({ externalId, label, order }) de un subset por su `externalId`, o `undefined`. */
export function subsetMetaOf(subsetExternalId: string): MasterSetSubset | undefined {
  if (!subsetExternalId) return undefined;
  for (const g of MASTER_SET_GROUPS) {
    const s = g.subsets.find((sub) => sub.externalId === subsetExternalId);
    if (s) return s;
  }
  return undefined;
}

/**
 * `externalId`s de TODAS las partes de un master combinado, en orden de bloque (principal primero,
 * luego cada subset por su `order`). `[]` si `primaryExternalId` no es principal de ningún grupo.
 */
export function partExternalIds(primaryExternalId: string): string[] {
  const g = groupForPrimaryExternalId(primaryExternalId);
  if (!g) return [];
  const ordered = [...g.subsets].sort((a, b) => a.order - b.order);
  return [g.primary, ...ordered.map((s) => s.externalId)];
}

/** Todos los `externalId` referenciados por el mapa (para la validación al boot §4.31a). */
export function allMappedExternalIds(): string[] {
  const ids = new Set<string>();
  for (const g of MASTER_SET_GROUPS) {
    ids.add(g.primary);
    for (const s of g.subsets) ids.add(s.externalId);
  }
  return [...ids];
}
