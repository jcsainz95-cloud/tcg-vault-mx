'use client';

import { useTranslations } from 'next-intl';
import { Banner } from './Banner';
import { Button } from './Button';
import { ApiClientError } from '@/lib/api-client';
import { gradeLabelFromKey } from '@/lib/gradeKey';

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
  (details: Record<string, unknown>) => Record<string, string | number> | null
> = {
  GRADED_ESTIMATE_SLAB_PUBLISHED: (d) => {
    const count = d.publishedSlabCount;
    const grade = typeof d.gradeKey === 'string' ? gradeLabelFromKey(d.gradeKey) : null;
    if (typeof count !== 'number' || !Number.isFinite(count) || !grade) return null;
    return { count, grade };
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
    const detailed = apiError?.details ? DETAILED_ERRORS[code]?.(apiError.details) : null;
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
