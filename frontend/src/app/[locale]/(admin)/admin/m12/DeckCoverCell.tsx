'use client';

import { useTranslations } from 'next-intl';
import type { DecksMetaDeckReport } from '@/types/contract';
import { CardImage } from '@/components/ui/CardImage';

/**
 * rev `decks-portada` — celda «Portada» del ensayo M12 (§13 «Portada del deck», ARCHITECTURE §12.4.5).
 *
 * Qué pinta: miniatura de NUESTRO catálogo + `SET-NÚM` crudo de Limitless + estado del casado, para que
 * el operador sepa ANTES de publicar qué decks caerán a la regla por nombre y qué carta dar de alta.
 *
 * ⛔ Regla «nunca arte externo»: la ÚNICA fuente de imagen es `cover.imageUrl` (que el contrato define
 * como imagen de nuestro catálogo) y solo cuando el casado es `matched`. Nunca se construye una URL a
 * partir de `setCode`/`number` (eso sería el arte de Limitless). Además, defensa en profundidad: si por
 * un defecto del backend llegara una URL de Limitless o no-https, NO se pinta (queda el pozo vacío).
 */
export function DeckCoverCell({ deck }: { deck: DecksMetaDeckReport }) {
  const t = useTranslations('admin.decksMetaRefresh.cover');
  const cover = deck.cover;

  // `undefined` = backend anterior a la rev (no manda el campo): no afirmamos «sin portada».
  if (cover === undefined) return <span className="text-muted">{t('notReported')}</span>;
  if (cover === null) return <span className="text-xs text-muted">{t('none')}</span>;

  const code = `${cover.setCode}-${cover.number}`;
  const matched = cover.matchStatus === 'matched';
  const src = matched && isOurCatalogImage(cover.imageUrl) ? cover.imageUrl : null;
  // TD-a: distinguir «el catálogo no tiene imagen» (imageUrl vacío, legítimo) de «el backend mandó una
  // imagen que viola el contrato y la rechazamos». Decir lo primero cuando pasa lo segundo es falso y
  // esconde un defecto del backend al operador.
  const rejected = matched && !src && !!cover.imageUrl;
  const alt = t('alt', { deck: deck.name ?? deck.archetypeId, code });

  // Motivo del no-casado. Si el backend manda un `matchStatus` que este frontend no conoce (contrato
  // ampliado sin desplegar el frontend), NO se pinta la ruta i18n cruda: respaldo genérico con el valor.
  const reasonKey = `reason.${cover.matchStatus}`;
  const reason = t.has(reasonKey) ? t(reasonKey) : t('reasonUnknown', { status: String(cover.matchStatus) });

  return (
    <span className="inline-flex items-center gap-3">
      <CardImage src={src} alt={alt} className="w-10 shrink-0 p-0" />
      {/* a11y: sin `<img>` no hay `alt`; el nombre del deck y la portada se exponen igual a lectores. */}
      {!src && <span className="sr-only">{alt}</span>}
      <span className="flex flex-col items-start">
        <span lang="en" className="tabular text-sm font-medium text-text">{code}</span>
        {matched ? (
          <span className="text-xs text-success">
            {t('matched')}
            {rejected ? (
              <span className="text-danger"> · {t('rejectedImage')}</span>
            ) : (
              !src && <span className="text-muted"> · {t('noImage')}</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-accent">
            {t('unmatched')} · {reason}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * ⚠️ Candado de NO-REGRESIÓN, no la garantía. La garantía de «nunca arte externo» vive en el backend
 * (solo emite `imageUrl` de nuestro catálogo, API_CONTRACT §13); esto solo evita que un defecto suyo
 * llegue a pintarse, y cuando muerde la celda lo DICE («imagen rechazada»), no lo calla.
 *
 * `true` solo para una URL https que NO sea de Limitless. Es una lista de PROHIBIDOS a propósito, no una allowlist de hosts del catálogo
 * (los hosts de arte de carta no están cerrados en el frontend — NO MEDIDO que sean solo los de
 * `remotePatterns`), así que se niega lo que sabemos prohibido: cualquier host `*limitless*`
 * (`limitlesstcg.com`, `limitlesstcg.nyc3.cdn.digitaloceanspaces.com`, `limitless3.…`).
 */
export function isOurCatalogImage(url: string | null | undefined): url is string {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return !parsed.hostname.toLowerCase().includes('limitless');
}
