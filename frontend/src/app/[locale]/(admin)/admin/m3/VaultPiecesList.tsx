'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { VaultPieceDTO } from '@/types/contract';

const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';

/**
 * **«Cartas de esta compra»** (`DESIGN_SYSTEM §37.10b` · contrato `§M4-SHIP.18.6`): una fila por carta con la
 * versalita de su estado y la frase que dice qué pasó. El rojo va CON la palabra (`text-accent` solo en
 * «Devuelta · por confirmar», «En una caja» y «Revisar a mano»). `actions` pinta, por fila, «Reclamar».
 */
export function VaultPiecesList({
  pieces,
  highlightIds,
  compact,
  actions,
}: {
  pieces: VaultPieceDTO[];
  highlightIds?: string[];
  compact?: boolean;
  actions?: (piece: VaultPieceDTO) => React.ReactNode;
}) {
  const t = useTranslations('admin.m3.vaultRefund');
  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border" data-testid="vault-pieces">
      {pieces.map((p) => {
        const key = p.state === 'returned' && p.pendingConfirmation ? 'returnedPending' : p.state;
        const accent = key === 'returnedPending' || key === 'in_packed_withdrawal' || key === 'ambiguous';
        const highlighted = highlightIds?.includes(p.inventoryItemId);
        return (
          <li key={p.inventoryItemId} data-testid={`vault-piece-${p.inventoryItemId}`} data-state={p.state} className={cn('flex flex-col gap-1 py-2 text-sm text-text', highlighted && 'border-l-2 border-l-accent pl-3')}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span lang="en">{p.cardName}</span>
              <span className="tabular font-mono text-[11px] text-muted">{p.folio}</span>
              <span className={cn(TAG, accent ? 'text-accent' : 'text-muted')}>{t(`state.${key}`)}</span>
            </div>
            {!compact && key !== 'in_custody' && <p className="text-muted">{t(`stateBody.${key}`)}</p>}
            {actions && actions(p)}
          </li>
        );
      })}
    </ul>
  );
}
