/**
 * §IDS (API_CONTRACT v1.116⟨ids⟩ §IDS.5) — valores por defecto de los campos de versión que ahora viajan SIEMPRE en
 * `ListingDTO`, `GroupedListingDTO`, `GroupedListingSummaryDTO` y `OrderItemPreview`. Para fixtures de pruebas que no
 * tratan de versiones: una pieza «de siempre» es inglés sin liga (I-1).
 */
import type { VersionDTO } from '@/types/contract';

export const EN_VERSION: VersionDTO = { key: 'en', language: 'en', stamp: null };

/** Pieza/grupo/línea inglés sin liga. `finishLabel` = el de un acabado `normal` (no holo). */
export const IDS_EN = { version: EN_VERSION, finishLabel: 'non_holo' as const };

/** Teja de la rejilla: además el `optionKey` de su entrada en la ficha (sin liga = `version.key`). */
export const IDS_EN_SUMMARY = { ...IDS_EN, versionOptionKey: 'en' };

/** El `finishLabel` que el servidor daría a una pieza SIN liga (`finishLabelOf(finish, null)`), para fixtures coherentes. */
export const FINISH_LABEL_OF = {
  normal: 'non_holo',
  holofoil: 'holo',
  reverse_holo: 'reverse_holo',
  first_edition_holofoil: 'first_edition_holo',
} as const;
