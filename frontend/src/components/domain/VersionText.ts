'use client';

import { useTranslations } from 'next-intl';
import type { FinishLabel, VersionDTO } from '@/types/contract';
import { isDefaultVersion } from '@/lib/version';

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
    /** Línea larga `<idioma> · <tipo largo>` (deck, IDS-UX.5); español sin liga = «Español». Carrito y pedido: `detail`. */
    line(version: Pick<VersionDTO, 'language' | 'stamp'> | null | undefined): string | null {
      if (!version || isDefaultVersion(version)) return null;
      const lang = t(`language.${version.language}`);
      return version.stamp ? `${lang} · ${td(`long.${version.stamp.type}`)}` : lang;
    },
    /**
     * Petición 8 (IDS-UX.4 «Carrito», IDS-UX.7 punto 8): la línea muted que va BAJO LAS INSIGNIAS en carrito/checkout,
     * «Mi pedido» y el seguimiento. Dice solo lo que las insignias no dicen: nunca el idioma (ya es insignia, o no se
     * pinta si es inglés) y solo el tipo largo cuando difiere del nombre de la insignia. ES sin liga ⇒ `null`;
     * «De liga» ⇒ «De liga (Prize Pack)»; EN «Prize Pack» ⇒ `null`; EN «League» ⇒ «League (League promo)».
     */
    detail(version: Pick<VersionDTO, 'language' | 'stamp'> | null | undefined): string | null {
      if (!version?.stamp) return null;
      const long = td(`long.${version.stamp.type}`);
      return long === t(`chip.${version.stamp.type}`) ? null : long;
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
