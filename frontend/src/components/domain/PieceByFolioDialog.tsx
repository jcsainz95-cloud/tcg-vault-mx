'use client';

import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { useFinishLabel } from '@/lib/finish-label';
import type { PieceByFolioDTO } from '@/lib/api/inventory-folio';

/**
 * «Detalle de pieza» de SOLO LECTURA por folio (`GET /admin/inventory/by-folio/:folio`): carta, foto, set y clave, número,
 * acabado (etiqueta traducida), idioma, condición, estado, «de la tienda / de un cliente» y ubicación. Sin precios ni acciones.
 */
export function PieceByFolioDialog({ piece, onClose }: { piece: PieceByFolioDTO | null; onClose: () => void }) {
  const t = useTranslations('admin.inventory.pieceDetail');
  const ts = useTranslations('status.inventory');
  const tv = useTranslations('version');
  const finishLabel = useFinishLabel();
  if (!piece) return null;
  const c = piece.card;
  const condition = piece.rawCondition ?? ([piece.gradingCompany, piece.gradeValue].filter(Boolean).join(' ') || null);
  const rows: [string, string | null][] = [
    [t('set'), c.setName ? (c.setKey ? `${c.setName} (${c.setKey})` : c.setName) : null],
    [t('number'), c.number ? `#${c.number}` : null],
    [t('finish'), piece.finish ? finishLabel(piece.finish) : null],
    [t('language'), piece.language && tv.has(`language.${piece.language}`) ? tv(`language.${piece.language}`) : null],
    [t('condition'), condition],
    [t('status'), ts.has(piece.status) ? ts(piece.status) : null],
    [t('owner'), piece.owner.type === 'customer' ? t('ownerCustomer') : t('ownerStore')],
    [t('location'), piece.location ? piece.location.label : t('noLocation')],
  ];
  return (
    <Modal open onClose={onClose} title={t('title')} footer={<Button variant="secondary" onClick={onClose}>{t('close')}</Button>}>
      <div className="flex items-start gap-4" data-testid="piece-by-folio">
        <CardImage src={c.imageSmallUrl ?? c.imageUrl} alt="" className="w-20 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <span lang="en" className="font-medium text-text">{c.name}</span>
          <span className="font-mono text-xs text-muted">{piece.folio}</span>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Modal>
  );
}
