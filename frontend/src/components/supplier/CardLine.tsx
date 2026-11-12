'use client';

import { useTranslations } from 'next-intl';
import { CardImage } from '@/components/ui/CardImage';
import type { SupplyCard } from '@/lib/api/suppliers';

/** Carta + set + número + acabado (carta embebida del contrato §0). Compartida por portal y panel. */
export function CardLine({ card, children }: { card: SupplyCard; children?: React.ReactNode }) {
  const tf = useTranslations('finish');
  const name = card.nameEs ?? card.name;
  return (
    <div className="flex items-start gap-3">
      <div className="w-14 shrink-0">
        <CardImage src={card.imageUrl} alt={name} className="aspect-[5/7] w-full" />
      </div>
      <div className="min-w-0">
        <p className="font-serif text-lg leading-tight text-text">{name}</p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-eyebrow text-muted">
          {card.setName} · {card.number} · {tf(card.finish)}
        </p>
        {children}
      </div>
    </div>
  );
}
