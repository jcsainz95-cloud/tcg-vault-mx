'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { sendMetaTestEvent } from '@/lib/marketing-api';
import type { AppLocale } from '@/i18n/routing';
import type { MetaTestEventResult } from '@/types/contract';
import { useReportForbidden } from './forbidden';

/**
 * «Enviar evento de prueba a Meta» (`DESIGN_SYSTEM §MKT-UX.10-b`; contrato §MKT.H.12 v1.112, solo `super_admin`).
 * Vive dentro de `AnalystAccessPanel`, que solo existe en la pestaña de súper-admin (UX-MKT-17); el servidor es la
 * autoridad (403). Visible en cualquier modo de medición: no lee `NEXT_PUBLIC_MEASUREMENT_MODE`.
 *
 * 🔒 Código y resultado viven SOLO en el estado de este componente: ⛔ sin `useMutation`/`useQuery` (su `data`
 * quedaría en la caché del QueryClient: es el criterio de `gcTime: 0` llevado al extremo, como `NewKeyDialog`);
 * ⛔ ni URL, ni `localStorage`/`sessionStorage`, ni `data-*`. Al salir de la pestaña el componente se desmonta y se borran.
 */

/** Misma regex que el servidor (§MKT.H.12), sobre el valor recortado. */
export const META_TEST_CODE_RE = /^TEST[0-9]{3,10}$/;
const MAX_MESSAGE = 300;
const TAG: Record<AppLocale, string> = { es: 'es-MX', en: 'en-US' };

type Outcome =
  | { kind: 'result'; data: MetaTestEventResult }
  | { kind: 'notConfigured' }
  | { kind: 'rateLimited'; minutes: number }
  | { kind: 'network' };

/** `{minutes}` = `ceil(retryAfterSeconds / 60)`, mínimo 1 (MKT-UX.10-b). */
export function retryMinutes(retryAfterSeconds: unknown): number {
  const s = typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0;
  return Math.max(1, Math.ceil(s / 60));
}

export function MetaTestEventBlock() {
  const t = useTranslations('admin.marketing.access.metaTest');
  const reportForbidden = useReportForbidden();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Guarda síncrona: dos clics en el mismo tick leen el mismo `pending` (patrón R4 de `NewKeyDialog`). Cada envío
  // cuenta para el límite de 5 por hora: un doble clic no puede gastar dos.
  const inFlight = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const resultTitle = useRef<HTMLParagraphElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (outcome) resultTitle.current?.focus();
  }, [outcome]);

  async function send(clean: string) {
    inFlight.current = true;
    setPending(true);
    try {
      const data = await sendMetaTestEvent(clean);
      setOutcome({ kind: 'result', data });
    } catch (e) {
      if (reportForbidden(e)) return;
      const err = asApiError(e);
      if (err?.status === 422) {
        setOutcome(null);
        setInvalid(true);
        field.current?.focus();
      } else if (err?.status === 409 && err.code === 'MEASUREMENT_META_NOT_CONFIGURED') {
        setOutcome({ kind: 'notConfigured' });
      } else if (err?.status === 429) {
        setOutcome({ kind: 'rateLimited', minutes: retryMinutes(err.details?.retryAfterSeconds) });
      } else {
        setOutcome({ kind: 'network' });
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (inFlight.current) return;
    const clean = code.trim();
    if (!META_TEST_CODE_RE.test(clean)) {
      setInvalid(true);
      field.current?.focus();
      return;
    }
    setInvalid(false);
    void send(clean);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 border border-border bg-surface p-5"
      data-testid="mkt-metatest"
    >
      <h3 id={titleId} className="font-serif text-h3 text-text">
        {t('title')}
      </h3>
      <div className="flex flex-col gap-2 text-sm text-text">
        <p>{t('help')}</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t('step1')}</li>
          <li>{t('step2')}</li>
          <li>{t('step3')}</li>
        </ol>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          ref={field}
          label={t('field.label')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => {
            // Al salir del campo, solo si ya hay algo escrito: ⛔ no regañar antes de que termine de pegar.
            if (code.trim() !== '') setInvalid(!META_TEST_CODE_RE.test(code.trim()));
          }}
          readOnly={pending}
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          className="font-mono"
          hint={t('field.hint')}
          error={invalid ? t('field.error') : undefined}
          data-testid="mkt-metatest-code"
        />
        <div className="flex flex-col gap-2">
          <Button type="submit" loading={pending} className="w-full sm:w-auto sm:self-start" data-testid="mkt-metatest-submit">
            {pending ? t('submitting') : t('submit')}
          </Button>
          <p className="text-xs text-muted">{t('note')}</p>
        </div>
      </form>
      <div aria-live="polite" data-testid="mkt-metatest-result">
        {outcome && <OutcomeView outcome={outcome} titleRef={resultTitle} />}
      </div>
    </section>
  );
}

function OutcomeView({ outcome, titleRef }: { outcome: Outcome; titleRef: React.RefObject<HTMLParagraphElement> }) {
  const t = useTranslations('admin.marketing.access.metaTest');
  const locale = useLocale() as AppLocale;
  const title = (text: string) => (
    <p ref={titleRef} tabIndex={-1} className="font-medium text-text outline-none focus-visible:shadow-focus">
      {text}
    </p>
  );

  if (outcome.kind === 'notConfigured') {
    return (
      <Banner variant="warning" role="alert">
        {title(t('notConfigured.title'))}
        <p>{t('notConfigured.body')}</p>
      </Banner>
    );
  }
  if (outcome.kind === 'rateLimited') {
    return (
      <Banner variant="warning" role="alert">
        {title(t('rateLimited.title'))}
        <p>{t('rateLimited.body', { minutes: outcome.minutes })}</p>
      </Banner>
    );
  }
  if (outcome.kind === 'network') {
    return (
      <Banner variant="danger" role="alert">
        {title(t('network'))}
      </Banner>
    );
  }

  const r = outcome.data;
  const message = r.metaError?.message ? r.metaError.message.slice(0, MAX_MESSAGE) : null;
  return (
    <div className="flex flex-col gap-3">
      {r.status === 'accepted' ? (
        <Banner variant="success">
          {title(t('accepted.title'))}
          <p className="break-all sm:break-normal">{t('accepted.body', { eventId: r.eventId })}</p>
        </Banner>
      ) : r.status === 'rejected' ? (
        <Banner variant="danger" role="alert">
          {title(t('rejected.title'))}
          {message ? (
            // `{message}` llega de Meta (suele ir en inglés): texto plano, ⛔ nunca como HTML.
            <RejectedBody message={message} />
          ) : (
            <p>{t('rejected.noMessage')}</p>
          )}
        </Banner>
      ) : (
        <Banner variant="danger" role="alert">
          {title(t('unreachable.title'))}
          <p>{t('unreachable.body')}</p>
        </Banner>
      )}
      <dl className="flex flex-col gap-2 text-sm sm:grid sm:grid-cols-[max-content_1fr] sm:gap-x-4">
        <dt className="eyebrow">{t('details.version')}</dt>
        <dd className="font-mono text-text">{r.metaVersion}</dd>
        <dt className="eyebrow">{t('details.eventId')}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-text" data-testid="mkt-metatest-eventid">
            {r.eventId}
          </span>
          <CopyButton value={r.eventId} />
        </dd>
        <dt className="eyebrow">{t('details.fbtrace')}</dt>
        <dd className="break-all font-mono text-text">{r.fbtraceId ?? '—'}</dd>
        <dt className="eyebrow">{t('details.sentAt')}</dt>
        <dd className="text-text">
          <time dateTime={r.sentAt}>
            {new Intl.DateTimeFormat(TAG[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.sentAt))}
          </time>
        </dd>
      </dl>
    </div>
  );
}

/** La frase con `{message}` partida en dos: el mensaje de Meta va como nodo de texto con `lang="en"`. */
function RejectedBody({ message }: { message: string }) {
  const t = useTranslations('admin.marketing.access.metaTest');
  const MARK = '\u0000';
  const [before, after = ''] = t('rejected.body', { message: MARK }).split(MARK);
  return (
    <p>
      {before}
      <span lang="en" className="break-words">
        {message}
      </span>
      {after}
    </p>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useTranslations('admin.marketing.access.metaTest.details');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  useEffect(() => {
    if (copied !== 'ok') return;
    const id = setTimeout(() => setCopied(null), 3000);
    return () => clearTimeout(id);
  }, [copied]);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }
  return (
    <>
      <Button variant="secondary" size="sm" type="button" onClick={copy} data-testid="mkt-metatest-copy">
        {copied === 'ok' ? t('copied') : t('copy')}
      </Button>
      <span role="status" className="text-xs text-muted">
        {copied === 'fail' ? t('copyFail') : ''}
      </span>
    </>
  );
}
