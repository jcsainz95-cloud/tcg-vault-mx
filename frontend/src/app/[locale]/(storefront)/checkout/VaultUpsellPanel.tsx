'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { InlineAuthPanel } from './InlineAuthPanel';

export interface VaultUpsellPanelProps {
  /** Tarifa de envío YA formateada (sale del dial vía `breakdown.shippingFeeCents`). */
  shippingFeeLabel?: string;
  /** correo y nombre ya capturados: el registro no vuelve a pedir nada más (§15.4) */
  defaultEmail?: string;
  defaultName?: string;
  /** "Seguir con envío a domicilio": colapsa el panel y re-selecciona envío. */
  onDismiss: () => void;
  /** Cuenta creada / sesión iniciada: el checkout continúa donde estaba, con bóveda. */
  onAccountReady: () => void;
  /** `Esc` NO descarta datos: devuelve el foco al radio de destino sin cambiar nada. */
  onEscape?: () => void;
}

/**
 * `VaultUpsellPanel` (DESIGN_SYSTEM §15.4, criterio 48) — el momento de conversión del
 * producto. Se pinta cuando el invitado elige "guardar en bóveda", y es una OFERTA, no un
 * permiso denegado: nada de `Banner danger`, candados ni `disabled`.
 *
 * Contrato §4-G.2: elegir bóveda como invitado devuelve `422 VAULT_REQUIRES_ACCOUNT` con
 * `details.upsell = true`. Ese código es la SEÑAL de este panel, jamás un error rojo.
 *
 * Formato panel inline (no modal, §15.4): mantiene visibles artículos, total y la dirección
 * ya escrita —la evidencia de valor que motiva registrarse—, y la salida queda a un clic en
 * el mismo bloque. El botón principal es `primary` (tinta) y NO `accent`: el bermellón ya
 * está asignado al botón de pago de esta pantalla.
 */
export function VaultUpsellPanel({
  shippingFeeLabel,
  defaultEmail,
  defaultName,
  onDismiss,
  onAccountReady,
  onEscape,
}: VaultUpsellPanelProps) {
  const t = useTranslations('checkout.vaultUpsell');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [variant, setVariant] = useState<'register' | 'login'>('register');

  // Al abrirse, el foco va al h3 para que el lector anuncie el BENEFICIO antes que los
  // campos (§15.4). No se mueve al primer input a propósito.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div
      role="region"
      aria-labelledby="vault-upsell-title"
      data-testid="vault-upsell"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && onEscape) {
          e.stopPropagation();
          onEscape();
        }
      }}
      className="mt-5 border-t-2 border-border-strong bg-surface-2 p-5 sm:p-7"
    >
      <p className="eyebrow">{t('eyebrow')}</p>
      <h3
        id="vault-upsell-title"
        ref={headingRef}
        tabIndex={-1}
        className="mt-3 font-serif text-[22px] leading-tight text-text outline-none"
      >
        {t('title')}
      </h3>

      <ul className="mt-5">
        <li className="border-t border-border py-3 text-sm leading-relaxed text-text">
          {/* La cifra sale del dial (breakdown.shippingFeeCents). Si no está disponible,
              se omite el paréntesis: NUNCA se inventa un monto (§15.4). */}
          {shippingFeeLabel ? t('benefit.oneShipment', { amount: shippingFeeLabel }) : t('benefit.oneShipmentPlain')}
        </li>
        <li className="border-t border-border py-3 text-sm leading-relaxed text-text">
          {t('benefit.portfolio')}
        </li>
        <li className="border-y border-border py-3 text-sm leading-relaxed text-text">
          {t('benefit.custody')}
        </li>
      </ul>

      <div className="mt-7">
        <InlineAuthPanel
          variant={variant}
          defaultEmail={defaultEmail}
          defaultName={defaultName}
          submitLabel={variant === 'register' ? t('cta') : undefined}
          neutralEmailTaken={t('emailTakenNeutral')}
          onSuccess={onAccountReady}
          onSwitchVariant={() => setVariant(variant === 'register' ? 'login' : 'register')}
          switchLabel={variant === 'register' ? t('haveAccount') : t('backToRegister')}
        />
      </div>

      {/* Salida SIEMPRE visible y redactada en positivo: prohibido el confirmshaming (§15.1). */}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-7 inline-flex min-h-[44px] items-center text-sm text-text underline underline-offset-4 hover:text-accent"
      >
        {t('dismiss')}
      </button>
    </div>
  );
}
