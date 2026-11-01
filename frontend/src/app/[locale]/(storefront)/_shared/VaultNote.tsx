'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';

/**
 * DESIGN_SYSTEM MKT-CONV.3 (T2, criterio 947; D-C = B, HECHOS 2026-10-31) — la línea de bóveda en la pila de avisos
 * bajo el precio de la ficha de CARTA (suelta y gradeada; ⛔ el sellado no la lleva), tercera tras T1a y T8. Solo con
 * sesión ANÓNIMA: con sesión no se pinta. Mono 11 px muted, sin icono, enlace ni negritas; no promete precio ni plazo.
 *
 * En el servidor (y en el primer render del cliente) no hay sesión ⇒ la línea sale en el HTML; si al montar hay
 * sesión, se retira. Así el visitante anónimo (el de Instagram) no ve saltar la ficha al hidratar.
 */
export function VaultNote({ className }: { className?: string }) {
  const t = useTranslations('catalog');
  const { user, ready } = useSession();
  if (ready && user) return null;
  return (
    <p data-testid="vault-note" className={cn('font-mono text-[11px] leading-[1.5] text-muted', className)}>
      {t('vaultNote')}
    </p>
  );
}
