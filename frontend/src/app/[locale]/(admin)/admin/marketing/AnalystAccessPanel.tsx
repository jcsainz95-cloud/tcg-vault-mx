'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { issueMarketingToken, listMarketingTokens, revokeMarketingToken } from '@/lib/marketing-api';
import type { AppLocale } from '@/i18n/routing';
import type { MarketingApiTokenView } from '@/types/contract';
import { MetaTestEventBlock } from './MetaTestEventBlock';
import { MktDialog } from './MktDialog';
import { instantDate } from './mkt-format';
import { useReportForbidden } from './forbidden';

/**
 * «Acceso del analista» (`DESIGN_SYSTEM §MKT-UX.10`; contrato §MKT.G.6, solo `super_admin`). Quien monta esto ya
 * decidió que la sesión es súper-admin (la pestaña no existe para nadie más, UX-MKT-17); el servidor es la autoridad.
 *
 * 🔒 El CLARO de la llave (`MarketingApiTokenIssued.token`) vive SOLO en el estado de `NewKeyDialog` mientras está
 * abierto (UX-MKT-16): ⛔ la petición que lo trae NO es un `useMutation` (su `data` quedaría en la MutationCache), va
 * directa al estado local; ⛔ no va a URL, `localStorage`/`sessionStorage`, consola ni
 * `data-*`; ⛔ no se vuelve a pedir. Al cerrar el diálogo, el estado se desmonta y el campo se vacía.
 */

const EXPIRES_SOON_DAYS = 30;

export function AnalystAccessPanel() {
  const t = useTranslations('admin.marketing.access');
  const tState = useTranslations('admin.marketing.state');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const reportForbidden = useReportForbidden();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<MarketingApiTokenView | null>(null);
  const [announce, setAnnounce] = useState('');
  const createBtn = useRef<HTMLButtonElement>(null);

  const tokens = useQuery({ queryKey: ['mkt', 'tokens'], queryFn: listMarketingTokens, retry: false });
  useEffect(() => {
    if (tokens.error) reportForbidden(tokens.error);
  }, [tokens.error, reportForbidden]);

  const items = tokens.data?.items ?? [];
  const active = items.filter((i) => i.status === 'active');
  const latestDead = items.find((i) => i.status !== 'active');

  return (
    <div className="flex flex-col gap-5" data-testid="mkt-access">
      <p className="text-sm text-muted">{t('lede')}</p>
      <p role="status" className="sr-only" data-testid="mkt-access-status">
        {announce}
      </p>

      {tokens.isPending ? (
        <div aria-busy="true">
          <span role="status" className="sr-only">
            {tState('loading')}
          </span>
          <Skeleton className="h-24 w-full" />
        </div>
      ) : tokens.isError ? (
        <Banner
          variant="danger"
          role="alert"
          action={
            <Button variant="secondary" size="sm" onClick={() => tokens.refetch()}>
              {tState('retry')}
            </Button>
          }
        >
          {tState('error')}
        </Banner>
      ) : (
        <>
          {active.length === 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-text">{t('none')}</p>
              {latestDead && (
                <p className="text-sm text-muted">
                  {t('dead', {
                    motivo: t(`reason.${latestDead.status === 'revoked' ? 'revoked' : 'expired'}`),
                    fecha: instantDate(latestDead.revokedAt ?? latestDead.expiresAt, locale),
                  })}
                </p>
              )}
            </div>
          )}
          {active.map((k) => (
            <KeyCard key={k.id} token={k} onRevoke={() => setRevoking(k)} />
          ))}
          <div>
            <Button ref={createBtn} onClick={() => setCreating(true)} data-testid="mkt-access-create">
              {t('create')}
            </Button>
          </div>
          {items.filter((i) => i.status !== 'active').length > 0 && (
            <ul className="flex flex-col gap-1 border-t border-border pt-3">
              {items
                .filter((i) => i.status !== 'active')
                .map((k) => (
                  <li key={k.id} className="text-xs text-muted">
                    <span className="break-words">{k.label}</span> · {t(`status.${k.status}`)} ·{' '}
                    {instantDate(k.revokedAt ?? k.expiresAt, locale)}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}

      {/* MKT-UX.10-b: debajo del estado de la llave, tras regla; no depende de que la lista de llaves cargue. */}
      <hr className="border-border" />
      <MetaTestEventBlock />

      {creating && (
        <NewKeyDialog
          onClose={() => {
            setCreating(false);
            void qc.invalidateQueries({ queryKey: ['mkt', 'tokens'] });
          }}
        />
      )}
      {revoking && (
        <RevokeDialog
          token={revoking}
          onClose={() => setRevoking(null)}
          onDone={(already) => {
            setRevoking(null);
            void qc.invalidateQueries({ queryKey: ['mkt', 'tokens'] });
            setAnnounce(already ? t('alreadyRevoked') : t('revoked'));
            requestAnimationFrame(() => createBtn.current?.focus());
          }}
        />
      )}
    </div>
  );
}

function KeyCard({ token, onRevoke }: { token: MarketingApiTokenView; onRevoke: () => void }) {
  const t = useTranslations('admin.marketing.access');
  const locale = useLocale() as AppLocale;
  // Días que faltan: diferencia entre dos instantes que DA el servidor y el reloj local solo para el aviso
  // (no decide nada que el servidor no decida ya: la llave caduca allá).
  const daysLeft = Math.ceil((Date.parse(token.expiresAt) - Date.now()) / 86_400_000);
  return (
    <article className="flex flex-col gap-3 border-t border-border pt-4" data-testid="mkt-access-key">
      {daysLeft <= EXPIRES_SOON_DAYS && daysLeft >= 0 && (
        <Banner variant="warning">{t('expiresSoon', { n: daysLeft })}</Banner>
      )}
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex gap-2">
          <dt className="eyebrow">{t('name')}</dt>
          <dd className="break-words text-text">{token.label}</dd>
        </div>
        <dd className="text-text">{t(`status.${token.status}`)}</dd>
        <dd className="text-text">{t('created', { fecha: instantDate(token.createdAt, locale) })}</dd>
        <dd className="text-text">{t('expires', { fecha: instantDate(token.expiresAt, locale) })}</dd>
        <dd className="text-muted">
          {token.lastUsedAt ? t('lastUsed', { fecha: instantDate(token.lastUsedAt, locale) }) : t('neverUsed')}
        </dd>
      </dl>
      <div>
        <Button variant="destructive" onClick={onRevoke} data-testid="mkt-access-revoke">
          {t('revokeCta')}
        </Button>
      </div>
    </article>
  );
}

/**
 * Crear llave: nombre ⇒ `POST …/tokens` ⇒ el claro se muestra UNA vez. Mientras se ve el claro, `Esc` y clic fuera NO
 * cierran y «Listo» espera a la casilla «Ya la copié y la guardé».
 */
export function NewKeyDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('admin.marketing.access');
  const tNew = useTranslations('admin.marketing.access.new');
  const reportForbidden = useReportForbidden();
  const [label, setLabel] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [failed, setFailed] = useState<'generic' | 'lost' | null>(null);
  // 🔒 Único sitio donde vive el claro. Se pierde al desmontar el diálogo.
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const copyBtn = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // 🔒 Sin `useMutation`: su `data` viviría en la MutationCache del QueryClient mientras el diálogo está abierto
  // (medido por UX-MKT-16). La respuesta va directa del `fetch` al estado local y a ningún otro sitio.
  const [pending, setPending] = useState(false);
  // R4 (techlead, 2026-10-18): el estado `pending` no basta como guarda — dos `submit` en el mismo tick leen el mismo
  // `false` antes del repintado. La ref se pone síncrona y garantiza UNA emisión por diálogo en vuelo; si no, el segundo
  // `setSecret` pisaría al primero y quedaría viva en el servidor una llave cuyo claro nadie vio.
  const inFlight = useRef(false);
  async function issue(name: string) {
    inFlight.current = true;
    setPending(true);
    try {
      const res = await issueMarketingToken(name);
      if (typeof res?.token !== 'string' || res.token === '') setFailed('lost');
      else setSecret(res.token);
    } catch (e) {
      if (reportForbidden(e)) return;
      const err = asApiError(e);
      if (err?.status === 422 || err?.status === 400) setNameError(t('errName'));
      else setFailed('generic');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (secret) copyBtn.current?.focus();
  }, [secret]);

  useEffect(() => {
    if (copied !== 'ok') return;
    const id = setTimeout(() => setCopied(null), 3000);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    field.current?.select();
    try {
      if (!navigator.clipboard?.writeText || !secret) throw new Error('no clipboard');
      await navigator.clipboard.writeText(secret);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (inFlight.current) return; // R4: ⛔ segunda emisión mientras la primera está en vuelo
    setFailed(null);
    if (!label.trim()) return setNameError(t('errName'));
    setNameError(undefined);
    void issue(label.trim());
  }

  if (secret) {
    return (
      <MktDialog
        open
        dismissible={false}
        onClose={onClose}
        title={tNew('title')}
        testId="mkt-newkey-dialog"
        initialFocusRef={copyBtn}
        footer={
          <Button disabled={!confirmed} onClick={onClose} data-testid="mkt-newkey-done">
            {tNew('done')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Banner variant="warning" title={tNew('once')}>
            {tNew('why')}
          </Banner>
          <div className="flex flex-col gap-2">
            <label htmlFor="mkt-newkey-secret" className="eyebrow">
              {tNew('field')}
            </label>
            <div className="flex flex-wrap items-end gap-2">
              <input
                id="mkt-newkey-secret"
                ref={field}
                readOnly
                value={secret}
                autoComplete="off"
                spellCheck={false}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 break-all border-b border-border-strong bg-transparent pb-2 font-mono text-sm text-text outline-none focus:shadow-focus"
              />
              <Button ref={copyBtn} variant="secondary" onClick={copy} data-testid="mkt-newkey-copy">
                {copied === 'ok' ? tNew('copied') : tNew('copy')}
              </Button>
            </div>
            <p role="status" className="text-xs text-muted">
              {copied === 'ok' ? tNew('copiedSr') : copied === 'fail' ? tNew('copyFail') : ''}
            </p>
          </div>
          <p className="text-sm text-text">{tNew('where')}</p>
          <label className="flex min-h-[44px] items-center gap-3 text-sm text-text">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-5 w-5" />
            {tNew('confirm')}
          </label>
        </div>
      </MktDialog>
    );
  }

  return (
    <MktDialog
      open
      // D6 (techlead, 2026-10-18): mientras la llave se emite, ni «Cancelar» ni `Esc` ni clic fuera cierran: si el
      // diálogo se desmontara a mitad del `POST`, la llave quedaría emitida en el servidor y su claro, perdido.
      dismissible={!pending}
      onClose={onClose}
      title={t('create')}
      testId="mkt-createkey-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending} data-testid="mkt-createkey-cancel">
            {/* mismo texto que «Cancelar» de anotaciones */}
            <CancelLabel />
          </Button>
          <Button onClick={() => submit()} loading={pending} data-testid="mkt-createkey-submit">
            {pending ? t('creating') : t('submit')}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {failed && (
          <Banner
            variant="danger"
            role="alert"
            action={
              failed === 'generic' ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => submit()}>
                  <RetryLabel />
                </Button>
              ) : undefined
            }
          >
            {failed === 'lost' ? tNew('lost') : t('errGeneric')}
          </Banner>
        )}
        <Input
          label={t('name')}
          value={label}
          maxLength={60}
          autoComplete="off"
          onChange={(e) => setLabel(e.target.value)}
          readOnly={pending}
          hint={t('nameHelp')}
          error={nameError}
        />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </MktDialog>
  );
}

function CancelLabel() {
  return <>{useTranslations('admin.marketing.ann')('cancel')}</>;
}
function RetryLabel() {
  return <>{useTranslations('admin.marketing.state')('retry')}</>;
}

function RevokeDialog({
  token,
  onClose,
  onDone,
}: {
  token: MarketingApiTokenView;
  onClose: () => void;
  onDone: (alreadyRevoked: boolean) => void;
}) {
  const t = useTranslations('admin.marketing.access');
  const reportForbidden = useReportForbidden();
  const [failed, setFailed] = useState(false);
  const revoke = useMutation({
    mutationFn: () => revokeMarketingToken(token.id),
    // Idempotente (§MKT.G.6): 200 también si ya estaba revocada. El contrato no distingue «la revoqué yo» de «ya lo
    // estaba» (mismo `revokedAt`, sin marca); la pantalla dice «Llave revocada.» en ambos casos, que es verdad.
    onSuccess: () => onDone(false),
    onError: (e) => {
      if (reportForbidden(e)) return;
      setFailed(true);
    },
  });
  return (
    <MktDialog
      open
      onClose={onClose}
      title={t('revokeDialog.title')}
      testId="mkt-revoke-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            <CancelLabel />
          </Button>
          <Button
            variant="destructive"
            loading={revoke.isPending}
            onClick={() => revoke.mutate()}
            data-testid="mkt-revoke-confirm"
          >
            {revoke.isPending ? t('revoking') : t('revokeCta')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">{t('revokeDialog.body')}</p>
      {failed && (
        <Banner variant="danger" role="alert" className="mt-3">
          {t('errGeneric')}
        </Banner>
      )}
    </MktDialog>
  );
}
