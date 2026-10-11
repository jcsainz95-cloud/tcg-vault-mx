'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { AccessoryCardDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';

/**
 * Teja de accesorio (`DESIGN_SYSTEM §AC-UX.2`). Toda la teja enlaza a la ficha EXCEPTO el botón (dos objetivos
 * separados: el botón no vive dentro del `<a>`). Agotado: «AGOTADO» y ⛔ ningún botón (AC-UX-2). Con sesión
 * (`canAdd=false`): sin botón (AC-UX-4). El precio es el del servidor (`priceCents`, IVA dentro).
 */
export function AccessoryTile({
  item,
  canAdd,
  onAdd,
}: {
  item: AccessoryCardDTO;
  canAdd: boolean;
  onAdd: (id: string) => void;
}) {
  const t = useTranslations('accessories');
  const locale = useLocale() as AppLocale;
  const href = `/accesorios/${item.id}`;
  const category = t(`category.${item.category}`);

  return (
    <article data-testid={`accessory-tile-${item.id}`} className="flex flex-col gap-3">
      <Link href={href} className="group flex flex-col gap-3 focus-visible:shadow-focus" title={item.name}>
        {/* El nombre ya está como texto dentro del enlace: la imagen va con alt="" (§AC-UX.14). */}
        <AccessoryPhoto src={item.photo.thumbUrl} alt="" fallbackText={item.name} dim={item.soldOut} />
        <span className="eyebrow">{category}</span>
        <span className="line-clamp-2 text-[15px] leading-snug text-text group-hover:text-accent">{item.name}</span>
        <span className="tabular text-[17px] font-medium text-text">{formatMoneyCents(item.priceCents, locale)}</span>
      </Link>
      {item.soldOut ? (
        <span className="font-mono text-[11px] uppercase tracking-label text-muted">{t('soldOut')}</span>
      ) : (
        canAdd && (
          <Button
            variant="secondary"
            size="sm"
            className="min-h-[44px] self-start"
            aria-label={t('addAria', { name: item.name })}
            onClick={() => onAdd(item.id)}
          >
            {t('add')}
          </Button>
        )
      )}
    </article>
  );
}
