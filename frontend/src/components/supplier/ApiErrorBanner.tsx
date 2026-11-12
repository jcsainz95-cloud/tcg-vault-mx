'use client';

import { useTranslations } from 'next-intl';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';

/** Traduce el `code` del API (`error.<CODE>`); sin copy propio, aviso genérico. Nunca pinta el mensaje crudo. */
export function ApiErrorBanner({ error }: { error: unknown }) {
  const te = useTranslations('supplier.errors');
  const tg = useTranslations('error');
  const tc = useTranslations('common');
  if (!error) return null;
  const code = asApiError(error)?.code;
  return <Banner variant="danger">{code && te.has(code) ? te(code) : code && tg.has(code) ? tg(code) : tc('errorGeneric')}</Banner>;
}
