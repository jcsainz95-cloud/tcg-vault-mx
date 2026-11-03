'use client';

import { useTranslations } from 'next-intl';
import type { FinishLabel, VersionDTO } from '@/types/contract';

/*
 * Vive aparte de `VersionChip.tsx` a propósito: la teja (portada) importa la insignia, y lo que esa insignia importa
 * decide qué namespaces viajan a la portada (DYN-F10, trinquete de bytes). Las líneas largas son de carrito, pedido y
 * deck, no de la portada.
 */
/**
 * Textos de versión para líneas de carrito, pedido y deck (IDS-UX.4): «Español · De liga (Prize Pack)»; EN
 * «Spanish · Prize Pack». Inglés sin liga ⇒ `null` (no hay línea).
 */
export function useVersionText() {
  const t = useTranslations('version');
  const td = useTranslations('versionDetail');
  return {
    /** Línea larga muted de carrito/pedido: `<idioma> · <tipo largo>`; español sin liga = «Español». */
    line(version: Pick<VersionDTO, 'language' | 'stamp'> | null | undefined): string | null {
      if (!version || (version.language === 'en' && !version.stamp)) return null;
      const lang = t(`language.${version.language}`);
      return version.stamp ? `${lang} · ${td(`long.${version.stamp.type}`)}` : lang;
    },
    /** Corta (deck, tramos): `<idioma>[ · <insignia>]`. */
    short(version: Pick<VersionDTO, 'language' | 'stamp'>): string {
      const lang = t(`language.${version.language}`);
      return version.stamp ? `${lang} · ${t(`chip.${version.stamp.type}`)}` : lang;
    },
    finish(label: FinishLabel): string {
      return t(`finishLabel.${label}`);
    },
  };
}
