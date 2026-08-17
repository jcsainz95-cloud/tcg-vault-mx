'use client';

import { useTranslations } from 'next-intl';
import { Banner } from './Banner';
import { Button } from './Button';
import { ApiClientError } from '@/lib/api-client';

export interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  loading?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Traduce errorCode del contrato a copy localizado (DESIGN_SYSTEM §8.1).
 * Si el código no tiene copy en el catálogo i18n, cae al MENSAJE REAL del backend
 * (ApiClientError.message) para no ocultar el motivo al operador (p. ej. topes AML);
 * solo si tampoco hay mensaje se muestra el genérico.
 */
export function useErrorMessage() {
  const t = useTranslations();
  return (error: unknown): string => {
    const code = error instanceof ApiClientError ? error.code : 'INTERNAL';
    const key = `error.${code}`;
    if (t.has(key)) return t(key);
    if (error instanceof ApiClientError && error.message) return error.message;
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
