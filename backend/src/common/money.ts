/**
 * money.ts — Funciones puras de dinero (centavos MXN). Sin dependencias de infra.
 * Fuente de verdad: ARCHITECTURE.md §5.1 (checkout, IVA, fee gross-up) y §10.1 (markup).
 *
 * Toda cantidad es un entero de centavos MXN. No se usan floats para persistir dinero.
 */
// v1.29 (§4.28): la ÚNICA verdad de «premium» y la normalización de rareza viven en el catálogo
// canónico (pure, sin infra) — money.ts las CONSUME (no duplica regex). El lookup de reglas normaliza
// AMBOS lados (rareza y key) para empatar 1:1 con la forma canónica del ingest.
import { isPremiumCanonicalRarity, normalizeRarity } from './rarity-catalog';

/**
 * BE-27 (money-safety): techo Int32 de Postgres. Toda columna `*Cents` persistible es `Int`, cuyo
 * máximo es 2_147_483_647. Un importe calculado por encima (p. ej. `pct × market` con un market/rate
 * enorme, o un `fixed` grande que se coló) desbordaría la columna y lanzaría al persistir (excepción
 * Prisma = DoS). `clampCents` ACOTA el valor FINAL ya calculado a [?, MAX_CENTS] SIN cambiar la
 * matemática ni el redondeo previos; `null` se respeta tal cual (pendiente, no se clava a 0).
 */
export const MAX_CENTS = 2_147_483_647;

/**
 * Acota un importe UNITARIO en centavos al techo Int32 (BE-27). No toca el redondeo; solo la cota
 * superior.
 *
 * MS-3 (decisión, Opción A): esta función se queda PURA a propósito — `money.ts` es "sin dependencias
 * de infra", así que NO lleva logging. La SEÑAL FUERTE de un importe fuera de rango vive en dos lugares
 * visibles y accionables: (1) los validadores de settings rechazan `fixed > FIXED_CENTS_MAX` en la
 * puerta de configuración, y (2) `grossUpTotal` **LANZA** cuando el AGREGADO excede `MAX_CENTS`
 * (mapeado a `AMOUNT_TOO_LARGE`). Con config legítima este clamp unitario NO debería dispararse nunca;
 * es una red de última instancia para que un unitario aberrante no desborde por sí solo antes de que el
 * agregado lo delate. Si en el futuro se quiere telemetría del recorte, la emite el caller que persiste
 * (fuera de este módulo puro), no `clampCents`.
 */
export function clampCents(n: number): number {
  return n > MAX_CENTS ? MAX_CENTS : n;
}

export interface StripeFeeConfig {
  /** Tarifa porcentual de Stripe como fracción (ej. 0.036 = 3.6%). */
  stripePct: number;
  /** Tarifa fija de Stripe en centavos (ej. 300 = MX$3.00). */
  stripeFixedCents: number;
  /**
   * C1: IVA (fracción) que Stripe MX cobra SOBRE su comisión (ej. 0.16 = 16%).
   * En México Stripe factura su comisión con IVA, así que la deducción real es
   * `(1 + stripeFeeIvaPct) × (pct × total + fija)`. El gross-up debe cubrirlo para
   * que la plataforma netee íntegro `base`. Dial `stripe_fee_iva_pct` (default 0.16).
   */
  stripeFeeIvaPct: number;
}

/**
 * @deprecated v1.13-sales-pricing (§4.14d): reemplazada por `computeSalePriceForRarity` (precio de
 * venta por rareza). Se conserva como palanca de ROLLBACK del markup GLOBAL único; el retiro
 * definitivo (junto con el dial SALES_MARKUP_PCT) es follow-up del humano (decisión abierta v1.13-3).
 *
 * Precio de venta = round(referencia × (1 + markup%)). ARCHITECTURE §10.1.
 * El "valor de mercado" mostrado sigue siendo la referencia; esto es el precio cobrado.
 */
export function computeSalePriceCents(referenceMxnCents: number, salesMarkupPct: number): number {
  return clampCents(Math.round(referenceMxnCents * (1 + salesMarkupPct / 100)));
}

/**
 * Costo de aportación en especie = round(referencia × pct/100). PROJECT criterio 28.
 */
export function computeAportacionCostCents(referenceMxnCents: number, aportacionPct: number): number {
  return clampCents(Math.round(referenceMxnCents * (aportacionPct / 100)));
}

/**
 * AcquisitionPricer (buylist) — tabla de precio por RAREZA OFICIAL. ARCHITECTURE §4.2 (v1.3.1).
 * Reemplaza el esquema de 3 categorías (BuylistCategory). El monto se resuelve con la regla
 * por rareza real de la carta (`Card.rarity`), editable en M2.
 */
export type BuylistRuleMode = 'fixed' | 'pct';
/** value = centavos MXN si mode='fixed'; porcentaje [0,100] de la referencia si mode='pct'. */
export interface BuylistRule {
  mode: BuylistRuleMode;
  value: number;
}

/**
 * v1.28 (P-18/P-22, ARCHITECTURE §4.26b) — fuente del peldaño que GANÓ la cotización de compra.
 * ADITIVO: se añaden `bounty` (bounty activo, paga el premium) y `override` (buyOverrideCents de
 * `VariantPriceOverride`, M-30) a los dos valores previos. El front DEBE tolerarlos (contrato §6).
 */
export type AcquisitionRuleSource = 'bounty' | 'override' | 'rule' | 'fallback';

/**
 * v1.28 (P-18/P-22, §4.26a/M-30) — contexto de CONTROLES por variante para los resolvers de
 * precedencia. Es la proyección relevante de una fila `VariantPriceOverride` (o `null`/omitido =
 * SIN fila ⇒ comportamiento actual intacto, cadena de reglas de siempre).
 *
 * REGLA money-safe de presencia (misma doctrina H-1 del sellado): un override/bounty se considera
 * PRESENTE solo si su monto es `> 0`. Un `<= 0` es input degenerado (las validaciones del write lo
 * rechazan; si se coló, se trata como AUSENTE — jamás se cobra/ofrece $0 por un dato corrupto).
 */
export interface VariantPriceControls {
  sellOverrideCents?: number | null;
  buyOverrideCents?: number | null;
  bountyEnabled?: boolean;
  bountyPriceCents?: number | null;
}

export interface AcquisitionQuote {
  quotedPriceCents: number | null;
  status: 'cotizada' | 'precio_pendiente';
  /** Regla efectivamente aplicada (explícita o fallback; bounty/override ⇒ fixed sintética). */
  appliedRule: BuylistRule;
  /**
   * "rule" = fila explícita en BUYLIST_PRICE_RULES; "fallback" = BUYLIST_PRICE_FALLBACK_PCT.
   * v1.28: además "bounty" | "override" cuando el control por variante (M-30) ganó la precedencia.
   */
  ruleSource: AcquisitionRuleSource;
}

/**
 * AcquisitionPricer (función pura, v1.3.1). ARCHITECTURE §4.2.
 * - Busca la regla por la RAREZA OFICIAL real (exact match sobre `Card.rarity`). Sin regla → fallback %.
 * - fixed → monto fijo en centavos; NO depende de la referencia → siempre 'cotizada'.
 * - pct   → round(referencia × value/100). Si falta referencia → 'precio_pendiente' (escala al dueño).
 *
 * SEC-A1: la `rarity` se deriva server-side de la carta real, nunca del DTO del cliente.
 */
export function quoteAcquisition(
  rarity: string | null,
  referenceMxnCents: number | null,
  rules: Record<string, BuylistRule>,
  fallbackPct: number,
): AcquisitionQuote {
  const explicit = rarity != null ? rules[rarity] : undefined;
  const rule: BuylistRule = explicit ?? { mode: 'pct', value: fallbackPct };
  const ruleSource: 'rule' | 'fallback' = explicit ? 'rule' : 'fallback';

  if (rule.mode === 'fixed') {
    // BE-27: clamp final (no-op para un fixed ya validado <= FIXED_CENTS_MAX; defensivo si se coló).
    return { quotedPriceCents: clampCents(rule.value), status: 'cotizada', appliedRule: rule, ruleSource };
  }
  // pct
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return {
    quotedPriceCents: clampCents(Math.round((referenceMxnCents * rule.value) / 100)),
    status: 'cotizada',
    appliedRule: rule,
    ruleSource,
  };
}

/**
 * v1.6-finish — resolver finish→regla determinista (ARCHITECTURE §4.2.1).
 * El acabado seleccionado determina (a) qué regla de BUYLIST_PRICE_RULES aplica y (b) qué
 * referencia de mercado usa el `pct` (la del ACABADO cotizado). NO se mete en gradeKey: es
 * ortogonal. El monto se deriva SIEMPRE server-side de (Card.rarity, finish) validado (SEC-A1).
 */
export type Finish = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';

/**
 * Una rareza "ya es holo" si su string (pokemontcg.io) contiene "holo" (case-insensitive):
 * "Rare Holo", "Rare Holo EX/GX/V/VMAX/VSTAR"… (NO "Ultra Rare"/"Illustration Rare").
 */
export function isHoloRarity(rarity: string | null): boolean {
  return rarity != null && rarity.toLowerCase().includes('holo');
}

/**
 * Fase 0.1 / v1.29 (§4.28e) — Clasificador de rareza PREMIUM (chase / alto valor).
 *
 * Regla de negocio del humano: SOLO Common/Uncommon y el "holo/reverse común" son precio FIJO de
 * bulk; todo lo más raro es un % arriba de MERCADO. Una rareza premium por tanto NUNCA debe poder
 * caer al bin fijo barato de bulk: debe resolver por su PROPIA regla explícita o, en su defecto, al
 * fallback pct (% de mercado).
 *
 * v1.29: DELEGA en la ÚNICA definición del catálogo canónico (`isPremiumCanonicalRarity`,
 * `common/rarity-catalog.ts`). Se RETIRA `PREMIUM_RARITY_PATTERNS` (que divergía de la de
 * `ppt-sync-scope.ts`); ahora hay UNA sola verdad de «premium» en todo el sistema (§4.28e). Los
 * verdictos en conflicto («Rare Holo» = NO premium, «Double Rare» = SÍ premium) los fija el catálogo.
 */
export function isPremiumRarity(rarity: string | null): boolean {
  return isPremiumCanonicalRarity(rarity);
}

/**
 * Candidatos de ruleKey EN ORDEN DE PRIORIDAD (gana el primero con regla explícita en
 * BUYLIST_PRICE_RULES; si ninguno → BUYLIST_PRICE_FALLBACK_PCT).
 *
 * Fase 0.1 (fix bug de dinero): la RAREZA REAL SIEMPRE va primero en los candidatos. Además, para
 * finish holofoil/1st-ed una rareza PREMIUM (chase) NO puede incluir la clave sintética "Holo"
 * (que el admin puede tener fija barata de bulk): solo su propia regla o el fallback pct. Antes,
 * una holo premium sin "holo" en el string (Illustration/Ultra/Double Rare, etc.) resolvía a
 * `['Holo']` y una chase de miles de pesos cotizaba al bin fijo barato — bug estructural.
 *
 *  - reverse_holo            → ["Reverse Holo"]
 *  - holofoil / 1st ed holo  → premium              ? [rarity]           (propia regla o fallback pct; NUNCA "Holo")
 *                              : isHoloRarity(rarity)? [rarity, "Holo"]  (holo de bulk: rareza real primero, luego "Holo")
 *                              :                        ["Holo"]          (Common/Uncommon: % del market holofoil, §4.2.1)
 *  - normal                  → [rarity] (regla de la rareza base)
 */
export function ruleKeyCandidates(rarity: string | null, finish: Finish): string[] {
  switch (finish) {
    case 'reverse_holo':
      return ['Reverse Holo'];
    case 'holofoil':
    case 'first_edition_holofoil':
      // Fase 0.1 (fix bug de dinero): una rareza PREMIUM (chase) NUNCA incluye "Holo" ni ningún bin
      // fijo de bulk. Solo su propia regla explícita o el fallback pct (% de mercado). La rareza real
      // va SIEMPRE primero. Cierra la vía por la que Illustration/Ultra/Double Rare, etc. (holo sin
      // "holo" en el string) cotizaban al bin fijo barato `['Holo']`.
      if (isPremiumRarity(rarity)) {
        return [rarity as string];
      }
      // NO premium: se preserva la semántica documentada en ARCHITECTURE §4.2.1 (guarda isHoloRarity):
      //  - holo de bulk (p. ej. "Rare Holo") → [rarity, "Holo"] (rareza real primero, luego "Holo").
      //  - Common/Uncommon (no-holo) → ["Holo"] → market holofoil (% ), NO su regla fija $0.50 de bulk
      //    (una copia holofoil de una común vale un % de su market holofoil, no $0.50). Ver §4.2.1.
      return isHoloRarity(rarity) ? [rarity as string, 'Holo'] : ['Holo'];
    case 'normal':
      return rarity != null ? [rarity] : [];
    default:
      return [];
  }
}

// ============================================================================
// v1.29 (§4.28d) — REGLAS DE PRECIO EN DOS EJES: rareza (de la carta) × acabado (de la variante).
// Reemplaza el mapa PLANO que mezclaba keys de rareza (`Common`) con keys SINTÉTICAS por-acabado
// (`Holo`/`Reverse Holo`, parcheadas a mano en el front INV-1). `rarityRules` se keyea por la RAREZA
// CANÓNICA; `finishRules` por el enum `Finish`. La precedencia CONSERVA la semántica de negocio
// vigente de `ruleKeyCandidates` (sin colisión de strings). Money-safe: rareza sin regla → fallback pct.
// ============================================================================
export interface PriceRuleSet<R extends BuylistRule | SalesRule = BuylistRule> {
  rarityRules: Record<string, R>; // eje RAREZA (de la carta), keyeado por rareza canónica
  finishRules: Partial<Record<Finish, R>>; // eje ACABADO (de la variante), keyeado por enum Finish
  fallbackPct: number;
}

/** ¿El objeto es un `PriceRuleSet` (dos ejes) y no un mapa plano legacy `Record<rarity, Rule>`? */
export function isPriceRuleSet(v: unknown): v is PriceRuleSet<BuylistRule | SalesRule> {
  return (
    v != null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    'rarityRules' in (v as object) &&
    'finishRules' in (v as object)
  );
}

/** Normaliza para el lookup case/espacio-insensible (empate 1:1 con la forma canónica del ingest). */
function normRuleKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/**
 * v1.29 (§4.28d) — construye un `PriceRuleSet` desde el valor almacenado, MIGRANDO EL LEGACY on-read:
 *  - si `raw` ya es dos ejes (`{ rarityRules, finishRules }`) → se usa tal cual;
 *  - si `raw` es el mapa PLANO legacy → se PARTE: `Holo`→`finishRules.holofoil`, `Reverse Holo`→
 *    `finishRules.reverse_holo`; el resto → `rarityRules` con su key CANONICALIZADA. Reproduce EXACTO
 *    el negocio vigente (§E.1). `fallbackPct` viene del dial separado (money-safe: rareza sin regla → fallback).
 */
export function toPriceRuleSet<R extends BuylistRule | SalesRule>(
  raw: unknown,
  fallbackPct: number,
): PriceRuleSet<R> {
  if (isPriceRuleSet(raw)) {
    const rs = raw as PriceRuleSet<R>;
    return {
      rarityRules: rs.rarityRules ?? {},
      finishRules: rs.finishRules ?? {},
      fallbackPct: typeof rs.fallbackPct === 'number' ? rs.fallbackPct : fallbackPct,
    };
  }
  const flat =
    raw != null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, R>) : {};
  const rarityRules: Record<string, R> = {};
  const finishRules: Partial<Record<Finish, R>> = {};
  for (const [k, v] of Object.entries(flat)) {
    const nk = normRuleKey(k);
    if (nk === 'holo' || nk === 'holofoil') finishRules.holofoil = v;
    else if (nk === 'reverseholo' || nk === 'reverseholofoil') finishRules.reverse_holo = v;
    else if (nk === '1steditionholofoil' || nk === 'firsteditionholofoil')
      finishRules.first_edition_holofoil = v;
    else rarityRules[normalizeRarity(k) ?? k] = v;
  }
  return { rarityRules, finishRules, fallbackPct };
}

/** Regla de FINISH para el acabado dado (1st-ed holo hereda la de holofoil si no tiene propia). */
function finishRuleFor<R extends BuylistRule | SalesRule>(
  finish: Finish,
  set: PriceRuleSet<R>,
): R | undefined {
  switch (finish) {
    case 'reverse_holo':
      return set.finishRules.reverse_holo;
    case 'holofoil':
      return set.finishRules.holofoil;
    case 'first_edition_holofoil':
      return set.finishRules.first_edition_holofoil ?? set.finishRules.holofoil;
    default:
      return undefined; // `normal` no tiene eje de acabado
  }
}

/**
 * §4.28d — resolver de DOS EJES. Espeja EXACTAMENTE `ruleKeyCandidates` sin fabricar keys sintéticas:
 *  - `normal`        → regla de RAREZA (canónica) o fallback.
 *  - `reverse_holo`  → regla de ACABADO `finishRules.reverse_holo` o fallback (NUNCA usa rareza).
 *  - `holofoil`/1st  → premium ⇒ regla de RAREZA o fallback (jamás el bin de acabado de bulk);
 *                      no-premium & holo (p. ej. «Rare Holo») ⇒ rareza ?? finishRule ?? fallback;
 *                      no-premium & no-holo (Common/Uncommon) ⇒ finishRule (% del market holofoil) o fallback.
 * La rareza se NORMALIZA a canónica antes del lookup (§4.28c, «cinturón y tirantes»).
 */
function resolveTwoAxisRule<R extends BuylistRule | SalesRule>(
  rarity: string | null,
  finish: Finish,
  set: PriceRuleSet<R>,
): R | null {
  const canonical = normalizeRarity(rarity);
  const rarityRule = lookupRarityRule(set.rarityRules, canonical);
  const premium = isPremiumCanonicalRarity(rarity);
  switch (finish) {
    case 'reverse_holo':
      return finishRuleFor(finish, set) ?? null;
    case 'holofoil':
    case 'first_edition_holofoil':
      if (premium) return rarityRule ?? null;
      if (isHoloRarity(canonical)) return rarityRule ?? finishRuleFor(finish, set) ?? null;
      return finishRuleFor(finish, set) ?? null;
    case 'normal':
      return rarityRule ?? null;
    default:
      return null;
  }
}

/** Busca la regla por rareza CANÓNICA (exacta primero, luego normalizada — case/espacio-insensible). */
function lookupRarityRule<R extends BuylistRule | SalesRule>(
  rarityRules: Record<string, R>,
  canonical: string | null,
): R | undefined {
  if (canonical == null) return undefined;
  if (rarityRules[canonical] != null) return rarityRules[canonical];
  const target = normRuleKey(canonical);
  for (const [k, v] of Object.entries(rarityRules)) {
    if (normRuleKey(k) === target) return v;
  }
  return undefined;
}

/**
 * Resuelve la regla efectiva `(rarity, finish)` sobre CUALQUIERA de las dos formas de tabla:
 *  - `PriceRuleSet` (dos ejes, PRODUCCIÓN v1.29) → `resolveTwoAxisRule`.
 *  - `Record<string, Rule>` (mapa PLANO legacy / tests) → `ruleKeyCandidates` + lookup normalizado.
 * Devuelve `{ rule, ruleSource }`; sin regla explícita ⇒ `{ pct fallbackPct, 'fallback' }`.
 */
function resolveRuleForFinish<R extends BuylistRule | SalesRule>(
  rarity: string | null,
  finish: Finish,
  rules: PriceRuleSet<R> | Record<string, R>,
  fallbackPct: number,
): { rule: R | BuylistRule; ruleSource: 'rule' | 'fallback' } {
  if (isPriceRuleSet(rules)) {
    const rule = resolveTwoAxisRule(rarity, finish, rules as PriceRuleSet<R>);
    return rule != null ? { rule, ruleSource: 'rule' } : { rule: { mode: 'pct', value: fallbackPct }, ruleSource: 'fallback' };
  }
  // Mapa PLANO legacy: candidatos sintéticos + lookup exacto y normalizado (§4.28c).
  const flat = rules as Record<string, R>;
  const candidates = ruleKeyCandidates(rarity, finish);
  for (const k of candidates) {
    if (flat[k] != null) return { rule: flat[k], ruleSource: 'rule' };
  }
  for (const c of candidates) {
    const target = normRuleKey(c);
    for (const [k, v] of Object.entries(flat)) {
      if (normRuleKey(k) === target) return { rule: v, ruleSource: 'rule' };
    }
  }
  return { rule: { mode: 'pct', value: fallbackPct }, ruleSource: 'fallback' };
}

/** Aplica una regla ya resuelta (misma lógica que quoteAcquisition §4.2). */
function applyRule(
  rule: BuylistRule,
  ruleSource: AcquisitionRuleSource,
  referenceMxnCents: number | null,
): AcquisitionQuote {
  if (rule.mode === 'fixed') {
    // BE-27: clamp final (no-op para un fixed ya validado <= FIXED_CENTS_MAX; defensivo si se coló).
    return { quotedPriceCents: clampCents(rule.value), status: 'cotizada', appliedRule: rule, ruleSource };
  }
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return {
    quotedPriceCents: clampCents(Math.round((referenceMxnCents * rule.value) / 100)),
    status: 'cotizada',
    appliedRule: rule,
    ruleSource,
  };
}

/**
 * AcquisitionPricer POR ACABADO (v1.6-finish, función pura). ARCHITECTURE §4.2.1.
 * `referenceMxnCentsForFinish` = PriceReference.priceMxnCents del ACABADO cotizado
 * (`getReference(..., finish)`). Para `first_edition_holofoil`, esa referencia es la de la
 * llave `1stEditionHolofoil`. SEC-A1: rarity/finish derivados server-side y finish validado
 * contra card.availableFinishes por el caller ANTES de cotizar.
 *
 * v1.28 (P-18/P-22, §4.26b) — GANA el parámetro opcional `controls` (fila M-30 de la variante;
 * omitido/null = comportamiento actual intacto). Precedencia NORMATIVA de COMPRA (money-safe):
 *   1. bountyEnabled && bountyPriceCents > 0 → bountyPriceCents      (source = "bounty")
 *   2. buyOverrideCents > 0                  → buyOverrideCents      (source = "override")
 *   3. BUYLIST_PRICE_RULES / fallback (hoy)  → fixed | pct × ref     (source = "rule" | "fallback")
 *   4. pct sin referencia                    → precio_pendiente/null (JAMÁS inventar)
 * Bounty y override actúan como `fixed`: NO dependen de la referencia ⇒ siempre 'cotizada'.
 * Este es el ÚNICO cuerpo de la precedencia de compra: publicQuote, batchQuote, createRequest y
 * (P-22) /buylist/bounties DEBEN pasar por aquí — prohibido duplicarlo.
 */
export function quoteAcquisitionForFinish(
  rarity: string | null,
  finish: Finish,
  referenceMxnCentsForFinish: number | null,
  // v1.29 (§4.28d): acepta el `PriceRuleSet` de DOS EJES (producción) o el mapa PLANO legacy (tests).
  rules: PriceRuleSet<BuylistRule> | Record<string, BuylistRule>,
  fallbackPct: number,
  controls?: VariantPriceControls | null,
): AcquisitionQuote {
  // 1. Bounty activo (precio SIEMPRE explícito > 0; un <= 0 degenerado se trata como ausente).
  if (controls?.bountyEnabled && controls.bountyPriceCents != null && controls.bountyPriceCents > 0) {
    return applyRule({ mode: 'fixed', value: controls.bountyPriceCents }, 'bounty', referenceMxnCentsForFinish);
  }
  // 2. Override manual de compra de la variante (misma regla de presencia > 0).
  if (controls?.buyOverrideCents != null && controls.buyOverrideCents > 0) {
    return applyRule({ mode: 'fixed', value: controls.buyOverrideCents }, 'override', referenceMxnCentsForFinish);
  }
  // 3./4. Cadena de reglas de SIEMPRE (dos ejes o plano; misma semántica de negocio).
  const { rule, ruleSource } = resolveRuleForFinish(rarity, finish, rules, fallbackPct);
  return applyRule(rule as BuylistRule, ruleSource, referenceMxnCentsForFinish);
}

/**
 * v1.13-sales-pricing (§4.14b) — precio de VENTA por RAREZA. Misma FORMA que BuylistRule pero la
 * matemática del `pct` es DISTINTA (ver `computeSalePriceForRarity`).
 * value = centavos MXN (piso) si mode='fixed'; % de MARKUP ARRIBA de mercado si mode='pct'.
 */
export type SalesRuleMode = 'fixed' | 'pct';
export interface SalesRule {
  mode: SalesRuleMode;
  value: number;
}

/**
 * v1.28 (P-18, §4.26b) — fuente del peldaño que GANÓ el precio de venta derivado. ADITIVO:
 * `override` = sellOverrideCents de la variante (M-30). El paso 1 de la precedencia de VENTA
 * (`InventoryItem.listPriceCents`, POR PIEZA) NO pasa por aquí: lo aplican los callers ANTES
 * (comportamiento actual intacto — la intención más específica gana).
 */
export type SaleRuleSource = 'override' | 'rule' | 'fallback';

export interface SalePriceResult {
  salePriceCents: number | null;
  status: 'priced' | 'pending';
  /** Regla efectivamente aplicada (explícita o fallback; override ⇒ fixed sintética). */
  appliedRule: SalesRule;
  /**
   * "rule" = fila explícita en SALES_PRICE_RULES; "fallback" = SALES_PRICE_FALLBACK_PCT.
   * v1.28: además "override" cuando el sellOverride por variante (M-30) ganó la precedencia.
   */
  ruleSource: SaleRuleSource;
}

/**
 * Precio de VENTA por RAREZA (función pura, v1.13-sales-pricing). ARCHITECTURE §4.14b.
 * Análoga a `quoteAcquisitionForFinish` (§4.2.1): REUSA `ruleKeyCandidates(rarity, finish)`, por lo
 * que hereda el **gate premium de Fase 0** — una rareza chase en holofoil/1st-ed holo NUNCA cae al
 * piso fijo sintético "Holo" de bulk: resuelve por su propia regla o el fallback pct (markup sobre market).
 *
 *   - fixed → PISO en centavos; NO depende del mercado → SIEMPRE precia (mejora: una bulk sin market
 *     obtiene precio de venta piso y puede volverse sellable).
 *   - pct   → MARKUP ARRIBA DE MERCADO: sale = round(market × (1 + value/100)). Si falta referencia →
 *     'pending' (sin precio; el llamador decide, como el legacy computeSalePrice).
 *
 * DIVERGENCIA DE SEMÁNTICA vs. COMPRA (crítico, no confundir): en buylist/compra (§4.2) `pct` = *% de*
 * la referencia → `round(ref × value/100)`; aquí `pct` = *% ARRIBA de* mercado → `round(ref × (1 +
 * value/100))`. Un mismo value=40 da 40% del market comprando y 140% del market vendiendo. La forma del
 * dato es idéntica; solo cambia la fórmula del pct.
 *
 * SEC-A1: rarity de `Card.rarity` (BD), finish de `InventoryItem.finish` (BD); nunca del cliente.
 *
 * v1.28 (P-18, §4.26b) — GANA el parámetro opcional `controls` (fila M-30 de la variante; omitido/
 * null = comportamiento actual intacto). Precedencia NORMATIVA de VENTA (money-safe):
 *   1. item.listPriceCents (POR PIEZA)  → la aplican los CALLERS antes de llamar aquí (intacto)
 *   2. sellOverrideCents > 0 (variante) → fija el precio publicado    (ruleSource = "override")
 *   3. SALES_PRICE_RULES / fallback     → derivado por rareza+acabado (ruleSource = "rule"|"fallback")
 *   4. no resoluble                     → 'pending' / null            (PRICE_PENDING, jamás inventar)
 * El override actúa como `fixed`: NO depende del mercado ⇒ siempre 'priced'. Un sellOverride <= 0
 * es input degenerado y se trata como AUSENTE (misma regla H-1; BE-26 en los callers remata).
 */
export function computeSalePriceForRarity(
  rarity: string | null,
  finish: Finish,
  referenceMxnCents: number | null,
  // v1.29 (§4.28d): acepta el `PriceRuleSet` de DOS EJES (producción) o el mapa PLANO legacy (tests).
  rules: PriceRuleSet<SalesRule> | Record<string, SalesRule>,
  fallbackPct: number,
  controls?: VariantPriceControls | null,
): SalePriceResult {
  // 2. Override de venta de la variante (M-30): fixed sintético, siempre 'priced'.
  if (controls?.sellOverrideCents != null && controls.sellOverrideCents > 0) {
    return {
      salePriceCents: clampCents(controls.sellOverrideCents),
      status: 'priced',
      appliedRule: { mode: 'fixed', value: controls.sellOverrideCents },
      ruleSource: 'override',
    };
  }
  // §4.28d — dos ejes o plano; hereda el gate premium (§4.2.1) vía la misma precedencia.
  const resolved = resolveRuleForFinish(rarity, finish, rules, fallbackPct);
  const rule: SalesRule = resolved.rule as SalesRule;
  const ruleSource: 'rule' | 'fallback' = resolved.ruleSource;

  if (rule.mode === 'fixed') {
    // PISO fijo en centavos; NO depende de la referencia → siempre 'priced'.
    // BE-27: clamp final (no-op para un fixed ya validado <= FIXED_CENTS_MAX; defensivo si se coló).
    return { salePriceCents: clampCents(rule.value), status: 'priced', appliedRule: rule, ruleSource };
  }
  // pct = MARKUP ARRIBA DE MERCADO (DISTINTO de buylist, que es ref × value/100).
  if (referenceMxnCents == null) {
    return { salePriceCents: null, status: 'pending', appliedRule: rule, ruleSource };
  }
  return {
    salePriceCents: clampCents(Math.round(referenceMxnCents * (1 + rule.value / 100))),
    status: 'priced',
    appliedRule: rule,
    ruleSource,
  };
}

/**
 * v1.23-sealed-sales (§4.23b) — precio de VENTA del SELLADO por PRESENTACIÓN. Hermana de
 * `computeSalePriceForRarity`, keyeada por `SealedSubtype` en vez de rareza+acabado.
 * `source` = de dónde salió el precio (SealedSpreadSource del contrato).
 */
export type SealedSpreadSource = 'override' | 'subtype_spread' | 'global_spread';
export interface SealedSpreadResult {
  salePriceCents: number | null;
  status: 'priced' | 'pending';
  source: SealedSpreadSource;
  /** null cuando source='override'. */
  appliedSpreadPct: number | null;
}

/**
 * Precedencia money-safe (SEC-A1, todo server-side — ARCHITECTURE §4.23a):
 *   override (InventoryItem.listPriceCents), SI es > 0            ← gana SIEMPRE si presente y positivo
 *     > mercado × (1 + spread_de_su_presentación/100)             ← si hay market y su SealedSubtype tiene spread
 *     > mercado × (1 + spread_global/100)                         ← si hay market pero sin spread de presentación
 *     > (sin precio) ⇒ PRICE_PENDING ⇒ NO se publica              ← sin mercado y sin override, NUNCA se inventa
 *
 * REGLA ÚNICA DE OVERRIDE (H-1, v1.24): un override se considera presente SOLO si `overrideCents > 0`.
 * Un override `<= 0` (0 o negativo) es INPUT DEGENERADO y se trata como AUSENTE — el precio cae a
 * mercado×spread (y a PRICE_PENDING si tampoco hay mercado). Elección money-safe: nunca se cobra un
 * sellado GRATIS ni por DEBAJO de mercado por un override mal capturado; para descontar una caja con
 * detalle el admin fija un override POSITIVO por debajo de mercado (deliberado), no un 0. Esta regla
 * es la MISMA en catálogo, Compra (orders), grid y bulk-publish (todos vía `resolveSealedSalePrice`).
 *
 * La condición NO altera el precio (el spread es por presentación). `pct` = markup ARRIBA de mercado
 * (como ventas §4.14, NO «% de la referencia» del buylist). `subtype`/`market`/`override` salen de BD;
 * los spreads de ConfigSetting. Nada viene del DTO del cliente.
 */
export function computeSealedSalePrice(
  overrideCents: number | null,
  sealedSubtype: string | null,
  marketMxnCents: number | null,
  spreadPctBySubtype: Record<string, number>,
  fallbackPct: number,
): SealedSpreadResult {
  // H-1: override presente ⇔ > 0 (un 0/negativo es degenerado ⇒ se ignora, cae a mercado×spread).
  if (overrideCents != null && overrideCents > 0) {
    // BE-27: clamp final del override (persistible en `*Cents`, Int32).
    return { salePriceCents: clampCents(overrideCents), status: 'priced', source: 'override', appliedSpreadPct: null };
  }
  const hasSubtypeSpread = sealedSubtype != null && spreadPctBySubtype[sealedSubtype] != null;
  const spread = hasSubtypeSpread ? spreadPctBySubtype[sealedSubtype as string] : fallbackPct;
  const source: SealedSpreadSource = hasSubtypeSpread ? 'subtype_spread' : 'global_spread';
  if (marketMxnCents == null) {
    // Sin mercado y sin override → pendiente (no publicable). NUNCA se inventa un precio.
    return { salePriceCents: null, status: 'pending', source, appliedSpreadPct: spread };
  }
  return {
    salePriceCents: clampCents(Math.round(marketMxnCents * (1 + spread / 100))),
    status: 'priced',
    source,
    appliedSpreadPct: spread,
  };
}

export interface BreakdownDTO {
  subtotalCents: number;
  ivaCents: number;
  ivaRatePct: number;
  processingFeeCents: number;
  totalCents: number;
  currency: 'MXN';
}

/**
 * v1.21-guest-checkout — `BreakdownDTO` + la línea de envío cobrada DENTRO de la misma orden
 * (`direct_ship`). Aditivo: un `DirectShipBreakdownDTO` ES un `BreakdownDTO` válido.
 */
export interface DirectShipBreakdownDTO extends BreakdownDTO {
  /** Tarifa de envío (dial `SHIPPING_FEE_CENTS`) cobrada en el MISMO PaymentIntent. */
  shippingFeeCents: number;
}

/**
 * Desglose de compra de cartas. ARCHITECTURE §5.1.
 *   subtotal = Σ salePrice
 *   iva      = round(subtotal × ivaPct/100)                (IVA grava el subtotal)
 *   base     = subtotal + iva                              (lo que la plataforma recibe íntegro)
 *   total    = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct))   (gross-up con IVA de Stripe)
 *   fee      = total − base                                (línea visible; incluye el IVA de la comisión Stripe)
 */
export function computeCartBreakdown(
  subtotalCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  const ivaCents = Math.round((subtotalCents * ivaPct) / 100);
  const baseCents = subtotalCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Desglose de retiro/envío. ARCHITECTURE §5.1.
 * El IVA grava la tarifa de envío; el fee es gross-up (sin IVA).
 * En el DTO, subtotalCents = tarifa de envío (ver API_CONTRACT §5).
 */
export function computeShipmentBreakdown(
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): BreakdownDTO {
  const ivaCents = Math.round((shippingFeeCents * ivaPct) / 100);
  const baseCents = shippingFeeCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents: shippingFeeCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * v1.21-guest-checkout (§4-G.1/§4-G.2) — desglose de una compra con ENVÍO DIRECTO (`direct_ship`).
 * ADITIVA: `computeCartBreakdown` y `computeShipmentBreakdown` NO se tocan.
 *
 * Diferencia estructural con el flujo de bóveda: el envío se cobra en el MISMO PaymentIntent que
 * las cartas (el invitado no tiene bóveda desde donde pedir un segundo retiro), así que:
 *   subtotal = Σ salePrice                      (solo cartas; es lo que el DTO llama subtotalCents)
 *   iva      = round((subtotal + envío) × ivaPct/100)   (el IVA grava cartas Y tarifa de envío)
 *   base     = subtotal + envío + iva           (lo que la plataforma debe recibir íntegro)
 *   total    = grossUp(base)                    (misma fórmula de gross-up, incl. IVA de la comisión)
 *   fee      = total − base
 *
 * `shippingFeeCents` viaja aparte del `subtotalCents` para que la UI lo muestre como línea propia
 * y para que el P&L (M7) lo lea de `Order.shippingFeeCents` sin doble conteo (ARCHITECTURE §4.21b).
 */
export function computeDirectShipBreakdown(
  subtotalCents: number,
  shippingFeeCents: number,
  ivaPct: number,
  fee: StripeFeeConfig,
): DirectShipBreakdownDTO {
  const taxableCents = subtotalCents + shippingFeeCents;
  const ivaCents = Math.round((taxableCents * ivaPct) / 100);
  const baseCents = taxableCents + ivaCents;
  const totalCents = grossUpTotal(baseCents, fee);
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents,
    shippingFeeCents,
    ivaCents,
    ivaRatePct: ivaPct,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Gross-up del total para que, tras la comisión Stripe (pct + fija) MÁS el IVA que
 * Stripe MX cobra sobre esa comisión, la plataforma reciba íntegro `baseCents`.
 *
 * C1: la deducción real de Stripe es `(1 + ivaFee) × (pct × total + fija)`. Resolviendo
 * `total − (1+ivaFee)(pct·total + fija) = base`:
 *   total = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct)).
 *
 * MS-2 (BE-27): CHOKE POINT del overflow de AGREGADOS. Todo breakdown (cart/shipment/direct-ship)
 * deriva su `totalCents` aquí, y `total >= base >= subtotal` (y `>= iva`, `>= processingFee`), así
 * que un total representable garantiza que TODOS los `*Cents` persistidos en `Order` caben en Int32.
 * Un agregado NO se puede CLAMPAR en silencio (recortar el total = subcobro): si excede `MAX_CENTS`
 * se **LANZA** (mismo patrón de `throw` de las guardias de fee de arriba) en vez de reventar al
 * persistir la Order (excepción Postgres = DoS del checkout). El caller de negocio (orders/checkout)
 * lo traduce a `AMOUNT_TOO_LARGE` (422). El clamp UNITARIO de `clampCents` es red de última instancia
 * aparte; el agregado es la señal fuerte y visible (ver nota MS-3 en `clampCents`).
 */
export function grossUpTotal(baseCents: number, fee: StripeFeeConfig): number {
  const ivaMul = 1 + fee.stripeFeeIvaPct;
  if (fee.stripeFeeIvaPct < 0 || !Number.isFinite(fee.stripeFeeIvaPct)) {
    throw new Error('stripeFeeIvaPct must be a finite number >= 0');
  }
  const effectivePct = fee.stripePct * ivaMul;
  if (effectivePct < 0 || effectivePct >= 1) {
    throw new Error('effective stripe pct (stripePct × (1 + stripeFeeIvaPct)) must be in [0, 1)');
  }
  const effectiveFixed = fee.stripeFixedCents * ivaMul;
  const total = Math.ceil((baseCents + effectiveFixed) / (1 - effectivePct));
  // MS-2: agregado no representable en Int32 → se RECHAZA (nunca se clampa: recortar = subcobro).
  if (total > MAX_CENTS) {
    throw new Error('total exceeds MAX_CENTS (Int32) — order amount not representable');
  }
  return total;
}

/** Precio MXN desde USD con FX + colchón. ARCHITECTURE §3.2 FxRate. */
export function usdToMxnCents(priceUsdCents: number, rate: number, bufferPct: number): number {
  return clampCents(Math.round(priceUsdCents * rate * (1 + bufferPct / 100)));
}
