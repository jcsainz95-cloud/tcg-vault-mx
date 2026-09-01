'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSellRequest, respondToSellOffer } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { useBuylistSteps } from '@/lib/pipelines';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { SellItemDTO, SellRequestDetailDTO } from '@/types/contract';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BuylistShippingNote } from '@/components/domain/BuylistShippingNote';
import { FinishLabel } from '../../../_shared/FinishLabel';
import { SUPPORT_CONTACT_FALLBACK } from '../../../checkout/support-contact';
import { OfferAmounts } from './OfferAmounts';
import { readOffer } from './offer-readiness';

/** Identidad de la carta bajo su nombre: set · número · acabado. Mismo renglón que el correo. */
function LineSpec({ line }: { line: SellItemDTO }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] uppercase leading-none tracking-[0.08em] text-muted">
      <span>{line.card.setName}</span>
      <span aria-hidden>·</span>
      <span>{line.card.number}</span>
      <FinishLabel finish={line.finish} productType={line.productType} className="text-[11px]" />
    </span>
  );
}

/**
 * **PORTAL DEL VENDEDOR — la pantalla a la que lleva el correo de la oferta.**
 * Contrato §6 (`GET /buylist/requests/:id`, `POST …/offer-response`) · DESIGN_SYSTEM §23.5.
 *
 * ### La regla que gobierna todo el archivo: ESPEJO (§23.5a)
 * La pantalla y el correo se pintan **del mismo `SellOfferPublicDTO` y del mismo `offer.terms`**.
 * La UI **no calcula ninguno de los tres montos, ni el plazo, ni la resta**. Por eso la condición
 * NM y el bloque de consecuencia se pintan **verbatim como llegan** (`terms`, renderizado por el
 * backend con las plantillas del correo) y **no existen en el catálogo i18n del front**: dos
 * plantillas para el mismo texto se separan en el primer cambio de copy, y aquí eso significa que
 * el correo y la pantalla le dirían al vendedor **dos tratos distintos**.
 *
 * ### Lo que esta pantalla NO le enseña al vendedor (y por qué está escrito)
 * Nada de la mesa de decisión: **posición, sugerencia, «en camino», el tope del operador**, ni
 * `offerState`, ni `offerDerivedPriceCents`/`offerOverrideReason`. No es disciplina de este
 * archivo: **el contrato no los manda** y el tipo `SellItemDTO` del front ni siquiera los declara.
 * Él ve su oferta, no nuestros controles.
 *
 * ### Todo-o-nada, demostrado por lo que NO está (§23.5c, §P.11)
 * La lista de líneas es de **solo lectura**: sin casillas, sin «quitar esta carta», sin
 * contraoferta. El endpoint tampoco acepta líneas — el body es `{ decision }` y nada más.
 */
export function SellRequestDetailView({ sellRequestId }: { sellRequestId: string }) {
  const t = useTranslations('buylist.offer');
  const tb = useTranslations('buylist');
  const locale = useLocale() as AppLocale;
  const { ready, isAuthenticated } = useSession();
  const steps = useBuylistSteps();
  const queryClient = useQueryClient();
  const getErrorMessage = useErrorMessage();

  /**
   * Confirmación de dinero (§7.6 / §23.5c). `null` = cerrada.
   */
  const [confirming, setConfirming] = useState<'accept' | 'reject' | null>(null);
  /**
   * ⚠️ **Qué acaba de decidir el vendedor EN ESTA SESIÓN.** No es cosmético: al recargar en frío
   * una solicitud `rechazada` **el DTO no dice quién la rechazó** —el vendedor explícitamente, o
   * el barrido por no responder a tiempo— y §23.5f asume que fue el plazo. Decir «la oferta
   * venció» a alguien que la rechazó a mano es falso, y decir «la rechazaste» a alguien que
   * simplemente no contestó también. Así que: **mientras lo sabemos de primera mano, se dice con
   * precisión; en frío se usa una frase neutra que es cierta en los dos casos.** Misma doctrina
   * que el fallback de §23.1d: ante un desenlace ambiguo, el sistema no afirma de más.
   */
  const [justResolved, setJustResolved] = useState<'accept' | 'reject' | null>(null);

  // Sin sesión NO se consulta: el endpoint exige sesión del dueño y un 401 pintaría un banner de
  // error donde lo correcto es una invitación a entrar (el vendedor viene de un correo).
  const enabled = ready && isAuthenticated;
  const query = useQuery({
    queryKey: ['sell-request', sellRequestId],
    queryFn: () => getSellRequest(sellRequestId),
    enabled,
    // Una solicitud ajena o inexistente responde 404 (el contrato NO usa 403, para no confirmar
    // que existe). Reintentar un 404 solo retrasa el mensaje.
    retry: false,
  });

  const respond = useMutation({
    mutationFn: (decision: 'accept' | 'reject') => respondToSellOffer(sellRequestId, decision),
    onSuccess: (_res, decision) => {
      setConfirming(null);
      setJustResolved(decision);
      void queryClient.invalidateQueries({ queryKey: ['sell-request', sellRequestId] });
      // La lista de «Mis solicitudes» comparte el hecho: se refresca para no quedar desfasada.
      void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
    },
  });

  if (!ready) return null;

  if (!isAuthenticated) {
    return (
      <div className="gutter py-16">
        <EmptyState
          title={t('loginTitle')}
          body={t('loginBody')}
          action={
            <Link
              href={`/login?next=${encodeURIComponent(`/buylist/requests/${sellRequestId}`)}`}
              className="inline-block border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
            >
              {tb('loginCta')}
            </Link>
          }
        />
      </div>
    );
  }

  const notFound = query.error instanceof ApiClientError && query.error.status === 404;
  if (notFound) {
    return (
      <div className="gutter py-16">
        <EmptyState
          title={t('notFoundTitle')}
          body={t('notFoundBody')}
          action={
            <Link
              href="/buylist"
              className="inline-block border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
            >
              {t('backToBuylist')}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={<DetailSkeleton />}
    >
      {query.data && (
        <Detail
          data={query.data}
          locale={locale}
          steps={steps}
          justResolved={justResolved}
          confirming={confirming}
          setConfirming={setConfirming}
          onRespond={(decision) => respond.mutate(decision)}
          isResponding={respond.isPending}
          respondError={respond.isError ? getErrorMessage(respond.error) : null}
        />
      )}
    </QueryState>
  );
}

/**
 * Estado de CARGA (§23.9). ⚠️ **Regla money-safe del skeleton:** ningún skeleton reserva el hueco
 * de una cifra que puede **no existir**. Mientras la petición está en vuelo **no sabemos si esta
 * solicitud tiene oferta**, así que aquí no se dibuja el bloque de los tres montos: hacerlo
 * prometería una cifra que en la mitad de los casos nunca va a llegar, y el vendedor vería un
 * hueco de dinero desaparecer. Se esqueletizan solo las piezas que existen SIEMPRE: la cabecera,
 * el recorrido y las líneas.
 */
function DetailSkeleton() {
  return (
    <div className="gutter py-10" data-testid="sell-request-skeleton">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-6 h-40 w-full" />
      <Skeleton className="mt-6 h-24 w-full" />
    </div>
  );
}

type Decision = 'accept' | 'reject';

function Detail({
  data,
  locale,
  steps,
  justResolved,
  confirming,
  setConfirming,
  onRespond,
  isResponding,
  respondError,
}: {
  data: SellRequestDetailDTO;
  locale: AppLocale;
  steps: ReturnType<typeof useBuylistSteps>;
  justResolved: Decision | null;
  confirming: Decision | null;
  setConfirming: (v: Decision | null) => void;
  onRespond: (decision: Decision) => void;
  isResponding: boolean;
  respondError: string | null;
}) {
  const t = useTranslations('buylist.offer');
  const tb = useTranslations('buylist');
  const tc = useTranslations('common');
  const offer = data.offer ?? null;
  const readiness = offer ? readOffer(offer) : null;
  // ⚠️ `no_offer` es el único desenlace donde el dinero DESAPARECE de la pantalla: «MX$ 1,200»
  // junto a «no procedimos» se lee como una deuda (v1.51.4). El servidor ya proyecta los montos
  // a `null`, y esto es el segundo cinturón: si un backend anterior los sigue mandando, aquí no
  // se pintan igual. Las cartas SÍ se siguen listando — no se le borra su solicitud, se le quita
  // una cifra que ya no significa nada.
  const hideMoney = data.status === 'expirada' && data.expiredReason === 'no_offer';

  /**
   * ⚠️ **Las acciones NO se apagan por el reloj del navegador, y es deliberado.**
   * El único gate es `status === 'ofertada'` + una oferta que se puede enseñar entera. Comparar
   * `acceptDeadlineAt > now` en el cliente para esconder los botones parece prudente y es el peor
   * de los dos errores posibles: con el reloj del equipo adelantado (o una zona mal configurada)
   * **le impediríamos aceptar una oferta viva y vinculante** — se pierde la venta y no hay
   * remedio self-service. Al revés, si el plazo sí venció, el servidor responde
   * `409 OFFER_EXPIRED`, **nada se mueve** y la pantalla lo dice con la fecha real. *La pantalla
   * informa; la puerta decide.*
   */
  const canRespond =
    data.status === 'ofertada' && !!offer && readiness?.renderable === true && !justResolved;

  const stepTimestamps: Record<string, string | null | undefined> = {
    cotizada: data.createdAt ? formatDateTimeMx(data.createdAt, locale) : undefined,
    ofertada: offer ? formatDateTimeMx(offer.sentAt, locale) : undefined,
    aceptada: offer?.acceptedAt ? formatDateTimeMx(offer.acceptedAt, locale) : undefined,
  };

  const buyCount = readiness?.renderable ? readiness.buy.length : 0;
  const netAmount = offer ? formatMoneyCents(offer.netCents, locale) : '';

  return (
    <div className="pb-16">
      <header className="gutter flex flex-wrap items-baseline justify-between gap-3 pb-5 pt-10 lg:pt-[46px]">
        <span className="flex flex-col gap-2">
          <span className="eyebrow">{t('eyebrow')}</span>
          <span className="tabular font-mono text-[15px] text-text">{data.sellRequestId}</span>
        </span>
        {/* §23.1d: `expirada` se pinta por su MOTIVO, y en la pantalla del vendedor importa más
            que en ninguna otra: pintar un `no_offer` con el rojo de `not_shipped` le imputaría un
            incumplimiento que nunca cometió. */}
        <StatusBadge domain="sellRequest" value={data.status} reason={data.expiredReason} />
      </header>

      <div className="gutter border-t border-border pt-6">
        {/* §23.2b: en el portal el recorrido es SIEMPRE vertical, con fecha y hora — el vendedor
            no lee un pipeline, lee el historial de su venta. */}
        <PipelineStepper
          steps={steps}
          current={data.status}
          errored={data.isTerminal && data.status !== 'pagada'}
          orientation="vertical"
          timestamps={stepTimestamps}
        />
      </div>

      {/* D42: el portal no puede contradecir al correo 5. Viaja el CUÁNDO y nada más. */}
      {data.lastOfferCancelledAt && (
        <div className="gutter mt-6">
          <Banner variant="info">
            {t('cancelledBanner', { date: formatDateTimeMx(data.lastOfferCancelledAt, locale) })}
          </Banner>
        </div>
      )}

      {offer && readiness && !readiness.renderable && (
        <div className="gutter mt-6">
          {/* Ver `offer-readiness.ts`: si no se puede enseñar el trato entero, no se enseña a
              medias ni se ofrece aceptarlo. */}
          <Banner variant="warning" role="alert" title={t('incompleteTitle')}>
            {t('incompleteBody', { email: SUPPORT_CONTACT_FALLBACK })}
          </Banner>
        </div>
      )}

      {offer && readiness?.renderable && (
        <section className="gutter mt-8">
          <h1 className="font-serif text-[22px] leading-[1.15] text-text lg:text-[30px]">
            {t('headline', { bought: readiness.buy.length, total: offer.lines.length })}
          </h1>
          {/* R2 / §23.4.2: la condición va ANTES del dinero y también DENTRO de cada línea. */}
          <p className="mt-4 max-w-[62ch] text-sm leading-[1.7] text-text">{t('conditionIntro')}</p>

          <h2 className="eyebrow mt-8">{t('buyGroup', { count: readiness.buy.length })}</h2>
          <ul className="mt-2">
            {readiness.buy.map(({ line, condition, offeredPriceCents }) => (
              <li key={line.id} className="border-b border-border py-3.5 last:border-b-0">
                <span className="block text-[15px] font-medium text-text" lang="en">
                  {line.card.name}
                </span>
                <LineSpec line={line} />
                {/* ⚠️ La condición y el monto van EN EL MISMO RENGLÓN (§23.4.2, decisión 1): es
                    imposible leer el precio sin barrer la condición. La condición va en TINTA,
                    nunca muted — no es letra chica — y es el string del servidor, verbatim. */}
                <span className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm text-text">{condition}</span>
                  <span className="tabular font-mono text-[15px] text-text">
                    {formatMoneyCents(offeredPriceCents, locale)}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {readiness.skip.length > 0 && (
            <>
              <h2 className="eyebrow mt-8">{t('skipGroup', { count: readiness.skip.length })}</h2>
              <ul className="mt-2">
                {readiness.skip.map(({ line }) => (
                  <li
                    key={line.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-3.5 last:border-b-0"
                  >
                    <span className="flex flex-col">
                      <span className="text-[15px] text-muted" lang="en">
                        {line.card.name}
                      </span>
                      <LineSpec line={line} />
                    </span>
                    {/* ⚠️ PROHIBIDO `MX$ 0.00` aquí: cero es un precio y en esta línea no hay
                        precio. Y prohibido explicar POR QUÉ no se compró (deliberación interna). */}
                    <span className="text-sm text-muted">{t('skipLabel')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Único bloque sobre POZO de la pantalla, igual que en el correo: es lo que el vendedor
              tiene que poder encontrar de un vistazo cuando le rechacemos una carta. */}
          <div className="mt-8 border-y border-border bg-surface-2 px-5 py-5">
            <h2 className="eyebrow">{t('consequenceTitle')}</h2>
            <p className="mt-3 max-w-[62ch] text-sm leading-[1.7] text-text">
              {readiness.consequence}
            </p>
          </div>

          <div className="mt-8 max-w-[420px]">
            <OfferAmounts offer={offer} boughtCount={buyCount} />
          </div>

          {/* Plazo con fecha y hora explícitas, YA RESUELTO por el servidor (criterio 154). Sin
              cuenta atrás y sin urgencia artificial. */}
          <p className="mt-6 max-w-[62ch] text-sm leading-[1.7] text-text">
            {t('deadline', { deadline: formatDateTimeMx(offer.acceptDeadlineAt, locale) })}
          </p>

          {/* §23.5c: los 409 se pintan como BANNER PERSISTENTE con el estado real, no como toast
              — el vendedor acaba de intentar comprometer dinero. `role="alert"` = assertive. */}
          {respondError && (
            <div className="mt-6 max-w-[62ch]">
              <Banner variant="danger" role="alert" title={t('eyebrow')}>
                {respondError}
              </Banner>
            </div>
          )}

          {/*
            ⚠️ **Una sola región `aria-live="polite"`, y envuelve a las acciones desde el primer
            render.** §23.10 pide anunciar el resultado de aceptar o rechazar; una región que
            aparece *junto con* su contenido no se anuncia en varios lectores, así que la región
            existe siempre y lo que cambia es lo de dentro: botones → desenlace. `polite` (no
            `assertive`) porque es el desenlace esperado; lo `assertive` se reserva a los errores
            de dinero, que van en el `Banner role="alert"` de arriba.
          */}
          <div className="mt-7" aria-live="polite">
            {canRespond ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  className="w-full sm:w-auto"
                  disabled={isResponding}
                  onClick={() => setConfirming('accept')}
                >
                  {t('accept')}
                </Button>
                {/* `secondary`, NUNCA `destructive`: rechazar es legítimo. El rojo del sistema es
                    de atención, no de castigo — pintarlo así presionaría a aceptar. */}
                <Button
                  variant="secondary"
                  className="w-full sm:w-auto"
                  disabled={isResponding}
                  onClick={() => setConfirming('reject')}
                >
                  {t('reject')}
                </Button>
              </div>
            ) : (
              <ResolvedNotice data={data} locale={locale} justResolved={justResolved} />
            )}
          </div>
        </section>
      )}

      {!offer && (
        <section className="gutter mt-8">
          {/* §23.5d — ANTES de que exista oferta: ni guía, ni NUESTRA dirección, ni instrucciones
              de envío, y ninguna vía para decir «ya lo mandé» (criterio 114). */}
          <h1 className="font-serif text-[22px] leading-[1.15] text-text lg:text-[30px]">
            {data.isTerminal ? tb('myRequests') : t('preOfferTitle')}
          </h1>
          {!data.isTerminal && (
            <>
              <p className="mt-4 max-w-[62ch] text-sm leading-[1.7] text-text">
                {t('preOfferBody')}
              </p>
              {/* La nota de servicio del envío, palabra por palabra y SIN CIFRAS (§23.3d/D43):
                  antes de la oferta no existe tarifa congelada, así que cualquier cifra aquí
                  sería la del dial de hoy. Antes de la oferta, la frase; desde la oferta, los
                  tres montos. */}
              <BuylistShippingNote className="mt-4 max-w-[62ch]" />
            </>
          )}
          <ClosedNotice data={data} />
        </section>
      )}

      <section className="gutter mt-10">
        <h2 className="eyebrow">{t('cardsTitle')}</h2>
        <ul className="mt-2">
          {data.items.map((line) => (
            <li
              key={line.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0"
            >
              <span className="flex flex-col">
                <span className="text-[15px] text-text" lang="en">
                  {line.card.name}
                </span>
                <LineSpec line={line} />
              </span>
              {!hideMoney && line.quotedPriceCents != null && (
                <span className="tabular font-mono text-sm text-muted">
                  {formatMoneyCents(line.quotedPriceCents, locale)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* §23.5d/e — SU propia dirección de origen: es su dato y es lo que vamos a IMPRIMIR, así
          que tiene que poder verificarla ANTES de que compremos la etiqueta. No es NUESTRA
          dirección (esa sigue oculta hasta la aceptación, criterio 114). */}
      {data.pickupAddress && (
        <section className="gutter mt-10">
          <h2 className="eyebrow">{tb('request.address.label')}</h2>
          <address className="mt-2 not-italic text-sm leading-[1.7] text-text">
            {[
              data.pickupAddress.line1,
              data.pickupAddress.line2,
              data.pickupAddress.neighborhood,
              `${data.pickupAddress.postalCode} ${data.pickupAddress.city}, ${data.pickupAddress.state}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </address>
          <p className="mt-2 text-[13px] leading-[1.6] text-muted">{tb('request.address.printed')}</p>
        </section>
      )}

      {offer && readiness?.renderable && (
        <Modal
          open={confirming !== null}
          onClose={() => setConfirming(null)}
          title={confirming === 'reject' ? t('confirmRejectTitle') : t('confirmAcceptTitle')}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                {tc('cancel')}
              </Button>
              <Button
                variant={confirming === 'reject' ? 'secondary' : 'primary'}
                loading={isResponding}
                onClick={() => onRespond(confirming === 'reject' ? 'reject' : 'accept')}
              >
                {confirming === 'reject' ? t('confirmRejectCta') : t('confirmAcceptCta')}
              </Button>
            </>
          }
        >
          {/* §23.5c: repite EL NETO y LA CONDICIÓN en una frase, y el botón dice el verbo con el
              monto. Sin cuenta atrás, sin urgencia artificial. La resta NO se repite aquí: el
              diálogo se abre a un palmo del bloque de los tres montos, y meterle la resta
              convertiría el último clic en una re-lectura del trato. */}
          {confirming === 'reject' ? (
            <p className="leading-[1.7]">{t('confirmRejectBody')}</p>
          ) : (
            <p className="leading-[1.7]">
              {t('confirmAcceptBody', {
                count: readiness.buy.length,
                netAmount,
                condition: readiness.condition,
              })}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * Estado de una oferta que ya no admite respuesta (aceptada, rechazada, o simplemente en una
 * etapa posterior). Sustituye al bloque de acciones (§23.5c).
 */
function ResolvedNotice({
  data,
  locale,
  justResolved,
}: {
  data: SellRequestDetailDTO;
  locale: AppLocale;
  justResolved: Decision | null;
}) {
  const t = useTranslations('buylist.offer');
  const acceptedAt = data.offer?.acceptedAt;
  const message = (() => {
    if (justResolved === 'accept') return t('acceptedNow');
    if (justResolved === 'reject') return t('rejectedNow');
    if (acceptedAt) return t('acceptedOn', { date: formatDateTimeMx(acceptedAt, locale) });
    if (data.status === 'pagada') return t('closedPaid');
    if (data.status === 'ofertada') return null; // sigue viva: no hay nada que anunciar.
    return t('noLongerActive');
  })();
  if (!message) return null;
  return (
    <div>
      <p className="border-l-2 border-text pl-4 text-sm leading-[1.7] text-text">{message}</p>
      {data.isTerminal && <QuoteAgainCta />}
    </div>
  );
}

/** Cierres terminales sin oferta viva (§23.5f). Cada desenlace dice lo MISMO que su correo. */
function ClosedNotice({ data }: { data: SellRequestDetailDTO }) {
  const t = useTranslations('buylist.offer');
  if (!data.isTerminal) return null;
  const message = (() => {
    if (data.status === 'pagada') return t('closedPaid');
    if (data.status === 'abandonada')
      return t('closedAbandoned', { email: SUPPORT_CONTACT_FALLBACK });
    if (data.status === 'expirada') {
      if (data.expiredReason === 'not_shipped') return t('closedNotShipped');
      if (data.expiredReason === 'no_offer') return t('closedNoOffer');
      // ⚠️ Motivo ausente ⇒ frase NEUTRA, jamás la acusatoria (§23.1d): en un desenlace ambiguo
      // el sistema no acusa al vendedor de no haber mandado nada.
      return t('noLongerActive');
    }
    // `rechazada` sin oferta que enseñar: neutra por la misma razón que arriba — el DTO no dice
    // si la rechazó él o si se le pasó el plazo.
    return t('noLongerActive');
  })();
  return (
    <div className="mt-4">
      <p className="max-w-[62ch] border-l-2 border-text pl-4 text-sm leading-[1.7] text-text">
        {message}
      </p>
      {data.status !== 'pagada' && <QuoteAgainCta />}
    </div>
  );
}

/** *«Si todavía quiere vender, cotiza de nuevo»* — terminal es terminal (criterio 145). */
function QuoteAgainCta() {
  const t = useTranslations('buylist.offer');
  return (
    <Link
      href="/buylist"
      className="mt-4 inline-block border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
    >
      {t('quoteAgainCta')}
    </Link>
  );
}
