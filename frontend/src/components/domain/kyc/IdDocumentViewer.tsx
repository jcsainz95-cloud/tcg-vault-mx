'use client';

import { Maximize2, RotateCcw, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Estado de UNA cara del documento (DESIGN_SYSTEM §34.3c, tabla).
 *
 * ⚠️ `expired` **no es un estado de la imagen que ya está en pantalla**: el navegador descarga el
 * bitmap en el primer segundo y ese bitmap NO se cae a los 120 s. Lo que caduca es **volver a pedir
 * el objeto**, así que `expired` es lo que ve el revisor cuando una carga **nueva** falla con el
 * enlace ya vencido (recargó, volvió atrás, la pestaña estuvo dormida).
 */
export type IdDocumentState =
  | 'loading'
  | 'ready'
  | 'expired'
  | 'error'
  | 'rateLimited'
  | 'missing'
  | 'purged';

export interface IdDocumentViewerProps {
  side: 'front' | 'back';
  /** URL prefirmada. ⛔ No se guarda, no se cachea, no va al `href` de ningún enlace. */
  url?: string;
  holderName: string;
  state: IdDocumentState;
  /** Rotación en grados (múltiplos de 90). CSS puro: ⛔ no se persiste ni se re-sube. */
  rotation: number;
  onRotate: (deltaDegrees: number) => void;
  onEnlarge: () => void;
  /** «Volver a pedir el enlace» — ⛔ SIEMPRE un acto del revisor, nunca automático (§34.3c). */
  onRequestLink: () => void;
  requesting?: boolean;
  /** Segundos que faltan para poder volver a pedir, tras un `429`. */
  rateLimitSeconds?: number;
  /** El hint de rotación va UNA vez, bajo la primera cara. */
  showRotateHint?: boolean;
  onImageError: () => void;
  onImageLoad: () => void;
  /** `ref` del botón «Ampliar»: el visor devuelve el foco aquí al cerrarse (§7.6). */
  enlargeRef?: React.Ref<HTMLButtonElement>;
}

/**
 * El documento en pantalla (DESIGN_SYSTEM §34.3). Tres cosas mandan y las tres son decisiones, no
 * estilo: **que no se recorte** (`object-contain`: recortar una identificación esconde justo lo que
 * se va a cotejar, y las franjas del `contain` son información), **que sea grande** (≥ 560 px de
 * ancho útil en `lg` ⇒ el nombre impreso cae en ≈16 px CSS, legible sin ampliar) y **que se pueda
 * girar** (transform CSS; el objeto del bucket es evidencia, no un asset editable).
 *
 * ⛔ Prohibiciones que este componente sostiene (§34.14): ningún `download`, ningún
 * `target="_blank"` a la URL cruda, ninguna miniatura, ningún filtro «para que se vea mejor».
 */
export function IdDocumentViewer({
  side,
  url,
  holderName,
  state,
  rotation,
  onRotate,
  onEnlarge,
  onRequestLink,
  requesting,
  rateLimitSeconds,
  showRotateHint,
  onImageError,
  onImageLoad,
  enlargeRef,
}: IdDocumentViewerProps) {
  const t = useTranslations('admin.m6.kycReview');
  const caption = side === 'front' ? t('front') : t('back2');
  const alt = side === 'front' ? t('altFront', { name: holderName }) : t('altBack', { name: holderName });
  const sideLabel = side === 'front' ? t('sideFront') : t('sideBack');
  const interactive = state === 'ready' && !!url;

  /** Mensaje de la cara caída. Se rotula POR LO QUE PASÓ, nunca «algo salió mal» (§34.2d). */
  const message =
    state === 'expired'
      ? t('imgExpired')
      : state === 'error'
        ? t('imgError')
        : state === 'rateLimited'
          ? rateLimitSeconds && rateLimitSeconds > 0
            ? t('imgRateLimitedCountdown', { seconds: rateLimitSeconds })
            : t('imgRateLimited')
          : state === 'missing'
            ? t('imgMissing')
            : state === 'purged'
              ? t('imgPurged')
              : null;

  // «Volver a pedir el enlace» vive DENTRO del marco: un clic en el sitio donde estaba mirando.
  // ⛔ En `missing`/`purged` no se ofrece: no hay objeto que pedir, y un botón que no puede
  // funcionar mandaría al revisor a buscar un fallo que no existe.
  const canRequest = state === 'expired' || state === 'error' || state === 'rateLimited';

  return (
    <figure className="m-0 flex w-full max-w-[720px] flex-col gap-2">
      <figcaption className="eyebrow">{caption}</figcaption>
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={interactive ? t('enlargeAria', { side: sideLabel }) : undefined}
        onClick={interactive ? onEnlarge : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onEnlarge();
                }
              }
            : undefined
        }
        /* Fondo TINTA y no papel: el papel #F4F1EA se confunde con el fondo claro de una INE y le
           borra los bordes. Es el único sitio de la pantalla con superficie tinta (§34.3a). */
        className={`relative flex aspect-[1.586] w-full items-center justify-center overflow-hidden border border-on-ink-rule bg-ink lg:min-w-[560px] ${
          interactive ? 'cursor-zoom-in focus-visible:shadow-focus' : ''
        }`}
      >
        {state === 'loading' && (
          <>
            <Skeleton className="h-full w-full" />
            <span className="sr-only" aria-busy="true">
              {t('imgLoading')}
            </span>
          </>
        )}

        {url && (state === 'ready' || state === 'loading') && (
          /* eslint-disable-next-line @next/next/no-img-element -- La INE es una URL PREFIRMADA de
             vida corta contra el bucket privado: ⛔ no puede pasar por el optimizador de Next
             (cachearía PII en disco del servidor y la serviría desde una URL estable). Medido por
             el orquestador (Chromium real, 3/3, origen cruzado): `Content-Disposition: attachment`
             NO impide pintarla en un `<img>` — solo impide NAVEGAR a ella (contrato §M6-K.2.1). */
          <img
            src={url}
            alt={alt}
            onError={onImageError}
            onLoad={onImageLoad}
            fetchPriority={side === 'back' ? 'low' : undefined}
            draggable={false}
            style={{ transform: `rotate(${rotation}deg)` }}
            className="h-full w-full object-contain"
          />
        )}

        {message && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink p-6 text-center">
            <p className="max-w-[40ch] text-sm text-on-ink">{message}</p>
            {canRequest && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestLink();
                }}
                loading={requesting}
                disabled={state === 'rateLimited' && !!rateLimitSeconds && rateLimitSeconds > 0}
                className="border-on-ink text-on-ink hover:bg-on-ink hover:text-ink"
              >
                {state === 'error' ? t('imgRetry') : t('imgReload')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onEnlarge}
          disabled={!interactive}
          ref={enlargeRef}
        >
          <Maximize2 size={16} aria-hidden /> {t('enlarge')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={t('rotateLeft')}
          title={t('rotateLeft')}
          onClick={() => onRotate(-90)}
          disabled={!interactive}
        >
          <RotateCcw size={16} aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={t('rotateRight')}
          title={t('rotateRight')}
          onClick={() => onRotate(90)}
          disabled={!interactive}
        >
          <RotateCw size={16} aria-hidden />
        </Button>
      </div>
      {showRotateHint && <p className="font-mono text-[11px] text-muted">{t('rotateHint')}</p>}
    </figure>
  );
}
