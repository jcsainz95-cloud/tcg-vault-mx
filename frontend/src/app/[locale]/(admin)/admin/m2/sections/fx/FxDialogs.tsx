'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatRate, formatSignedPctWithUnit } from './fx-format';

/**
 * Los DOS diálogos de la tarjeta de FX (`DESIGN_SYSTEM §30.8` y §30.9a).
 *
 * Los dos son `Modal` de confirmación de dinero (§7.6): centrados en escritorio, **bottom sheet**
 * en móvil, radio 0, foco atrapado y `Esc` cierra **sin ejecutar**. ⛔ No son `confirm()` del
 * navegador, ⛔ no son un toast y ⛔ no son una casilla dentro de la tarjeta.
 *
 * ⚠️ **Ninguno de los dos ofrece «Deshacer»** (§30.0, §30.9b): volver al modo anterior es **un
 * segundo repreciado**, no una anulación — lo que se cotizó o se vendió en medio **ya está
 * sellado**. Se ofrece **volver**, con su propia confirmación, y nunca con esa palabra.
 */

export interface FxConfirmDialogProps {
  open: boolean;
  /** La tasa que rige AHORA y el rótulo de su fuente, tal y como se pintan en la tarjeta. */
  before: number;
  sourceBefore: string;
  /** La tasa que regiría tras el acto, y el rótulo de SU fuente. */
  after: number;
  sourceAfter: string;
  /** El salto en % —ya derivado por la tarjeta— con el que cambia todo lo que sale de un USD. */
  pct: number;
  /** Sólo con `automatic.status: "stale"`: la línea extra de §30.9a. ⛔ Aun así el CTA es el normal. */
  stale?: { date: string; ageDays: number } | null;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * **§30.9a — el diálogo normal**, el de las dos tasas en la mano. Se abre **en las dos
 * direcciones** (§30.0: aquí no hay mitad barata del interruptor — la misma tasa mueve a la vez lo
 * que cobramos y lo que pagamos, en sentidos opuestos para el negocio).
 */
export function FxConfirmDialog({
  open,
  before,
  sourceBefore,
  after,
  sourceAfter,
  pct,
  stale,
  loading,
  onCancel,
  onConfirm,
}: FxConfirmDialogProps) {
  const t = useTranslations('admin.m2.fx');
  const tc = useTranslations('common');
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('confirm.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" loading={loading} onClick={onConfirm}>
            {t('confirm.cta', { rate: formatRate(after) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 leading-relaxed">
        <p>
          {t('confirm.rates', {
            before: formatRate(before),
            sourceBefore,
            after: formatRate(after),
            sourceAfter,
          })}
        </p>
        <p>{t('confirm.effect', { pct: formatSignedPctWithUnit(pct) })}</p>
        {/* Con `stale` hay número real que el humano puede ver y juzgar: se DICE, y el CTA sigue
            siendo el normal. ⛔ El acuse de §30.8 NO se pide aquí. */}
        {stale && <p>{t('confirm.staleNote', { date: stale.date, n: stale.ageDays })}</p>}
        <p>{t('confirm.when')}</p>
        <p className="text-muted">{t('confirm.untouched')}</p>
      </div>
    </Modal>
  );
}

export interface FxAckDialogProps {
  open: boolean;
  /** La que rige ahora (la manual del dueño, en el caso que este diálogo existe para cubrir). */
  currentRate: number;
  /** ⭐ **El valor de respaldo, tal y como lo nombró el SERVIDOR** (`details.fallbackRate`). */
  fallbackRate: number;
  /** El salto contra ese valor de respaldo. Aquí SÍ se dice, porque va nombrado como lo que es. */
  pct: number;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * **§30.8 — el acuse cuando NO hay ninguna tasa de Banxico.** El diálogo que más importa de la
 * sección: pasar a automática sin fila de Banxico lleva de la tasa del dueño al **valor de
 * respaldo**, ≈5 % instantáneo sobre todo el catálogo **en los dos sentidos**, y ese número **ni
 * siquiera es una tasa real**.
 *
 * Cinco párrafos, uno por pregunta, en el orden en que un humano se las hace. ⛔ Aquí no aparece
 * ningún código de error, ni la palabra «error», ni el `422`.
 *
 * ⛔ **Y sólo aquí. NUNCA con `stale`** (ahí el diálogo es el normal, §30.9a).
 *
 * Las acciones, en este orden y con estos pesos: **la salida de verdad va primero** — refrescar es
 * la única acción del diálogo que puede dejar al sistema mejor, y si trae tasa el diálogo **se
 * cierra solo** y el humano vuelve a decidir con dos números reales delante.
 */
export function FxAckDialog({
  open,
  currentRate,
  fallbackRate,
  pct,
  loading,
  refreshing,
  onRefresh,
  onCancel,
  onConfirm,
}: FxAckDialogProps) {
  const t = useTranslations('admin.m2.fx');
  const tc = useTranslations('common');
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t('ack.title')}
      footer={
        <>
          <Button variant="secondary" loading={refreshing} onClick={onRefresh}>
            {t('refresh.cta')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button variant="primary" loading={loading} onClick={onConfirm}>
            {t('ack.cta', { fallback: formatRate(fallbackRate) })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 leading-relaxed">
        <p>{t('ack.current', { current: formatRate(currentRate) })}</p>
        <p>{t('ack.would', { fallback: formatRate(fallbackRate) })}</p>
        {/* ⛔ El párrafo más largo del sistema en esta pantalla, y NO se recorta ni se mete en un
            «ver más»: es el párrafo por el que existe el diálogo (§30.15c). */}
        <p>{t('ack.whereFrom')}</p>
        <p>{t('ack.prices', { pct: formatSignedPctWithUnit(pct) })}</p>
        <p className="text-muted">{t('confirm.untouched')}</p>
      </div>
    </Modal>
  );
}
