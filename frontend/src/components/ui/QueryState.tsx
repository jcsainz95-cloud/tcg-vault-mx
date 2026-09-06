'use client';

import { useTranslations } from 'next-intl';
import { Banner } from './Banner';
import { Button } from './Button';
import { ApiClientError } from '@/lib/api-client';
import { gradeLabelFromKey } from '@/lib/gradeKey';
import { getBadgeSpec } from '@/lib/status-map';

export interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  loading?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Algunos errores del contrato traen `details` **accionables** y su copy tiene por eso una variante
 * enriquecida `error.<CODE>_WITH_DETAILS`. La tabla mapea el `details` crudo a los valores ICU de
 * esa variante, y devuelve `null` cuando el backend no mandó lo necesario: entonces se usa el copy
 * base. Nunca se pinta un placeholder crudo (`{count}`) ni se inventa un número.
 *
 * `GRADED_ESTIMATE_SLAB_PUBLISHED` (409, §O.8) es el caso que motivó esto: sin la cifra, el
 * operador lee «hay slabs publicados» y no sabe **cuántos** ni de **qué grado**; con ella, el
 * mensaje es el que §O.8 exige — «esta carta ya tiene N PSA 10 publicadas, eso es dinero real».
 */
const DETAILED_ERRORS: Record<
  string,
  (
    details: Record<string, unknown>,
    t: ReturnType<typeof useTranslations>,
  ) => Record<string, string | number> | null
> = {
  GRADED_ESTIMATE_SLAB_PUBLISHED: (d) => {
    const count = d.publishedSlabCount;
    const grade = typeof d.gradeKey === 'string' ? gradeLabelFromKey(d.gradeKey) : null;
    if (typeof count !== 'number' || !Number.isFinite(count) || !grade) return null;
    return { count, grade };
  },

  /**
   * `409 CONFLICT` de los verbos que transicionan una solicitud de buylist (contrato **§M5-T**):
   * el servidor rechaza escribir sobre una fila **terminal o cerrada** y manda
   * `details: { status, closedAt }` — los **dos** términos, porque pueden discrepar (una fila con
   * `closedAt` sellado y `status` NO terminal es justo el caso que motivó la invariante).
   *
   * Sin esto el operador leía solo *«Hubo un conflicto con el estado actual»*: en una cola de
   * back-office un genérico se lee como *«la app falló»* y se reintenta. El copy enriquecido dice
   * **en qué estado quedó** la solicitud y, cuando el servidor manda `closedAt`, que **ya cerró**.
   *
   * ⚠️ El rótulo del estado sale del MISMO mapa que pinta el badge (`status-map`), no de una tabla
   * nueva ni de un literal: DESIGN_SYSTEM §9.2 prohíbe pintar el enum crudo, y una segunda tabla
   * sería otra copia del vocabulario de estado que §M5-T/criterio 129 vinieron a borrar. Si el
   * valor no tiene rótulo —enum desconocido, o un `409` de otra superficie cuyo `details.status` no
   * es un estado de solicitud— se devuelve `null` y se usa el copy base: **no se inventa nada**.
   * ⚠️ Solo el ESTADO. Ni la marca de tiempo, ni montos, ni identidades: el mensaje explica qué
   * pasó, no vuelca la fila (regla de PII/cifras internas de `PROJECT.md`, toda superficie).
   */
  CONFLICT: (d, t) => {
    if (typeof d.status !== 'string' || d.status === '') return null;
    const labelKey = getBadgeSpec('sellRequest', d.status).i18nKey;
    if (!t.has(labelKey)) return null;
    return {
      status: t(labelKey),
      // `closedAt` es OPCIONAL en la práctica (§4.18f lo declara aditivo ahí): su ausencia no
      // degrada el mensaje, solo le quita la frase de «ya cerró».
      closed: typeof d.closedAt === 'string' && d.closedAt !== '' ? 'yes' : 'no',
    };
  },
};

/**
 * Traduce errorCode del contrato a copy localizado (DESIGN_SYSTEM §8.1).
 * Si el código no tiene copy en el catálogo i18n, cae al MENSAJE REAL del backend
 * (ApiClientError.message) para no ocultar el motivo al operador (p. ej. topes AML);
 * solo si tampoco hay mensaje se muestra el genérico.
 */
export function useErrorMessage() {
  const t = useTranslations();
  return (error: unknown): string => {
    const apiError = error instanceof ApiClientError ? error : null;
    const code = apiError?.code ?? 'INTERNAL';
    const detailed = apiError?.details ? DETAILED_ERRORS[code]?.(apiError.details, t) : null;
    const detailedKey = `error.${code}_WITH_DETAILS`;
    if (detailed && t.has(detailedKey)) return t(detailedKey, detailed);
    const key = `error.${code}`;
    if (t.has(key)) return t(key);
    if (apiError?.message) return apiError.message;
    return t('common.errorGeneric');
  };
}

export function QueryState({ isLoading, isError, error, onRetry, loading, children }: QueryStateProps) {
  const t = useTranslations('common');
  const getMessage = useErrorMessage();

  if (isLoading) return <>{loading ?? <p className="text-sm text-muted">{t('loading')}</p>}</>;
  if (isError) {
    return (
      <Banner
        variant="danger"
        role="alert"
        title={t('errorTitle')}
        action={
          onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              {t('retry')}
            </Button>
          )
        }
      >
        {getMessage(error)}
      </Banner>
    );
  }
  return <>{children}</>;
}
