'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { postWishlistMailAction } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import type { WishlistMailAction, WishlistMailActionResponse } from '@/types/contract';
import { Button } from '@/components/ui/Button';

type Params = { action: WishlistMailAction; id: string; token: string };
type Outcome =
  | { kind: 'done'; result: WishlistMailActionResponse['result'] }
  | { kind: 'invalid' }
  | { kind: 'rateLimited' }
  | { kind: 'error' };

/** Lee `a`, `id`, `t` de la URL. `null` ⇔ faltan o `a` desconocida. */
function readParams(search: string): Params | null {
  const sp = new URLSearchParams(search);
  const a = sp.get('a');
  const id = sp.get('id');
  const token = sp.get('t');
  if ((a !== 'remove' && a !== 'pause') || !id || !token) return null;
  return { action: a, id, token };
}

/**
 * Página del enlace del correo «Ya tenemos una carta de tu lista» (DESIGN_SYSTEM §WSH-UX.6 · API_CONTRACT §WSH.6).
 *
 * - **Pública, sin sesión, UN clic.** ⛔ Nada se hace al cargar: los antivirus de correo abren los enlaces solos
 *   (WSH-UX-7). El `POST` sale solo con el botón.
 * - **El token sale de la barra al montar** (`history.replaceState`): no queda en capturas ni en el historial. Los
 *   valores viven en memoria hasta el clic.
 * - ⭐ v1.87.1 (Q-WSH-UX-5): no depende del dial `wishlist_enabled` — la página no lo consulta.
 * - `404 WISHLIST_LINK_INVALID` ⇒ «Este enlace no funciona.» ⛔ sin decir por qué.
 */
export function WishlistMailActionPage() {
  const t = useTranslations('wishlist.mailAction');
  const [params, setParams] = useState<Params | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setParams(readParams(window.location.search));
    const url = new URL(window.location.href);
    if (url.search) {
      window.history.replaceState(window.history.state, '', url.pathname + url.hash);
    }
  }, []);

  const mutation = useMutation({
    mutationFn: (p: Params) => postWishlistMailAction(p),
    onMutate: () => setOutcome(null),
    onSuccess: (r) => setOutcome({ kind: 'done', result: r.result }),
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 429) setOutcome({ kind: 'rateLimited' });
      else if (err?.status === 404 || err?.status === 400) setOutcome({ kind: 'invalid' });
      else setOutcome({ kind: 'error' });
    },
  });

  useEffect(() => {
    if (outcome) resultRef.current?.focus();
  }, [outcome]);

  if (params === undefined) return <Frame />;

  const invalid = params === null || outcome?.kind === 'invalid';
  const done = outcome?.kind === 'done';
  const action = params?.action ?? 'remove';

  return (
    <Frame>
      {!invalid && (
        <>
          <h1 className="font-serif text-[30px] leading-[1.1] text-text">
            {action === 'remove' ? t('removeTitle') : t('pauseTitle')}
          </h1>
          {!done && (
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              {action === 'remove' ? t('removeBody') : t('pauseBody')}
            </p>
          )}
        </>
      )}

      <div ref={resultRef} tabIndex={-1} className="outline-none">
        {invalid && (
          <div role="alert" className="flex flex-col gap-2">
            <h1 className="font-serif text-[30px] leading-[1.1] text-text">{t('invalid')}</h1>
            <p className="text-[15px] text-muted">{t('invalidHint')}</p>
          </div>
        )}
        {outcome?.kind === 'done' && (
          <div role="status" className="mt-6 flex flex-col gap-2">
            <p className="flex items-center gap-2 text-[15px] text-text">
              {(outcome.result === 'removed' || outcome.result === 'paused') && (
                <Check size={18} className="text-success" aria-hidden />
              )}
              <span>
                {outcome.result === 'removed'
                  ? t('removed')
                  : outcome.result === 'paused'
                    ? t('paused')
                    : action === 'remove'
                      ? t('alreadyRemoved')
                      : t('alreadyPaused')}
              </span>
            </p>
            {outcome.result === 'paused' && <p className="text-sm text-muted">{t('pausedHint')}</p>}
          </div>
        )}
        {outcome?.kind === 'rateLimited' && (
          <p role="alert" className="mt-6 text-sm text-accent">
            {t('rateLimited')}
          </p>
        )}
        {outcome?.kind === 'error' && (
          <p role="alert" className="mt-6 text-sm text-accent">
            {t('error')}
          </p>
        )}
      </div>

      {!invalid && !done && params && (
        <div className="mt-8">
          <Button loading={mutation.isPending} onClick={() => mutation.mutate(params)}>
            {mutation.isPending ? t('working') : action === 'remove' ? t('removeCta') : t('pauseCta')}
          </Button>
        </div>
      )}

      {(done || invalid) && (
        <p className="mt-8">
          <Link
            href="/account/wishlist"
            className="border-b border-text pb-0.5 text-sm text-text hover:border-accent hover:text-accent"
          >
            {t('goToList')}
          </Link>
        </p>
      )}
    </Frame>
  );
}

function Frame({ children }: { children?: React.ReactNode }) {
  return <div className="gutter mx-auto max-w-md py-14 lg:py-20">{children}</div>;
}
