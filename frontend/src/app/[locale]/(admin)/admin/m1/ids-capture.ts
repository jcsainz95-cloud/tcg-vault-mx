/**
 * §IDS.4 (v1.116.1⟨ids⟩) / DESIGN_SYSTEM §IDS-UX.2 + IDS-UX.8 (captura, opción A del dueño) — modelo PURO de los dos
 * controles «Idioma» y «Versión» (y del «Acabado × Versión» de D-IDS-5) sobre `GET …/cards/:cardId/versions`.
 * Todo sale de `combos` (acabado × idioma × versión) y `candidates`; el precio es `previewPriceCents` del servidor
 * (⛔ el navegador no calcula precio). Inglés + sin liga + acabado de la carta = 0 toques (IDS-F1).
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

export interface CaptureVersionOption {
  /** `none` (sin liga) o el `productId` del producto de liga. */
  key: string;
  stamp: StampDTO | null;
  disabledReason: CaptureDisabledReason | null;
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

export function captureModel(
  data: CardVersionsResponse | undefined,
  cardFinishes: readonly Finish[],
  finish: Finish,
  language: CardLanguage,
  stampProductId: number | null,
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

  const options = (lang: CardLanguage): CaptureVersionOption[] => [
    { key: 'none', stamp: null, disabledReason: reasonFor(combos, finish, lang, null) },
    ...stamps.map((s) => ({ key: String(s.productId), stamp: s, disabledReason: reasonFor(combos, finish, lang, s.productId) })),
  ];

  // Si lo elegido no existe con este acabado, se pasa a la primera versión que sí exista (IDS-UX.2).
  let effective = stampProductId;
  const current = options(language).find((o) => (o.stamp?.productId ?? null) === effective);
  if (!current || current.disabledReason === 'combo_missing') {
    const firstValid = options(language).find((o) => o.disabledReason !== 'combo_missing');
    effective = firstValid ? firstValid.stamp?.productId ?? null : effective;
  }

  const combo =
    combos.find((c) => c.finish === finish && c.language === language && stampIdOf(c) === effective) ?? null;
  return {
    showVersionRow: stamps.length > 0 || candidates.length > 0,
    finishOptions,
    languageOptions: CARD_LANGUAGES.map((l) => ({ language: l, disabledReason: reasonFor(combos, finish, l, effective) })),
    versionOptions: options(language),
    stampProductId: effective,
    combo,
    // Inglés sin liga se crea como hoy aunque no tenga precio (sigue el camino de siempre: cola de pendientes, I-1);
    // una versión no default sin precio NO se crea (IDS-UX.2: apagada, sin cola ni aviso, I-3).
    canCreate:
      (language === 'en' && effective == null) ||
      (combo != null && combo.unavailableReason == null && combo.previewPriceCents != null),
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
