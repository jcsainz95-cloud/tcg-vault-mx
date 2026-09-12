'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Maximize, Minus, Plus, RotateCcw, RotateCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import type { IdDocumentState } from './IdDocumentViewer';

/** Niveles DISCRETOS (§34.4): el revisor necesita saber cuánto amplía cuando «algo se ve raro». */
const ZOOM_LEVELS = [100, 150, 200, 300] as const;

export interface IdDocumentLightboxProps {
  open: boolean;
  side: 'front' | 'back';
  onSideChange: (side: 'front' | 'back') => void;
  urls: { front?: string; back?: string };
  states: { front: IdDocumentState; back: IdDocumentState };
  holderName: string;
  rotation: { front: number; back: number };
  onRotate: (side: 'front' | 'back', deltaDegrees: number) => void;
  onRequestLink: () => void;
  requesting?: boolean;
  onImageError: (side: 'front' | 'back') => void;
  onImageLoad: (side: 'front' | 'back') => void;
  onClose: () => void;
}

/**
 * El visor donde se lee de verdad (DESIGN_SYSTEM §34.4). Diálogo **a pantalla completa** —no el
 * `Modal` de §7.6, que está acotado a `max-w-md` (448 px) y no deja leer una INE—, fondo tinta,
 * `object-contain`.
 *
 * ⭐ **Lo que este componente protege, y es el requisito difícil (§34.3c.2):** «Volver a pedir el
 * enlace» vive **aquí dentro**, el visor **no se cierra** al pedirlo y, cuando llega el par nuevo,
 * **se conservan zoom, encuadre, rotación y cara**. Eso se sostiene por construcción: el botón solo
 * cambia `urls` en el padre, y este componente **no se desmonta ni se re-llavea** — su estado
 * (zoom/encuadre) y el del padre (rotación/cara) sobreviven al cambio de `src`.
 *
 * ⛔ Sin «Descargar», sin «Abrir en pestaña nueva», sin «Imprimir» (§34.14.2).
 */
export function IdDocumentLightbox({
  open,
  side,
  onSideChange,
  urls,
  states,
  holderName,
  rotation,
  onRotate,
  onRequestLink,
  requesting,
  onImageError,
  onImageLoad,
  onClose,
}: IdDocumentLightboxProps) {
  const t = useTranslations('admin.m6.kycReview');
  const tc = useTranslations('common');
  const dialogRef = useRef<HTMLDivElement>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const zoom = ZOOM_LEVELS[zoomIndex];
  const url = side === 'front' ? urls.front : urls.back;
  const state = side === 'front' ? states.front : states.back;
  const alt = side === 'front' ? t('altFront', { name: holderName }) : t('altBack', { name: holderName });

  const fit = useCallback(() => {
    setZoomIndex(0);
    setOffset({ x: 0, y: 0 });
  }, []);
  const zoomIn = useCallback(() => setZoomIndex((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1)), []);
  const zoomOut = useCallback(
    () =>
      setZoomIndex((i) => {
        const next = Math.max(i - 1, 0);
        if (next === 0) setOffset({ x: 0, y: 0 });
        return next;
      }),
    [],
  );

  // Teclado (§34.4). ⚠️ Las flechas hacen DOS cosas y el reparto es determinista: con zoom > 100 %
  // mueven el ENCUADRE (que es lo único que se puede hacer ahí), y a 100 % cambian de CARA.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case '+':
        case '=':
          zoomIn();
          break;
        case '-':
          zoomOut();
          break;
        case '0':
          fit();
          break;
        case 'r':
          onRotate(side, 90);
          break;
        case 'R':
          onRotate(side, -90);
          break;
        case 'ArrowLeft':
          if (zoom > 100) setOffset((o) => ({ ...o, x: o.x + 40 }));
          else onSideChange('front');
          break;
        case 'ArrowRight':
          if (zoom > 100) setOffset((o) => ({ ...o, x: o.x - 40 }));
          else onSideChange('back');
          break;
        case 'ArrowUp':
          if (zoom > 100) setOffset((o) => ({ ...o, y: o.y + 40 }));
          break;
        case 'ArrowDown':
          if (zoom > 100) setOffset((o) => ({ ...o, y: o.y - 40 }));
          break;
        default:
          return;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, zoomIn, zoomOut, fit, onRotate, onSideChange, side, zoom]);

  // Trampa de foco (§7.6): el Tab no se escapa al documento de atrás.
  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    node?.focus();
    function onTab(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !node) return;
      const focusables = node.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, [open]);

  if (!open) return null;

  const canRequest = state === 'expired' || state === 'error' || state === 'rateLimited';
  const message =
    state === 'expired'
      ? t('imgExpired')
      : state === 'error'
        ? t('imgError')
        : state === 'rateLimited'
          ? t('imgRateLimited')
          : state === 'missing'
            ? t('imgMissing')
            : state === 'purged'
              ? t('imgPurged')
              : null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col bg-ink outline-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Barra de controles: PRIMERA en el orden de tabulación (§34.4). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-on-ink-rule p-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={t('zoomOut')}
            onClick={zoomOut}
            className="min-h-[44px] min-w-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
          >
            <Minus size={16} aria-hidden />
          </Button>
          <span className="tabular min-w-[56px] text-center font-mono text-[11px] text-on-ink-muted">
            {t('zoomLevel', { pct: zoom })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={t('zoomIn')}
            onClick={zoomIn}
            className="min-h-[44px] min-w-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
          >
            <Plus size={16} aria-hidden />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={fit}
            className="min-h-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
          >
            <Maximize size={16} aria-hidden /> {t('fit')}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={t('rotateLeft')}
            onClick={() => onRotate(side, -90)}
            className="min-h-[44px] min-w-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
          >
            <RotateCcw size={16} aria-hidden />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={t('rotateRight')}
            onClick={() => onRotate(side, 90)}
            className="min-h-[44px] min-w-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
          >
            <RotateCw size={16} aria-hidden />
          </Button>
        </div>

        {/* Segmentado de cara: la revisión necesita las dos (el reverso lleva CURP y vigencia). */}
        <div className="flex items-center gap-1" role="group" aria-label={t('sideFront') + ' / ' + t('sideBack')}>
          {(['front', 'back'] as const).map((s) => (
            <Button
              key={s}
              type="button"
              size="sm"
              variant="secondary"
              aria-pressed={side === s}
              onClick={() => onSideChange(s)}
              className={`min-h-[44px] border-on-ink ${
                side === s ? 'bg-on-ink text-ink' : 'text-on-ink hover:bg-on-ink hover:text-ink'
              }`}
            >
              {s === 'front' ? t('sideFront') : t('sideBack')}
            </Button>
          ))}
        </div>

        {canRequest && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onRequestLink}
            loading={requesting}
            className="min-h-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
          >
            {t('imgReload')}
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={tc('close')}
          onClick={onClose}
          className="ml-auto min-h-[44px] min-w-[44px] border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
        >
          <X size={18} aria-hidden />
        </Button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        /* ⛔ No se bloquea el zoom del navegador: en táctil es LA herramienta de lectura (§34.4). */
        style={{ touchAction: 'pinch-zoom', cursor: zoom > 100 ? 'grab' : 'default' }}
        onPointerDown={(e) => {
          if (zoom <= 100) return;
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onDoubleClick={() => setZoomIndex((i) => (i === 0 ? 2 : 0))}
      >
        {url && (state === 'ready' || state === 'loading') ? (
          /* eslint-disable-next-line @next/next/no-img-element -- URL prefirmada de vida corta: no
             pasa por el optimizador de Next (ver IdDocumentViewer). */
          <img
            src={url}
            alt={alt}
            draggable={false}
            onError={() => onImageError(side)}
            onLoad={() => onImageLoad(side)}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom / 100}) rotate(${
                side === 'front' ? rotation.front : rotation.back
              }deg)`,
            }}
            className="max-h-[100dvh] max-w-[100vw] object-contain"
          />
        ) : (
          <p className="max-w-[40ch] px-6 text-center text-sm text-on-ink">{message}</p>
        )}
      </div>

      {/* La línea de privacidad se repite AQUÍ y solo aquí: en pantalla completa desaparece todo lo
          demás, y es el único sitio del sistema donde se repite (§34.14.12). */}
      <p className="flex shrink-0 items-center gap-1 p-3 font-mono text-[11px] uppercase tracking-[0.14em] text-on-ink-muted">
        <Lock size={12} aria-hidden /> {t('privacy')}
      </p>
    </div>
  );
}
