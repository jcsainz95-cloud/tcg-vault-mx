'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getMe } from '@/lib/api';
import { useSession } from '@/lib/session';
import { isStaffRole } from '@/lib/account-routes';
import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/Skeleton';
import type { UserDTO } from '@/types/contract';
import { ProfileSection } from './ProfileSection';
import { EmailSection } from './EmailSection';
import { AddressesSection } from './AddressesSection';
import { BillingSection } from './BillingSection';
import { KycSection } from './KycSection';
import { PasswordSection } from './PasswordSection';
import { SessionSection } from './SessionSection';
import { SectionError, type AccountSectionId } from './SectionShell';

export type AccountSurface = 'storefront' | 'admin';

/** Secciones por rol (DESIGN_SYSTEM §33.6, tabla): el staff no compra, no retira ni vende. */
export function sectionsForRole(staff: boolean): AccountSectionId[] {
  return staff
    ? ['profile', 'email', 'password', 'session']
    : ['profile', 'email', 'addresses', 'billing', 'kyc', 'password', 'session'];
}

/**
 * «Mi cuenta» — un componente, dos puertas (DESIGN_SYSTEM §33.5/§33.6). Página editorial de una
 * columna (`max-w-2xl`) con índice pegajoso en `≥ lg`; cada sección carga POR SEPARADO y es su
 * propio formulario. El rol decide qué secciones existen (no «bloqueadas»: no existen, §7.15).
 *
 * El `user` viene de `GET /users/me` (`['me']`, exento del 403): es la única fuente de
 * `hasPassword`/`nameSource`; la sesión local (`useSession`) solo sirve para pintar antes del
 * primer byte y para el rol del chrome.
 */
export function AccountView({ surface }: { surface: AccountSurface }) {
  const t = useTranslations('account');
  const { user: sessionUser, ready } = useSession();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: ready && !!sessionUser });
  const user: UserDTO | null = meQuery.data ?? sessionUser;
  const staff = isStaffRole(user?.role);
  const sections = useMemo(() => sectionsForRole(staff), [staff]);
  const [hash, setHash] = useState<string>('');

  // Anclajes (`#profile`, `#password`…): al llegar con hash la sección recibe el foco (tabIndex=-1,
  // patrón P-4) y queda centrada. `scrollIntoView?.` porque jsdom no lo implementa.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = window.location.hash.replace(/^#/, '');
    setHash(h);
    if (!h || !user) return;
    const el = document.getElementById(h);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });
    el.focus?.({ preventScroll: true });
    // Solo cuando el usuario (y por tanto las secciones) ya está montado.
  }, [user]);

  const active = useActiveSection(sections, !!user);

  if (!ready) return <AccountSkeleton />;

  if (!user) {
    // Sin sesión aquí solo se llega en modo mock (los guards cubren el modo real): se pinta el
    // error de la query (401) con reintento, nunca un perfil vacío.
    return (
      <div className="gutter mx-auto max-w-2xl py-10">
        <SectionError error={meQuery.error} onRetry={() => meQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="gutter mx-auto max-w-5xl py-10 lg:py-14">
      <div className="lg:grid lg:grid-cols-[200px_1fr] lg:gap-12">
        <nav
          aria-label={t('index.label')}
          className="hidden lg:block lg:self-start lg:sticky lg:top-[calc(var(--app-header-h,0px)+24px)]"
        >
          <ul className="flex flex-col gap-3">
            {sections.map((id) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? 'location' : undefined}
                  className={cn(
                    'font-mono text-[11px] uppercase tracking-label transition-colors',
                    active === id ? 'text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {sectionTitle(id, t)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1 className="mt-3 font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
          {/* El correo, no el nombre (regla 2 de §33.0: un nombre inventado no es rótulo). */}
          <p className="mt-3 break-all text-[15px] text-muted">{user.email}</p>

          {meQuery.isError && (
            <div className="mt-6">
              <SectionError error={meQuery.error} onRetry={() => meQuery.refetch()} />
            </div>
          )}

          {sections.includes('profile') && (
            <ProfileSection user={user} focusNameOnMount={hash === 'profile'} />
          )}
          {sections.includes('email') && <EmailSection user={user} canResend={!staff} />}
          {sections.includes('addresses') && <AddressesSection user={user} />}
          {sections.includes('billing') && <BillingSection accountEmail={user.email} />}
          {sections.includes('kyc') && <KycSection />}
          {sections.includes('password') && <PasswordSection user={user} />}
          {sections.includes('session') && <SessionSection surface={surface} />}
        </div>
      </div>
    </div>
  );
}

function sectionTitle(id: AccountSectionId, t: ReturnType<typeof useTranslations<'account'>>): string {
  switch (id) {
    case 'profile':
      return t('profile.title');
    case 'email':
      return t('email.title');
    case 'addresses':
      return t('addresses.title');
    case 'billing':
      return t('billing.title');
    case 'kyc':
      return t('kyc.title');
    case 'password':
      return t('password.title');
    case 'session':
      return t('session.title');
  }
}

/** Sección visible para el índice (`aria-current="location"`). Sin IntersectionObserver (jsdom): la primera. */
function useActiveSection(sections: AccountSectionId[], mounted: boolean): AccountSectionId {
  const [active, setActive] = useState<AccountSectionId>(sections[0]);
  useEffect(() => {
    setActive(sections[0]);
    if (!mounted || typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<AccountSectionId, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).id as AccountSectionId;
          if (e.isIntersecting) visible.set(id, e.intersectionRatio);
          else visible.delete(id);
        }
        const first = sections.find((s) => visible.has(s));
        if (first) setActive(first);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5] },
    );
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections, mounted]);
  return active;
}

function AccountSkeleton() {
  return (
    <div className="gutter mx-auto max-w-2xl py-10" aria-busy="true">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-4 h-9 w-48" />
      <Skeleton className="mt-3 h-4 w-64" />
      <Skeleton className="mt-12 h-6 w-40" />
      <Skeleton className="mt-6 h-11 w-full" />
      <Skeleton className="mt-4 h-11 w-full" />
    </div>
  );
}
