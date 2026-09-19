/**
 * DECKS-META §2.3 (Fase 0) — «¿Es legal en Standard HOY?», DERIVADO en lectura.
 *
 * Diseño: `docs/specs/DECKS_META_ARCH.md §2.3` / `docs/ARCHITECTURE.md §12.1`.
 *
 * Por qué DERIVADO y no un booleano persistido: un `isLegalStandard` guardado habría que
 * recalcular y REESCRIBIR en CADA carta cuando rota el formato. En cambio, `Card` guarda los
 * HECHOS CRUDOS del proveedor (`regulationMark` + `legalStandardRaw`) y aquí se deriva la
 * legalidad contra la VENTANA VIGENTE de `ConfigSetting`. Así **la rotación anual es una edición
 * de config** (`standard.active_regulation_marks`), sin re-sync ni backfill — paralelo exacto a
 * `rarity` crudo → `rarityCanonical` (§4.28c).
 *
 * Money-safe / conservador: `regulationMark == null` ⇒ **NO legal**. Nunca se ofrece como jugable
 * algo cuya legalidad no se puede PROBAR (una carta aún no re-sincronizada cae aquí hasta que el
 * sync la puebla). Es una función PURA (sin I/O): `activeMarks`/`banlistCardIds` los lee el
 * llamador de `ConfigSetting` (una lectura cacheada por request) y los pasa aquí.
 */

/** Los hechos crudos de legalidad que `Card` persiste, más su identidad para la banlist. */
export interface StandardLegalityCard {
  regulationMark: string | null;
  legalStandardRaw: string | null;
  externalId: string;
}

/** La ventana vigente, leída de `ConfigSetting` por el llamador (§2.3). */
export interface StandardLegalityConfig {
  /** `standard.active_regulation_marks` — el conjunto de marcas vigentes (p. ej. `["G","H","I"]`). */
  activeMarks: string[];
  /** `standard.banlist_card_ids` — override de operación por `externalId` (raro; tirantes sobre lo que el proveedor no marcó). */
  banlistCardIds: string[];
}

/**
 * `true` sólo si la carta es demostrablemente legal en Standard con la ventana vigente:
 *   regulationMark ≠ null ∧ regulationMark ∈ activeMarks ∧ legalStandardRaw ≠ 'Banned'
 *   ∧ externalId ∉ banlist.
 * Cualquier duda (marca ausente, marca rotada, ban del proveedor, override de operación) ⇒ `false`.
 */
export function isLegalStandardNow(
  card: StandardLegalityCard,
  cfg: StandardLegalityConfig,
): boolean {
  // No se puede PROBAR la legalidad ⇒ NO legal (conservador, money-safe).
  if (!card.regulationMark) return false;
  // Rotó fuera de la ventana vigente (o nunca estuvo dentro).
  if (!cfg.activeMarks.includes(card.regulationMark)) return false;
  // Ban explícito del proveedor (banda de seguridad).
  if (card.legalStandardRaw === 'Banned') return false;
  // Override de operación por id (tirantes sobre lo que el proveedor no marcó).
  if (cfg.banlistCardIds.includes(card.externalId)) return false;
  return true;
}
