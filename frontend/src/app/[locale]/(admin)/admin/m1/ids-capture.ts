/**
 * §IDS.4 (v1.116.1⟨ids⟩) / DESIGN_SYSTEM §IDS-UX.2 + IDS-UX.8 (captura, opción A del dueño) — modelo PURO de los dos
 * controles «Idioma» y «Versión» (y del «Acabado × Versión» de D-IDS-5) sobre `GET …/cards/:cardId/versions`.
 * Todo sale de `combos` (acabado × idioma × versión) y `candidates`; el precio es `previewPriceCents` del servidor
 * (⛔ el navegador no calcula precio). Inglés + sin liga + acabado de la carta = 0 toques (IDS-F1).
 *
 * **Modo casilla (`slot`, A2 v1.116.8 I-6 «Acabado del alta»):** desde el cajón del binder el acabado NO se elige, se
 * RESUELVE por versión: sin liga ⇒ el de la casilla `F`; liga `P` con `F ∈ P.finishes` ⇒ `F`; `P` con un solo acabado
 * ≠ `F` ⇒ ese, implícito (la burbuja lo nombra); `P` con varios y ninguno `F` ⇒ hay que elegir entre `P.finishes`
 * (`chosenFinish`, sin preselección). Una burbuja se apaga solo si el combo del acabado resuelto falta o trae motivo
 * (con varios acabados, si ninguno está disponible); ya no por «no existe con este acabado».
 */
import type {
  CardLanguage,
  CardVersionsResponse,
  Finish,
  StampDTO,
  VersionComboDTO,
  VersionUnavailableReason,
} from '@/types/contract';
import { CARD_LANGUAGES } from '@/types/contract';
import { FINISH_ORDER } from '@/lib/finish';

/** Motivo de una opción apagada: el del servidor o que la combinación no existe con lo elegido. */
export type CaptureDisabledReason = VersionUnavailableReason | 'combo_missing';

/** A2: cómo se resolvió el acabado del alta desde la casilla. */
export type AltaFinishMode = 'slot' | 'implicit' | 'choose';

export interface CaptureVersionOption {
  /** `none` (sin liga) o el `productId` del producto de liga. */
  key: string;
  stamp: StampDTO | null;
  disabledReason: CaptureDisabledReason | null;
  /** A2: acabado con el que se daría de alta ESTA versión (`null` = la liga tiene varios y hay que elegir). */
  altaFinish: Finish | null;
  /** A2: la liga solo existe en un acabado distinto al de la casilla ⇒ la burbuja lo nombra («… (Holo)»). */
  implicitFinish: boolean;
}

export interface CaptureModel {
  /** La fila «Versión» solo existe si la carta tiene productos de liga colgados o candidatas (IDS-F1). */
  showVersionRow: boolean;
  /** Burbujas de acabado (unión de `combos`) cuando la liga trae acabados que la carta no tiene o hay dos del mismo tipo; `null` = el control de siempre. */
  finishOptions: Finish[] | null;
  languageOptions: { language: CardLanguage; disabledReason: CaptureDisabledReason | null }[];
  versionOptions: CaptureVersionOption[];
  /** El `stampProductId` efectivo (si el elegido se apagó por acabado, el único/primer válido). */
  stampProductId: number | null;
  /** La combinación elegida, o `null` si no existe. */
  combo: VersionComboDTO | null;
  /** ¿Se puede crear con lo elegido? (combinación existente y con precio). */
  canCreate: boolean;
  /**
   * TL-ALTA-5: ¿la carta tiene algo que elegir? (español con precio, liga o candidatas). Solo inglés sin liga ⇒ `false`.
   * `combos` SIEMPRE trae (acabados × {en, es}) (§IDS.4): el español cuenta solo si se puede crear (con precio).
   */
  hasVersions: boolean;
  /** A2: acabado resuelto del alta (fuera del modo casilla, el elegido). `null` solo en modo `choose` sin elección. */
  altaFinish: Finish | null;
  altaFinishMode: AltaFinishMode;
  /** A2: en modo `choose`, los acabados de la liga elegida en el orden del servidor; si no, `[]`. */
  altaFinishOptions: Finish[];
}

/** A2: modo casilla. `chosenFinish` = lo elegido en la fila «Acabado» (solo cuenta si la liga tiene varios). */
export interface SlotOptions {
  chosenFinish: Finish | null;
}

const stampIdOf = (c: { stamp: StampDTO | null }) => c.stamp?.productId ?? null;

function reasonFor(
  combos: VersionComboDTO[],
  finish: Finish,
  language: CardLanguage,
  stampProductId: number | null,
): CaptureDisabledReason | null {
  const c = combos.find((x) => x.finish === finish && x.language === language && stampIdOf(x) === stampProductId);
  if (!c) return 'combo_missing';
  return c.unavailableReason;
}

interface FinishResolution {
  finish: Finish | null;
  mode: AltaFinishMode;
  /** Acabados del producto, en el orden del servidor (vacío sin liga). */
  productFinishes: Finish[];
}

/** A2: el acabado con el que se da de alta la versión `stampProductId` desde la casilla `slotFinish`. */
function resolveAltaFinish(
  combos: VersionComboDTO[],
  slotFinish: Finish,
  stampProductId: number | null,
  chosenFinish: Finish | null,
): FinishResolution {
  if (stampProductId == null) return { finish: slotFinish, mode: 'slot', productFinishes: [] };
  const productFinishes: Finish[] = [];
  for (const c of combos) if (stampIdOf(c) === stampProductId && !productFinishes.includes(c.finish)) productFinishes.push(c.finish);
  if (productFinishes.includes(slotFinish)) return { finish: slotFinish, mode: 'slot', productFinishes };
  if (productFinishes.length === 1) return { finish: productFinishes[0], mode: 'implicit', productFinishes };
  return {
    finish: chosenFinish != null && productFinishes.includes(chosenFinish) ? chosenFinish : null,
    mode: 'choose',
    productFinishes,
  };
}

/**
 * A2: motivo de la burbuja (idioma, versión) en modo casilla: el del combo del acabado resuelto; con varios acabados y
 * nada elegido, apagada solo si NINGUNO está disponible (motivo del primero).
 */
function slotReasonFor(
  combos: VersionComboDTO[],
  language: CardLanguage,
  stampProductId: number | null,
  res: FinishResolution,
): CaptureDisabledReason | null {
  if (res.finish != null) return reasonFor(combos, res.finish, language, stampProductId);
  const reasons = res.productFinishes.map((f) => reasonFor(combos, f, language, stampProductId));
  return reasons.every((r) => r != null) ? (reasons[0] ?? 'combo_missing') : null;
}

export function captureModel(
  data: CardVersionsResponse | undefined,
  cardFinishes: readonly Finish[],
  finish: Finish,
  language: CardLanguage,
  stampProductId: number | null,
  slot?: SlotOptions,
): CaptureModel {
  if (!data) {
    // Sin respuesta (cargando o error): los controles de siempre; el servidor valida al crear.
    return {
      showVersionRow: false,
      finishOptions: null,
      languageOptions: CARD_LANGUAGES.map((l) => ({ language: l, disabledReason: null })),
      versionOptions: [],
      stampProductId: null,
      combo: null,
      canCreate: true,
      hasVersions: false,
      altaFinish: finish,
      altaFinishMode: 'slot',
      altaFinishOptions: [],
    };
  }
  const { combos, candidates } = data;
  const stamps: StampDTO[] = [];
  for (const c of combos) if (c.stamp && !stamps.some((s) => s.productId === c.stamp!.productId)) stamps.push(c.stamp);

  const comboFinishes = new Set(combos.map((c) => c.finish));
  const extraFinish = [...comboFinishes].some((f) => !cardFinishes.includes(f));
  const sameType = stamps.some((s, i) => stamps.findIndex((o) => o.type === s.type) !== i);
  const finishOptions =
    stamps.length > 0 && (extraFinish || sameType) ? FINISH_ORDER.filter((f) => comboFinishes.has(f)) : null;

  // Fuera del modo casilla el acabado es el elegido para TODA versión (la que no existe con él se apaga, `combo_missing`).
  const resolve = (id: number | null): FinishResolution =>
    slot ? resolveAltaFinish(combos, finish, id, slot.chosenFinish) : { finish, mode: 'slot', productFinishes: [] };
  const reason = (lang: CardLanguage, id: number | null, res: FinishResolution) =>
    slot ? slotReasonFor(combos, lang, id, res) : reasonFor(combos, finish, lang, id);

  const options = (lang: CardLanguage): CaptureVersionOption[] =>
    [null, ...stamps].map((s) => {
      const id = s?.productId ?? null;
      const res = resolve(id);
      return {
        key: s ? String(s.productId) : 'none',
        stamp: s,
        disabledReason: reason(lang, id, res),
        altaFinish: res.finish,
        implicitFinish: res.mode === 'implicit',
      };
    });

  // Si lo elegido no existe con este acabado, se pasa a la primera versión que sí exista (IDS-UX.2).
  let effective = stampProductId;
  const current = options(language).find((o) => (o.stamp?.productId ?? null) === effective);
  if (!current || current.disabledReason === 'combo_missing') {
    const firstValid = options(language).find((o) => o.disabledReason !== 'combo_missing');
    effective = firstValid ? firstValid.stamp?.productId ?? null : effective;
  }

  const resolved = resolve(effective);
  const combo =
    resolved.finish != null
      ? combos.find((c) => c.finish === resolved.finish && c.language === language && stampIdOf(c) === effective) ?? null
      : null;
  return {
    // §ALTA-LIGA-2: con `canAddManual` la fila sale siempre (trae el botón «+ Versión de liga»).
    showVersionRow: stamps.length > 0 || candidates.length > 0 || data.canAddManual === true,
    finishOptions,
    languageOptions: CARD_LANGUAGES.map((l) => ({ language: l, disabledReason: reason(l, effective, resolved) })),
    versionOptions: options(language),
    stampProductId: effective,
    combo,
    // Inglés sin liga se crea como hoy aunque no tenga precio (sigue el camino de siempre: cola de pendientes, I-1);
    // una versión no default sin precio NO se crea (IDS-UX.2: apagada, sin cola ni aviso, I-3).
    canCreate:
      (language === 'en' && effective == null) ||
      (combo != null && combo.unavailableReason == null && combo.previewPriceCents != null),
    hasVersions:
      candidates.length > 0 ||
      combos.some((c) => c.stamp != null || (c.language !== 'en' && c.unavailableReason == null && c.previewPriceCents != null)),
    altaFinish: resolved.finish,
    altaFinishMode: resolved.mode,
    altaFinishOptions: resolved.mode === 'choose' ? resolved.productFinishes : [],
  };
}

/**
 * I-1 (QA 2026-11-05): la referencia con la que el backend COSTEA la aportación de una versión no default
 * (`inventory.service.ts` `versionReferenceForAlta` = `SaleDecisionService.versionReferences(...).price`): la base del combo
 * (`R_P` de la liga; `R_en` en español) y, en español, `× X` con el redondeo de `common/card-version.ts` `scaleByPct`.
 * Sin base o sin X ⇒ `null` (el servidor responde `PRICE_PENDING`; la tarjeta «Aportación» se bloquea). Espejo declarado:
 * cuando el contrato exponga esta cifra en `VersionComboDTO`, esta función se sustituye por leerla.
 */
export function versionContributionReferenceCents(combo: VersionComboDTO | null): number | null {
  if (!combo || combo.baseReferenceMxnCents == null) return null;
  if (combo.language !== 'es') return combo.baseReferenceMxnCents;
  if (combo.appliedMarketPct == null) return null;
  return Math.floor((combo.baseReferenceMxnCents * combo.appliedMarketPct + 50) / 100);
}
