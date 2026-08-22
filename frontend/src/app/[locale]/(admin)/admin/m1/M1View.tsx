'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Search, Plus, Megaphone, MapPin, FileSpreadsheet } from 'lucide-react';
import { getAdminInventory, getLocations, exportAdminInventoryXlsx } from '@/lib/api';
import type {
  Finish,
  GradedInventoryGroupDTO,
  InventoryItemDTO,
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
  MasterSetVariantDTO,
  ProductType,
  SealedCondition,
  SealedInventoryGroupDTO,
  SealedSubtype,
  VariantPricingDTO,
} from '@/types/contract';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Toaster, useToasts } from '@/components/ui/Toast';
import { useRole } from '@/lib/role';
// v1.20 (§4.20f): el binder Master Set es COMPARTIDO; M1 lo monta en modo `platform` y
// v1.28 (P-17) le pasa `onOpenVariant` para abrir el drill-down POR VARIANTE.
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';
import { AddItemModal } from './AddItemModal';
import { LocationsModal } from './LocationsModal';
import { InventoryValueCards } from './InventoryValueCards';
import { PublishAllDialog } from './PublishAllDialog';
import { VariantDrawer } from './VariantDrawer';
import { SealedTab } from './SealedTab';
import { GradedTab } from './GradedTab';
import { AddGradedModal } from './AddGradedModal';

/**
 * M1 reorganizado — P-17 (DESIGN_SYSTEM §16.1): pestañas Master Set (default) · Sellado ·
 * Gradeadas. La pestaña «Piezas» desaparece: sus capacidades (folio, estado, precio manual,
 * detalle, publicar, merma) viven ÍNTEGRAS en el drill-down por variante (VariantDrawer).
 * Buscador por folio PERSISTENTE (abre el drill-down de la variante dueña de la pieza).
 * Tarjetas de valor P-24 solo super_admin (omitidas por completo para vault_operator).
 */

type M1Tab = 'masterSet' | 'sealed' | 'graded';
const TABS: M1Tab[] = ['masterSet', 'sealed', 'graded'];

function initialTab(): M1Tab {
  if (typeof window === 'undefined') return 'masterSet';
  const q = new URLSearchParams(window.location.search).get('tab');
  return q === 'sealed' || q === 'graded' ? q : 'masterSet';
}

/** Nombre de archivo de la exportación (P-31): `inventario-tcghunt-YYYYMMDD.xlsx`. */
function exportFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `inventario-tcghunt-${y}${m}${d}.xlsx`;
}

/** Dispara la descarga de un Blob en el navegador (blob → objectURL → <a download> → revoke). */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Estado del drill-down abierto (desde teja, folio, grupo sellado o grupo gradeado). */
interface DrawerState {
  cardId: string;
  cardName: string;
  cardNumber: string;
  imageSmallUrl?: string;
  finish: Finish;
  productType: ProductType;
  pricing?: VariantPricingDTO;
  marketRefCents?: number | null;
  marketCapturedDate?: string | null;
  sealedSubtype?: SealedSubtype | null;
  sealedCondition?: SealedCondition;
  gradeInfo?: { gradingCompany: string; gradeValue: string };
  highlightFolio?: string;
}

export function M1View() {
  const t = useTranslations('admin.m1');
  const tInv = useTranslations('admin.inventory');
  const queryClient = useQueryClient();
  const { isSuperAdmin } = useRole();
  const { toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const [tab, setTabState] = useState<M1Tab>(initialTab);
  function setTab(next: M1Tab) {
    setTabState(next);
    // La pestaña activa se refleja en la URL (?tab=) para volver del drill-down sin perder
    // contexto (§16.1.3). Sin next/navigation: replaceState no re-monta la vista.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (next === 'masterSet') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url.toString());
    }
  }

  const [addOpen, setAddOpen] = useState(false);
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [addGraded, setAddGraded] = useState<{ open: boolean; card?: { id: string; name: string } | null }>({
    open: false,
  });
  const [currentSet, setCurrentSet] = useState<MasterSetSummaryDTO | null>(null);

  // Buscador por folio persistente (§16.1.1): al enviar abre el drill-down de la variante
  // dueña de esa pieza, con la fila resaltada. Folio inexistente = mensaje inline (no toast).
  const [folioInput, setFolioInput] = useState('');
  const [folioNotFound, setFolioNotFound] = useState(false);
  const folioSearch = useMutation({
    mutationFn: (folio: string) => getAdminInventory({ q: folio, pageSize: 5 }),
    onSuccess: (res, folio) => {
      const item = res.data.find((i) => i.folio.toLowerCase() === folio.toLowerCase()) ?? res.data[0];
      if (!item) {
        setFolioNotFound(true);
        return;
      }
      setFolioNotFound(false);
      setDrawer(drawerFromItem(item));
    },
  });
  // P-31 «Exportar a Excel»: descarga el .xlsx con el filtro/set actual (set del binder + tipo por
  // pestaña) y dispara la descarga (blob → archivo). Estado de carga/error legible en el botón.
  const exportXlsx = useMutation({
    mutationFn: () =>
      exportAdminInventoryXlsx({
        setId: tab === 'masterSet' ? currentSet?.setId : undefined,
        productType: tab === 'sealed' ? 'sealed' : tab === 'graded' ? 'graded' : undefined,
      }),
    onSuccess: ({ blob, filename }) => {
      // Usa el nombre que sugiera el backend (Content-Disposition); si no vino, el nuestro.
      triggerBlobDownload(blob, filename ?? exportFilename());
      pushToast({ variant: 'success', title: t('title'), message: tInv('exportXlsx.success') });
    },
    onError: () => {
      pushToast({ variant: 'danger', title: t('title'), message: tInv('exportXlsx.error') });
    },
  });

  function submitFolio() {
    const folio = folioInput.trim();
    if (!folio) return;
    setFolioNotFound(false);
    folioSearch.mutate(folio);
  }

  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations });

  function invalidateAggregates() {
    void queryClient.invalidateQueries({ queryKey: ['master-sets'] });
    void queryClient.invalidateQueries({ queryKey: ['master-set-binder'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-value'] });
    void queryClient.invalidateQueries({ queryKey: ['sealed-sets'] });
    void queryClient.invalidateQueries({ queryKey: ['sealed-set-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['graded-inventory'] });
  }

  function drawerFromItem(item: InventoryItemDTO): DrawerState {
    return {
      cardId: item.card.id,
      cardName: item.card.name,
      cardNumber: item.card.number,
      imageSmallUrl: item.card.imageSmallUrl,
      finish: (item.finish ?? 'normal') as Finish,
      productType: item.productType,
      marketRefCents: item.referenceValue?.referenceMxnCents ?? null,
      ...(item.productType === 'sealed'
        ? { sealedSubtype: item.sealedSubtype ?? null, sealedCondition: item.sealedCondition ?? 'mint' }
        : {}),
      ...(item.productType === 'graded' && item.gradingCompany
        ? { gradeInfo: { gradingCompany: item.gradingCompany, gradeValue: item.gradeValue ?? '' } }
        : {}),
      highlightFolio: item.folio,
    };
  }

  function openVariant(cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) {
    setDrawer({
      cardId: cell.cardId,
      cardName: cell.name,
      cardNumber: cell.number,
      imageSmallUrl: cell.imageSmallUrl,
      finish: variant.finish,
      productType: 'raw',
      pricing: variant.pricing,
      marketRefCents:
        variant.marketReferenceMxnCents !== undefined
          ? variant.marketReferenceMxnCents
          : cell.marketReferenceMxnCents ?? null,
      marketCapturedDate: variant.capturedDate ?? null,
    });
  }

  function openSealedGroup(_setId: string, group: SealedInventoryGroupDTO) {
    setDrawer({
      cardId: group.cardId,
      cardName: group.productName,
      cardNumber: '',
      finish: 'normal',
      productType: 'sealed',
      sealedSubtype: group.sealedSubtype,
      sealedCondition: group.sealedCondition,
      marketRefCents: group.sealedMarketRef?.referenceMxnCents ?? null,
    });
  }

  function openGradedGroup(group: GradedInventoryGroupDTO) {
    setDrawer({
      cardId: group.cardId,
      cardName: group.card.name,
      cardNumber: group.card.number,
      imageSmallUrl: group.card.imageSmallUrl,
      finish: 'normal',
      productType: 'graded',
      gradeInfo: { gradingCompany: group.gradingCompany, gradeValue: group.gradeValue },
      marketRefCents: group.marketReferenceMxnCents,
      marketCapturedDate: group.capturedDate ?? null,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Viewport de toasts (portal a <body>, z-[60]) — visible por encima de modales. */}
      <Toaster toasts={toasts} onDismiss={dismissToast} />

      {/* Header: título + buscador por folio SIEMPRE visible en las tres pestañas. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <div className="flex w-full flex-col md:w-auto">
          <div className="flex items-end gap-2">
            <Input
              label={tInv('folioSearch.label')}
              className="w-full font-mono md:w-[260px]"
              placeholder={tInv('folioSearch.placeholder')}
              value={folioInput}
              onChange={(e) => {
                setFolioInput(e.target.value);
                setFolioNotFound(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitFolio();
                }
              }}
            />
            <Button
              variant="secondary"
              onClick={submitFolio}
              loading={folioSearch.isPending}
              aria-label={tInv('folioSearch.cta')}
            >
              <Search size={18} />
            </Button>
          </div>
          {folioNotFound && (
            <p className="mt-1 text-xs text-accent" role="status">
              {tInv('folioSearch.notFound')}
            </p>
          )}
        </div>
      </div>

      {/* Tarjetas de valor (P-24): SOLO super_admin — para vault_operator la fila se OMITE
          por completo (sin candados; el endpoint tampoco le sirve el dato). */}
      {isSuperAdmin && <InventoryValueCards />}

      {/* Toolbar: pestañas a la izquierda; acciones a la derecha. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div className="flex gap-4" role="tablist" aria-label={t('title')}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-1 pb-2 text-sm transition-colors ${
                tab === key ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {tInv(`tabs.${key}`)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pb-2">
          <Button variant="secondary" size="sm" onClick={() => setLocationsOpen(true)}>
            <MapPin size={16} /> {t('locations.button')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPublishAllOpen(true)}>
            <Megaphone size={16} /> {tInv('publishAllCta')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportXlsx.mutate()}
            loading={exportXlsx.isPending}
            disabled={exportXlsx.isPending}
          >
            <FileSpreadsheet size={16} />{' '}
            {exportXlsx.isPending ? tInv('exportXlsx.loading') : tInv('exportXlsx.cta')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={16} /> {tInv('batchAddCta')}
          </Button>
        </div>
      </div>

      {tab === 'masterSet' && (
        <MasterSetPanel onOpenVariant={openVariant} onSetOpened={setCurrentSet} />
      )}
      {tab === 'sealed' && (
        <SealedTab
          onOpenGroup={openSealedGroup}
          onToast={(msg) => pushToast({ variant: 'success', title: tInv('tabs.sealed'), message: msg })}
          onOpenBatchAdd={() => setAddOpen(true)}
        />
      )}
      {tab === 'graded' && (
        <GradedTab
          onOpenGroup={openGradedGroup}
          onAddGraded={() => setAddGraded({ open: true, card: null })}
          onToast={(msg) => pushToast({ variant: 'success', title: tInv('tabs.graded'), message: msg })}
        />
      )}

      {/* Drill-down por variante (P-17): folio, estado, precio por pieza, publicar, merma. */}
      {drawer && (
        <VariantDrawer
          {...drawer}
          locations={locations.data ?? []}
          onClose={() => setDrawer(null)}
          onChanged={invalidateAggregates}
          onToast={(msg) => pushToast({ variant: 'success', title: t('title'), message: msg })}
          onAddGraded={() =>
            setAddGraded({ open: true, card: { id: drawer.cardId, name: drawer.cardName } })
          }
        />
      )}

      {/* «Publicar todo…» (P-19) con alcance y resultado honesto. */}
      <PublishAllDialog
        open={publishAllOpen}
        onClose={() => setPublishAllOpen(false)}
        currentSet={currentSet ? { id: currentSet.setId, name: currentSet.name } : null}
        onDone={invalidateAggregates}
      />

      {/* «Alta por lote» — modal de alta masiva existente (P-5), sin cambios. */}
      {addOpen && <AddItemModal onClose={() => setAddOpen(false)} onToast={pushToast} />}

      {/* «Agregar gradeada» (P-20). */}
      {addGraded.open && (
        <AddGradedModal
          open
          card={addGraded.card}
          onClose={() => setAddGraded({ open: false })}
          onCreated={invalidateAggregates}
        />
      )}

      {/* Gestor mínimo de ubicaciones de bóveda (crear/listar). */}
      <LocationsModal
        open={locationsOpen}
        onClose={() => setLocationsOpen(false)}
        locations={locations.data ?? []}
      />
    </div>
  );
}
