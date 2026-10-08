'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * P-AC-1 con su recomendación (`API_CONTRACT §AC.16`, `DESIGN_SYSTEM §AC-UX.4`): con sesión abierta los
 * accesorios no se compran (el checkout con cuenta los rechaza con `422 ACCESSORIES_REQUIRE_DIRECT_SHIP`).
 * Nota informativa (`role="note"`, regla superior `border-strong`, sin relleno); ⛔ nunca `warning`/`danger`
 * y ⛔ nunca «cierra sesión» ni «compra como invitado».
 */
export function SignedInAccessoryNotice({ className }: { className?: string }) {
  const t = useTranslations('accessories');
  return (
    <p role="note" className={cn('border-t border-border-strong pt-3 text-sm leading-relaxed text-muted', className)}>
      {t('signedInNotice')}
    </p>
  );
}
