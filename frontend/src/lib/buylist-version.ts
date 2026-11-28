import type { BuylistStampDTO, CardLanguage, SellItemDTO } from '@/types/contract';

/**
 * §BUYLIST-ES F3/F4 (§4) · la «versión» de una línea = idioma × (normal | una liga). Solo se COMPARA y se nombra; ⛔ no hay
 * dinero aquí. `stamp` ausente/`null` = normal.
 */
export interface LineVersion {
  language: CardLanguage;
  stamp: BuylistStampDTO | null;
}

export function declaredVersion(l: Pick<SellItemDTO, 'language' | 'stamp'>): LineVersion {
  return { language: l.language === 'es' ? 'es' : 'en', stamp: l.stamp ?? null };
}

/** Lo recibido; un campo ausente (servidor anterior) se lee como «igual a lo declarado», nunca como una diferencia inventada. */
export function receivedVersion(l: Pick<SellItemDTO, 'language' | 'stamp' | 'receivedLanguage' | 'receivedStamp'>): LineVersion {
  const d = declaredVersion(l);
  return {
    language: l.receivedLanguage ? (l.receivedLanguage === 'es' ? 'es' : 'en') : d.language,
    stamp: l.receivedStamp === undefined ? d.stamp : l.receivedStamp,
  };
}

export function sameVersion(a: LineVersion, b: LineVersion): boolean {
  return a.language === b.language && (a.stamp?.productId ?? null) === (b.stamp?.productId ?? null);
}

/** `true` ⇔ la recepción ya fijó la versión Y difiere de la declarada. */
export function hasVersionMismatch(l: SellItemDTO): boolean {
  return l.receivedVersionSet === true && !sameVersion(declaredVersion(l), receivedVersion(l));
}

/**
 * Nombre legible de una versión con las claves `sellerFlujo.version.name.*`. La dimensión «Normal | liga» solo se nombra si
 * alguno de los dos lados que se comparan es de liga (`withStamp`): «Español» vs «Inglés», pero «Inglés · De liga» vs «Inglés · Normal».
 */
export function versionName(
  v: LineVersion,
  t: (key: 'en' | 'es' | 'normal' | 'league') => string,
  withStamp: boolean,
): string {
  const lang = t(v.language);
  if (!withStamp) return lang;
  return `${lang} · ${v.stamp ? v.stamp.label || t('league') : t('normal')}`;
}
