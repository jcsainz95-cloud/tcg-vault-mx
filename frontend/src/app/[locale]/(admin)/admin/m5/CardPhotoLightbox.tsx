'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CardDTO } from '@/types/contract';
import { Modal } from '@/components/ui/Modal';

/**
 * Foto de carta con visor (lightbox, Esc cierra). Es EL visor de la Mesa, extraído para que la revisión física
 * (§BUYLIST-FLUJO F1b) y la mesa de solo lectura (F1c) lo reutilicen sin copiarlo. Mismos `data-testid` que tenía la Mesa.
 */
export function CardPhotoLightbox({
  card,
  width = 72,
  height = 100,
}: {
  card: Pick<CardDTO, 'name' | 'setName' | 'number' | 'imageSmallUrl' | 'imageLargeUrl'>;
  width?: number;
  height?: number;
}) {
  const t = useTranslations('admin.m5.desk.mesa.photo');
  const [open, setOpen] = useState(false);
  const src = card.imageSmallUrl || card.imageLargeUrl;
  const box = { width, height };
  if (!src) {
    return (
      <div
        data-testid="line-photo-none"
        style={box}
        className="flex shrink-0 items-center justify-center border border-border-strong bg-surface-2 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-muted"
      >
        {t('none')}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('open', { name: card.name })}
        data-testid="line-photo"
        style={box}
        className="shrink-0 cursor-zoom-in border border-border-strong bg-surface-2 focus-visible:shadow-focus focus-visible:outline-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura remota del catálogo, sin optimizador */}
        <img src={src} alt="" loading="lazy" width={width} height={height} className="h-full w-full object-contain" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={card.name}>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagen remota del catálogo */}
        <img
          data-testid="photo-viewer-img"
          src={card.imageLargeUrl || card.imageSmallUrl}
          alt={t('alt', { name: card.name, set: card.setName, number: card.number })}
          className="mx-auto max-h-[70vh] w-auto max-w-full object-contain"
        />
      </Modal>
    </>
  );
}
