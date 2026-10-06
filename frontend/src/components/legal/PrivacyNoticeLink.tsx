'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * LIVE-8 · enlaces al aviso de privacidad (API_CONTRACT v1.84.1 §14.14 E-9; DESIGN_SYSTEM §80;
 * criterios 503–505). UN componente para los siete sitios.
 *
 * ⭐ La decisión «¿se enlaza?» NO se toma aquí. Es la del pie (`privacyLinkVisible()` de
 * `(storefront)/footer.ts`, que es `privacyVisibility(...) !== 'hidden'`) y la calcula EN EL
 * SERVIDOR `app/[locale]/layout.tsx`, que la pasa por {@link PrivacyLinkProvider}. Motivo (riesgo
 * F-7 de §80.6): los sitios `inline` son componentes de cliente y `VERCEL_ENV` no llega al
 * navegador; si este fichero llamara a `privacyLinkVisible()`, en la vista previa con borrador el
 * pie enlazaría y las frases no. Además, importar `privacidad.es.ts` aquí metería el aviso entero
 * en el paquete del cliente. ⛔ Este fichero no lee `process.env` ni importa el módulo legal
 * (candado en `PrivacyNoticeLink.test.tsx`).
 *
 * Sin proveedor ⇒ `false` (falla hacia lo seguro: texto sin enlace, nunca un enlace a un 404).
 */
const PrivacyLinkContext = createContext<boolean>(false);

export function PrivacyLinkProvider({ linked, children }: { linked: boolean; children: ReactNode }) {
  return <PrivacyLinkContext.Provider value={linked}>{children}</PrivacyLinkContext.Provider>;
}

export function usePrivacyLinked(): boolean {
  return useContext(PrivacyLinkContext);
}

export const PRIVACY_HREF = '/privacidad';

/** Clases del enlace dentro de una frase (§80.1): subrayado SIEMPRE (el color solo no basta, §80.4). */
export const INLINE_LINK_CLASS =
  'whitespace-nowrap text-accent underline decoration-1 underline-offset-4 hover:text-text';

/** Enlace dentro de frase: pestaña nueva, icono y aviso para lector ANTES de abrir (§80.1, WCAG G201). */
function InlineAnchor({ href, children }: { href: string; children: ReactNode }) {
  const t = useTranslations('privacy');
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK_CLASS}>
      {children}
      <ArrowUpRight aria-hidden className="ml-0.5 inline h-3 w-3 align-baseline" />
      <span className="sr-only"> {t('opensInNewTab')}</span>
    </Link>
  );
}

export type PrivacyNoticeLinkProps =
  | {
      /** Dentro de una frase (sitios 2–6). `children` = el trozo `<privacy>…</privacy>` de la clave. */
      variant: 'inline';
      children: ReactNode;
    }
  | {
      /** En la fila de enlaces del pie (sitios 1 y 7). Texto `privacy.link`, misma pestaña. */
      variant: 'nav';
      className?: string;
    };

export function PrivacyNoticeLink(props: PrivacyNoticeLinkProps) {
  const linked = usePrivacyLinked();
  const t = useTranslations('privacy');
  if (props.variant === 'nav') {
    // Sin página ⇒ nada: en una fila de enlaces, una etiqueta que no se pulsa se lee como roto (§80.1).
    if (!linked) return null;
    return (
      <Link href={PRIVACY_HREF} className={props.className}>
        {t('link')}
      </Link>
    );
  }
  // Sin página ⇒ el MISMO texto, heredando el estilo de la frase; sin foco, sin icono, sin aviso.
  if (!linked) return <span data-privacy-link="off">{props.children}</span>;
  return <InlineAnchor href={PRIVACY_HREF}>{props.children}</InlineAnchor>;
}

/**
 * «Términos» cuando comparte frase con el aviso (sitios 2 y 3): misma conducta `inline` (§80.1:
 * dos enlaces de la misma frase no pueden comportarse distinto). La página de términos se sirve
 * siempre, así que no depende de la decisión.
 */
export function TermsInlineLink({ children }: { children: ReactNode }) {
  return <InlineAnchor href="/terminos">{children}</InlineAnchor>;
}

/** Etiquetas de texto enriquecido de `privacy.sites.*` (`<terms>`, `<privacy>`), para `t.rich`. */
export const privacyRichTags = {
  terms: (chunks: ReactNode) => <TermsInlineLink>{chunks}</TermsInlineLink>,
  privacy: (chunks: ReactNode) => <PrivacyNoticeLink variant="inline">{chunks}</PrivacyNoticeLink>,
};

export type PrivacySite = 'register' | 'googleSignIn' | 'guestCheckout' | 'checkout' | 'sellForm' | 'accountIne';

/**
 * Una frase `privacy.sites.<key>` con sus etiquetas. Lo que usan los sitios `inline`.
 * `as="span"`: para ir dentro de una `<label>` (sitio 3, la casilla del invitado), donde un `<p>` no es válido.
 */
export function PrivacySiteNote({
  site,
  className,
  testId,
  as: Tag = 'p',
}: {
  site: PrivacySite;
  className?: string;
  testId?: string;
  as?: 'p' | 'span';
}) {
  const t = useTranslations('privacy.sites');
  return (
    <Tag className={className} data-testid={testId ?? `privacy-site-${site}`}>
      {t.rich(site, privacyRichTags)}
    </Tag>
  );
}

/** Etiquetas de `privacy.sites.*` que devuelven solo su texto, para `t.markup` (resúmenes en texto plano, §80.1). */
export const privacyPlainTags = {
  terms: (chunks: string) => chunks,
  privacy: (chunks: string) => chunks,
};
