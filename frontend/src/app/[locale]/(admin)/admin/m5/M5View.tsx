'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  getAdminBuylist,
  getAdminRejectedBuylistItems,
  receiveBuylistRequest,
  verifyBuylistRequest,
  rejectBuylistRequest,
  declineBuylistRequest,
  cancelBuylistOffer,
  decideBuylistItem,
  rejectBuylistItems,
  convertBuylistItemToInventory,
  revealBuylistClabe,
  paySpeiBuylist,
} from '@/lib/api';
import { useRole } from '@/lib/role';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { AdminBuylistDTO, SellItemDTO, SellRequestStatus } from '@/types/contract';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { BuylistDecisionDesk } from './BuylistDecisionDesk';
import { BuylistShipmentActions } from './BuylistShipmentActions';
import { BuylistCycleQueues } from './BuylistCycleQueues';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { CardImage } from '@/components/ui/CardImage';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Textarea } from '@/components/ui/Textarea';
import { asApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/ui/EmptyState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { useBuylistSteps } from '@/lib/pipelines';

/**
 * Pestañas por ETAPA de la solicitud (G3): en vez de una pila plana con las 7 acciones
 * siempre visibles, se agrupa por `status` para que el operador vea solo la cola de su
 * etapa. Cada solicitud aparece en la pestaña de su `status`. La pestaña «Piezas rechazadas»
 * (v1.18) es TRANSVERSAL: no filtra solicitudes, consume su propio endpoint paginado.
 */
// Pestañas OPERATIVAS (etapas vivas): siguen su fetch client-side sobre la página actual. Las
// pestañas TRANSVERSALES «Cerradas» (v1.25) y «Piezas rechazadas» (v1.18) son server-side paginadas.
/**
 * ⚠️ **EL EJE DE LOS RÓTULOS (DESIGN_SYSTEM §23.8a): la pestaña dice DE QUIÉN ES EL PENDIENTE.**
 *
 * M5 es una **cola de trabajo**, así que sus pestañas contestan **«¿qué me toca?»**, no «¿en qué
 * estado está el registro?». De ahí salen las dos formas, y **no hay una tercera**:
 *
 *  · **El pendiente es NUESTRO** ⇒ **«Por + verbo»**, que nombra la acción (`por_ofertar`,
 *    `por_pagar`). Normalmente hay además **un reloj corriendo en contra nuestra**.
 *  · **El pendiente NO es nuestro** ⇒ se nombra **de quién depende**, nunca la acción
 *    (`con_vendedor`). Ahí solo se **mira**.
 *
 * Los identificadores de abajo son **los mismos** que las claves i18n a propósito: un
 * discriminante que diga `por_recibir` mientras el rótulo dice «Por ofertar» reintroduce **en el
 * código** el desfase que se acaba de quitar del texto, y este mapa es justo lo que alguien lee
 * para decidir dónde vive el próximo estado nuevo.
 *
 * ⚠️ `verificando` es un gerundio y no un «Por X»: **se queda así** (§23.8ad). Describe bien el
 * trabajo real —*«está en casa y hay que revisarlo»*— y §23.6 ya usa «EN NUESTRAS MANOS» para ese
 * mismo tramo. Un barrido que cambia de más hace daño nuevo.
 */
type M5OpTab = 'por_ofertar' | 'con_vendedor' | 'verificando' | 'por_pagar';
/**
 * `piezas_rechazadas` (no `rechazadas`): esa pestaña **no contiene solicitudes**, contiene
 * **ítems** que no llegaron en NM (`GET /admin/buylist/rejected-items`). Pero `rechazada` es
 * **también** un estado de solicitud —el del vendedor que no respondió la oferta— y ése vive en
 * «Cerradas». Con el nombre a secas, quien buscaba *«las solicitudes que rechacé»* pulsaba aquí y
 * encontraba cartas: misnavegación garantizada, no hipotética (§23.8ac). **«Piezas»** y no
 * «cartas» porque cubre raw, **sellado y gradeadas**.
 */
type M5TabAll = M5OpTab | 'cerradas' | 'piezas_rechazadas';

/**
 * ⚠️ **ASIGNACIÓN TOTAL estado → pestaña. Es el candado de esta pantalla, no una tabla de
 * conveniencia.**
 *
 * El filtro de las pestañas operativas es `filtered.filter(r => activeStatuses.includes(r.status))`:
 * **un status que no esté en ninguna pestaña no sale en ninguna vista y nadie lo ve nunca.** No
 * falla, no avisa, no rompe un test — simplemente desaparece del back-office. Eso ya pasó: al
 * crecer el enum en cuatro valores (M-46), `ofertada`, `aceptada`, `en_transito` y `expirada`
 * quedaron sin casa mientras las listas de abajo seguían siendo las de tres pestañas.
 *
 * `Record<SellRequestStatus, M5TabAll>` convierte esa desaparición silenciosa en un **error de
 * compilación**: añadir un valor al enum del contrato deja de compilar esta pantalla hasta que
 * alguien decida en qué pestaña vive. Las listas de abajo se DERIVAN de aquí; no se escriben
 * dos veces.
 *
 * ⚠️ Esto NO es una copia del set terminal: es dónde se PINTA cada estado (decisión de UI). Qué
 * solicitudes admiten acciones lo dice el servidor con `isTerminal` — ver `canRejectRequest`.
 *
 * ⚠️ Se EXPORTA solo para la comprobación normativa de §23.14.6-3bis (partición total); ninguna
 * otra pantalla lo consume.
 */
export const M5_STATUS_TAB: Record<SellRequestStatus, M5TabAll> = {
  // El pendiente es NUESTRO, y con el reloj de caducidad de 7 días hábiles (D33) corriendo en
  // contra: al vencer, la solicitud caduca sola y al vendedor le llega un «no procederemos» que
  // NADIE decidió. Por eso NO se llama «Por recibir»: ese rótulo describía el modelo viejo —el
  // vendedor mandaba el paquete primero— e inducía a ESPERAR, que es literalmente la conducta
  // que hace que ese correo salga. Aquí no hay nada que recibir (§23.1a, §23.8aa).
  cotizada: 'por_ofertar',
  // v1.51 (M-46): el tramo en que el pendiente NO es nuestro. Los tres son MONITOREO desde esta
  // cola (su respuesta, su decisión de enviar, su paquete); las colas con acción propia —por
  // autorizar, por confirmar envío, guías por cancelar— son vistas aparte (§23.8).
  // ⚠️ `aceptada` NUNCA bajo un rótulo que diga «en camino»: aceptar no mueve nada (criterio 156)
  // y el único estado que significa «un paquete viaja» es `en_transito`. «Con el vendedor» no se
  // puede leer como «hay cartas llegando», que era el riesgo real.
  // ⚠️ Concesión consciente (§23.8ab): en `en_transito` el paquete lo tiene la PAQUETERÍA, no el
  // vendedor. Se acepta porque el fallo caro es el contrario —creer que hay cartas en casa cuando
  // no las hay— y porque la fila desambigua sola: la pestaña agrupa, el BADGE precisa.
  ofertada: 'con_vendedor',
  aceptada: 'con_vendedor',
  en_transito: 'con_vendedor',
  recibida: 'verificando',
  verificacion: 'verificando',
  aprobada: 'por_pagar',
  // Los CUATRO terminales viven en «Cerradas». `expirada` es el cuarto (criterio 113): sin esta
  // línea una solicitud expirada no aparecía en ninguna pestaña de M5.
  // ⚠️ Aquí es donde vive la solicitud `rechazada` — NO en «Piezas rechazadas» (§23.8ac). El
  // MOTIVO lo pinta la fila con su badge (`RECHAZADA`/`SIN ENVÍO`/`NO PROCEDIÓ`), no la pestaña.
  pagada: 'cerradas',
  rechazada: 'cerradas',
  abandonada: 'cerradas',
  expirada: 'cerradas',
};

/** Estados asignados a una pestaña dada, DERIVADOS del mapa total (nunca escritos a mano). */
function statusesForTab(tab: M5TabAll): SellRequestStatus[] {
  return (Object.keys(M5_STATUS_TAB) as SellRequestStatus[]).filter(
    (status) => M5_STATUS_TAB[status] === tab,
  );
}

// Orden de las pestañas OPERATIVAS en la barra (sigue el pipeline). Sus estados salen del mapa.
export const M5_OP_TAB_ORDER: M5OpTab[] = ['por_ofertar', 'con_vendedor', 'verificando', 'por_pagar'];
const M5_OP_TABS: { key: M5OpTab; statuses: SellRequestStatus[] }[] = M5_OP_TAB_ORDER.map(
  (key) => ({ key, statuses: statusesForTab(key) }),
);
const M5_PAGE_SIZE = 25;

/** Límites del motivo de rechazo (contrato §M5: 3–500 chars; 400 si no cumple). */
const REJECT_REASON_MIN = 3;
const REJECT_REASON_MAX = 500;

/**
 * Fase del ítem rechazado derivada de `now` vs los plazos del SERVER (contrato §M5: la
 * fase no se persiste ni se expone como campo; la deriva el front). Legacy sin fechas
 * (rechazos pre-M-22) → 'unknown'.
 */
type RejectPhase = 'return' | 'abandon' | 'expired' | 'unknown';
function rejectPhase(
  returnDeadlineAt: string | null,
  abandonDeadlineAt: string | null,
  now: number = Date.now(),
): RejectPhase {
  if (!returnDeadlineAt || !abandonDeadlineAt) return 'unknown';
  if (now <= new Date(returnDeadlineAt).getTime()) return 'return';
  if (now <= new Date(abandonDeadlineAt).getTime()) return 'abandon';
  return 'expired';
}

const PHASE_TONE: Record<RejectPhase, 'warning' | 'danger' | 'neutral'> = {
  return: 'warning',
  abandon: 'danger',
  expired: 'neutral',
  unknown: 'neutral',
};

/** Identidad visible del vendedor: nombre + correo (v1.18); cae al UUID si falta el join. */
function sellerLabel(req: Pick<AdminBuylistDTO, 'userId' | 'seller'>): string {
  return req.seller ? `${req.seller.name} · ${req.seller.email}` : req.userId;
}

/** Convierte pesos (texto) a centavos enteros; inválido/vacío → null. */
function pesosToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Estados terminales de item: ya no admiten decisión. */
const ITEM_TERMINAL = new Set(['pagada', 'convertida_inventario']);

/** Diálogo de rechazo múltiple (§60.5 c): más de 6 cartas ⇒ las 6 primeras + «y {r} más» desplegable. */
const BULK_VISIBLE = 6;

/** `receive` salió bien y `verify` no (§60.5 a): la fila queda en `recibida` con «Iniciar verificación» de respaldo. */
class VerifyStepError extends Error {
  constructor(readonly cause: unknown) {
    super('verify failed after receive');
  }
}

/**
 * ¿Esta carta se puede marcar para «Rechazar seleccionadas»? (§60.5 c · contrato v1.82 §PNL.4). En `verificacion`,
 * ⛔ nunca una `skip` (F-4: no se rechaza lo que no se compró), ni una ya rechazada, ni una terminal. El servidor
 * re-valida bajo candado (todo o nada): esto solo decide QUÉ casillas existen.
 */
export function isBulkRejectable(reqStatus: SellRequestStatus, it: SellItemDTO): boolean {
  return (
    reqStatus === 'verificacion' &&
    it.offerDecision !== 'skip' &&
    !ITEM_TERMINAL.has(it.itemStatus) &&
    it.itemStatus !== 'rechazada'
  );
}

export function M5View() {
  const t = useTranslations('admin.m5');
  const tModules = useTranslations('admin.modules'); // §37.2: h1 = rótulo del menú
  const tDesk = useTranslations('admin.m5.desk');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const te = useTranslations('error');
  const locale = useLocale() as AppLocale;
  const steps = useBuylistSteps();
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  // ⚠️ Back-office: quien lee es el OPERADOR (DESIGN_SYSTEM §26). Aquí caen `REQUEST_NOT_RECEIVED`
  // y `APPROVED_PRICE_CAP_EXCEEDED` de la mesa de verificación, que **solo** existen de este lado.
  const getError = useErrorMessage('operator');
  const tRoot = useTranslations();
  // Operativas: fetch de la página actual del server (las etapas vivas siguen filtrando en memoria).
  const query = useQuery({ queryKey: ['admin-buylist'], queryFn: () => getAdminBuylist() });

  // Feedback de la última acción, anclado a SU solicitud (éxito o mensaje real del backend).
  const [feedback, setFeedback] = useState<
    { requestId: string; kind: 'success' | 'error'; message: string } | null
  >(null);

  // CLABE revelada: SOLO estado local efímero de esta vista (nunca query-cache/estado
  // global) y solo bajo demanda — cada reveal queda auditado server-side (contrato §M5).
  /**
   * Qué solicitud tiene la MESA DE DECISIÓN abierta (§23.6). Una a la vez: la mesa es densa
   * —cinco cifras por línea sobre solicitudes de hasta 40— y dos abiertas a la vez convierten
   * la cola en el «tablero de aeropuerto» que §23.6 existe para evitar.
   */
  const [deskFor, setDeskFor] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ requestId: string; clabe: string } | null>(null);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['admin-buylist'] });
  }
  function ok(requestId: string, message: string) {
    setFeedback({ requestId, kind: 'success', message });
    refresh();
  }
  function fail(requestId: string, error: unknown) {
    setFeedback({ requestId, kind: 'error', message: getError(error) });
  }

  /**
   * §M5-S · `409 INVALID_TRANSITION`: el mensaje NO se arma aquí. Lo resuelve el catálogo
   * compartido (`error.INVALID_TRANSITION[_WITH_DETAILS]` + `DETAILED_ERRORS` en `QueryState`),
   * que es donde §26 manda que viva todo el copy de error — esta vista tenía su propia copia con
   * su propio rótulo de estado, y una copia es una cosa más que se desincroniza sin que nada falle
   * (SB-D5/I3). `getError` ya declara audiencia `operator`.
   */

  // --- Recibir / Verificar (contrato POST /admin/buylist/:id/receive|verify) ---
  // §60.5 a · §PNL.4 (REGLA GENERAL: lo más automático posible): en `en_transito` UN clic encadena `receive → verify`,
  // con un solo `loading`. Si `verify` falla tras un `receive` bueno, la fila queda en `recibida` con el «Iniciar
  // verificación» de hoy como respaldo y un aviso en la fila.
  const [verifyFailedFor, setVerifyFailedFor] = useState<string | null>(null);
  const [goVerifying, setGoVerifying] = useState(false);
  const receiveMutation = useMutation({
    mutationFn: async (id: string) => {
      await receiveBuylistRequest(id);
      try {
        await verifyBuylistRequest(id);
      } catch (e) {
        throw new VerifyStepError(e);
      }
    },
    onSuccess: (_d, id) => {
      setFeedback(null);
      setVerifyFailedFor(null);
      setPageNotice(t('receiveReview.done', { id }));
      setGoVerifying(true);
      refresh();
    },
    onError: (e, id) => {
      if (e instanceof VerifyStepError) {
        setVerifyFailedFor(id);
        refresh();
      } else fail(id, e);
    },
  });
  const verifyMutation = useMutation({
    mutationFn: (id: string) => verifyBuylistRequest(id),
    onSuccess: (_d, id) => {
      if (verifyFailedFor === id) setVerifyFailedFor(null);
      ok(id, t('feedback.verified'));
    },
    onError: (e, id) => fail(id, e),
  });

  // --- Decisión por carta (contrato PATCH /admin/buylist/items/:itemId/decision) ---
  const [adjustTarget, setAdjustTarget] = useState<{ requestId: string; item: SellItemDTO } | null>(null);
  const [adjustPrice, setAdjustPrice] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const adjustCents = pesosToCents(adjustPrice);

  // Rechazo con motivo obligatorio (v1.18): mini-diálogo antes de enviar la decisión.
  const [rejectTarget, setRejectTarget] = useState<{ requestId: string; item: SellItemDTO } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const rejectReasonTrimmed = rejectReason.trim();
  const rejectReasonValid =
    rejectReasonTrimmed.length >= REJECT_REASON_MIN && rejectReasonTrimmed.length <= REJECT_REASON_MAX;

  // --- Rechazo de VARIAS cartas con un motivo y UN correo (§60.5 c · contrato v1.82 §PNL.4) ---
  const [bulkSelected, setBulkSelected] = useState<Record<string, string[]>>({});
  const [bulkTarget, setBulkTarget] = useState<{ requestId: string; itemIds: string[] } | null>(null);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkReasonError, setBulkReasonError] = useState<string | null>(null);
  /** Cartas que el servidor dijo NO COMPRADAS en un `422 ITEM_NOT_OFFERED` (se marcan en su fila). */
  const [notOfferedIds, setNotOfferedIds] = useState<Set<string>>(new Set());
  const bulkReasonTrimmed = bulkReason.trim();
  const bulkReasonValid = bulkReasonTrimmed.length >= REJECT_REASON_MIN && bulkReasonTrimmed.length <= REJECT_REASON_MAX;
  const bulkReasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (bulkTarget) setTimeout(() => bulkReasonRef.current?.focus(), 0);
  }, [bulkTarget]);

  function setSelectedFor(requestId: string, ids: string[]) {
    setBulkSelected((cur) => ({ ...cur, [requestId]: ids }));
  }
  function dropFromSelection(requestId: string, ids: readonly string[]) {
    setBulkSelected((cur) => ({ ...cur, [requestId]: (cur[requestId] ?? []).filter((x) => !ids.includes(x)) }));
  }
  function openBulk(requestId: string, itemIds: string[]) {
    setBulkTarget({ requestId, itemIds });
    setBulkReason('');
    setBulkError(null);
    setBulkReasonError(null);
  }
  function closeBulk() {
    setBulkTarget(null);
    setBulkReason('');
    setBulkError(null);
    setBulkReasonError(null);
  }
  const bulkMutation = useMutation({
    mutationFn: (vars: { requestId: string; itemIds: string[]; reason: string }) =>
      rejectBuylistItems(vars.requestId, { itemIds: vars.itemIds, reason: vars.reason }),
    onSuccess: async (_d, vars) => {
      const k = vars.itemIds.length;
      closeBulk();
      setSelectedFor(vars.requestId, []);
      void qc.invalidateQueries({ queryKey: ['admin-buylist-rejected'] });
      void qc.invalidateQueries({ queryKey: ['admin-buylist-closed'] });
      // ⛔ La pantalla NO predice «se cerrará»: lo dice la solicitud RECARGADA (regla de auto-transición del servidor).
      await qc.invalidateQueries({ queryKey: ['admin-buylist'] });
      const fresh = qc.getQueryData<{ data: AdminBuylistDTO[] }>(['admin-buylist'])?.data.find((r) => r.id === vars.requestId);
      if (fresh?.status === 'rechazada') {
        setFeedback(null);
        setGoVerifying(false);
        setPageNotice(`${t('bulkReject.done', { k })} ${t('bulkReject.closed')}`);
      } else setFeedback({ requestId: vars.requestId, kind: 'success', message: t('bulkReject.done', { k }) });
    },
    onError: (e, vars) => {
      const err = asApiError(e);
      const ids = Array.isArray(err?.details?.itemIds) ? (err!.details!.itemIds as unknown[]).filter((x): x is string => typeof x === 'string') : null;
      if (err?.status === 422 && err.code === 'ITEM_NOT_OFFERED' && ids) {
        setNotOfferedIds((cur) => new Set([...cur, ...ids]));
        dropFromSelection(vars.requestId, ids);
        setBulkTarget((cur) => (cur ? { ...cur, itemIds: cur.itemIds.filter((x) => !ids.includes(x)) } : cur));
        setBulkError(t('bulkReject.error.notOffered', { n: ids.length }));
        return;
      }
      if (err?.status === 409 && err.code === 'CONFLICT') {
        refresh();
        if (ids) {
          dropFromSelection(vars.requestId, ids);
          setBulkTarget((cur) => (cur ? { ...cur, itemIds: cur.itemIds.filter((x) => !ids.includes(x)) } : cur));
          setBulkError(t('bulkReject.error.conflictItems', { n: ids.length }));
        } else setBulkError(t('bulkReject.error.closed'));
        return;
      }
      if (err?.status === 404) {
        refresh();
        setBulkError(t('bulkReject.error.notFound'));
        return;
      }
      if (err?.status === 400 && err.code === 'VALIDATION_ERROR' && err.details?.field !== 'itemIds') {
        setBulkReasonError(t('rejectReasonInvalid'));
        return;
      }
      setBulkError(getError(e));
    },
  });

  const decisionMutation = useMutation({
    mutationFn: (vars: {
      requestId: string;
      itemId: string;
      decision: 'approve' | 'adjust' | 'reject';
      approvedPriceCents?: number;
      reason?: string;
    }) =>
      decideBuylistItem(
        vars.itemId,
        vars.decision === 'reject'
          ? { decision: 'reject', reason: vars.reason }
          : { decision: vars.decision, approvedPriceCents: vars.approvedPriceCents },
      ),
    onSuccess: (_d, vars) => {
      if (vars.decision === 'adjust') closeAdjust();
      if (vars.decision === 'reject') {
        closeReject();
        // La carta rechazada aparece en la pestaña transversal «Piezas rechazadas».
        void qc.invalidateQueries({ queryKey: ['admin-buylist-rejected'] });
      }
      ok(
        vars.requestId,
        vars.decision === 'approve'
          ? t('feedback.approved')
          : vars.decision === 'adjust'
            ? t('feedback.adjusted')
            : t('feedback.rejected'),
      );
    },
    onError: (e, vars) => {
      // El ajuste/rechazo muestran el error DENTRO de su modal (p. ej. 422
      // APPROVED_PRICE_CAP_EXCEEDED o el 400 VALIDATION_ERROR del motivo).
      if (vars.decision === 'adjust') setAdjustError(getError(e));
      else if (vars.decision === 'reject') setRejectError(getError(e));
      else fail(vars.requestId, e);
    },
  });

  function openAdjust(requestId: string, item: SellItemDTO) {
    setAdjustTarget({ requestId, item });
    setAdjustPrice(item.quotedPriceCents != null ? String(item.quotedPriceCents / 100) : '');
    setAdjustError(null);
  }
  function closeAdjust() {
    setAdjustTarget(null);
    setAdjustPrice('');
    setAdjustError(null);
  }

  function openReject(requestId: string, item: SellItemDTO) {
    setRejectTarget({ requestId, item });
    setRejectReason('');
    setRejectError(null);
  }
  function closeReject() {
    setRejectTarget(null);
    setRejectReason('');
    setRejectError(null);
  }

  // --- Cierre explícito de la solicitud (contrato §M5 · POST /admin/buylist/:id/reject, v1.24) ---
  // Cierra a `rechazada` una solicitud atorada cuyos ítems YA están todos rechazados (bug P-4).
  // Confirmación destructiva en modal (DESIGN_SYSTEM §7.6: «rechazar buylist»); `reason` opcional.
  const [rejectRequestTarget, setRejectRequestTarget] = useState<AdminBuylistDTO | null>(null);
  const [rejectRequestReason, setRejectRequestReason] = useState('');
  const [rejectRequestError, setRejectRequestError] = useState<string | null>(null);
  const rejectRequestMutation = useMutation({
    mutationFn: (vars: { requestId: string; reason?: string }) =>
      rejectBuylistRequest(vars.requestId, { reason: vars.reason }),
    onSuccess: (_d, vars) => {
      closeRejectRequest();
      // Tras cerrar, la solicitud cae en la pestaña «Cerradas» (status `rechazada`).
      ok(vars.requestId, t('feedback.requestRejected'));
    },
    // El 422 REQUEST_HAS_NON_REJECTED_ITEMS (quedan ítems vivos) se muestra DENTRO del modal.
    onError: (e) => setRejectRequestError(getError(e)),
  });
  function openRejectRequest(req: AdminBuylistDTO) {
    setRejectRequestTarget(req);
    setRejectRequestReason('');
    setRejectRequestError(null);
  }
  function closeRejectRequest() {
    setRejectRequestTarget(null);
    setRejectRequestReason('');
    setRejectRequestError(null);
  }

  // --- «Declinar ahora» (D39 · POST /admin/buylist/:id/decline) y «Cancelar la oferta» (POST …/offer/cancel) ---
  // DESIGN_SYSTEM §25.8: acción `secondary` de la ficha `cotizada`, con confirmación §7.6 porque es TERMINAL y
  // manda el correo 4. Los dos roles (el operador ya tenía este poder por omisión: dejarla caducar). El motivo es
  // INTERNO (0–500, bitácora) y ⛔ nunca llega al vendedor. «Cancelar la oferta» es la puerta de una `ofertada`
  // (contrato, tabla «Qué ofrece M5 en cada estado»): una `ofertada` NO se declina — primero se cancela.
  const [closeAction, setCloseAction] = useState<{ kind: 'decline' | 'cancelOffer'; requestId: string } | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);
  /** Aviso a nivel de página: tras declinar, la solicitud SALE de su pestaña y su ficha ya no está para anclarlo. */
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const closeReasonTooLong = closeReason.trim().length > REJECT_REASON_MAX;
  const closeMutation = useMutation({
    mutationFn: (vars: { kind: 'decline' | 'cancelOffer'; requestId: string; reason: string }) =>
      vars.kind === 'decline'
        ? declineBuylistRequest(vars.requestId, { reason: vars.reason })
        : cancelBuylistOffer(vars.requestId, { reason: vars.reason }),
    onSuccess: (_d, vars) => {
      closeCloseAction();
      void qc.invalidateQueries({ queryKey: ['admin-buylist'] });
      void qc.invalidateQueries({ queryKey: ['admin-buylist-closed'] });
      // Declinar anula la oferta `pending_authorization` viva; las dos cambian «vendedores con solicitudes vivas».
      void qc.invalidateQueries({ queryKey: ['buylist-pending-auth'] });
      void qc.invalidateQueries({ queryKey: ['buylist-live-sellers'] });
      setFeedback(null);
      setGoVerifying(false);
      setPageNotice(
        vars.kind === 'decline'
          ? tDesk('decline.done', { id: vars.requestId })
          : tDesk('cancelOffer.done', { id: vars.requestId }),
      );
      if (deskFor === vars.requestId) setDeskFor(null);
    },
    // `409 DECLINE_NOT_ALLOWED` / `409 OFFER_NOT_CANCELLABLE`: dentro del diálogo, con su copy de `error.*`.
    onError: (e) => setCloseError(getError(e)),
  });
  function openCloseAction(kind: 'decline' | 'cancelOffer', requestId: string) {
    setCloseAction({ kind, requestId });
    setCloseReason('');
    setCloseError(null);
  }
  function closeCloseAction() {
    setCloseAction(null);
    setCloseReason('');
    setCloseError(null);
  }

  // --- Conversión a inventario (contrato POST .../convert-to-inventory) ---
  const convertMutation = useMutation({
    mutationFn: (vars: { requestId: string; itemId: string }) =>
      convertBuylistItemToInventory(vars.itemId),
    onSuccess: (d, vars) => {
      // IMP-B: la conversión puede dispararse desde la pestaña «Cerradas» (solicitud
      // pagada, ítem `aprobada`) → invalida también esa query para que el ítem se
      // repinte como `convertida_inventario` sin recargar la página.
      void qc.invalidateQueries({ queryKey: ['admin-buylist-closed'] });
      ok(
        vars.requestId,
        d.alreadyConverted
          ? t('feedback.alreadyConverted')
          : t('feedback.converted', { folio: d.folio ?? d.inventoryItemId ?? '' }),
      );
    },
    onError: (e, vars) => fail(vars.requestId, e),
  });

  // --- Reveal de CLABE (contrato GET .../reveal-clabe · super_admin, auditado) ---
  // Mutation (no query): la CLABE en claro no debe quedar en el cache de react-query.
  const revealMutation = useMutation({
    mutationFn: (id: string) => revealBuylistClabe(id),
    onSuccess: (d, id) => {
      setRevealed({ requestId: id, clabe: d.clabe });
      setFeedback(null);
    },
    onError: (e, id) => fail(id, e),
  });

  // --- Pago SPEI (contrato POST .../pay-spei · super_admin, money-out) ---
  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [speiReference, setSpeiReference] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const payMutation = useMutation({
    mutationFn: (vars: { requestId: string; speiReference: string }) =>
      paySpeiBuylist(vars.requestId, vars.speiReference),
    onSuccess: (_d, vars) => {
      closePay();
      // Higiene: al registrar el pago se descarta cualquier CLABE revelada en pantalla.
      setRevealed(null);
      ok(vars.requestId, t('feedback.paid'));
    },
    onError: (e) => setPayError(getError(e)),
  });
  function openPay(requestId: string) {
    setPayTarget(requestId);
    setSpeiReference('');
    setPayError(null);
  }
  function closePay() {
    setPayTarget(null);
    setSpeiReference('');
    setPayError(null);
  }

  // --- Pestañas por etapa + buscador (folio/vendedor) ---
  const [tab, setTab] = useState<M5TabAll | null>(null);
  const [search, setSearch] = useState('');
  const all = query.data?.data ?? [];
  const searchTerm = search.trim().toLowerCase();
  // Buscador global por folio o vendedor —id, nombre o correo— (clave i18n `admin.searchGlobal`).
  // En las pestañas OPERATIVAS filtra client-side; en «Cerradas» alimenta el `q` server-side.
  const filtered =
    searchTerm === ''
      ? all
      : all.filter(
          (r) =>
            r.id.toLowerCase().includes(searchTerm) ||
            r.userId.toLowerCase().includes(searchTerm) ||
            (r.seller?.name.toLowerCase().includes(searchTerm) ?? false) ||
            (r.seller?.email.toLowerCase().includes(searchTerm) ?? false),
        );
  const counts = Object.fromEntries(
    M5_OP_TABS.map((tb) => [tb.key, filtered.filter((r) => tb.statuses.includes(r.status)).length]),
  ) as Record<M5OpTab, number>;
  // Etapa activa: la elegida por el operador o, por defecto, la primera con solicitudes.
  const firstNonEmpty = M5_OP_TABS.find((tb) => counts[tb.key] > 0)?.key ?? M5_OP_TABS[0].key;
  const activeTab: M5TabAll = tab ?? firstNonEmpty;
  const activeStatuses = M5_OP_TABS.find((tb) => tb.key === activeTab)?.statuses ?? [];
  const visible = filtered.filter((r) => activeStatuses.includes(r.status));

  // --- Pestaña «Cerradas» (v1.25-buylist-orders-pagination · GET /admin/buylist server-side) ---
  // Query dedicada y paginada (mismo patrón que «Piezas rechazadas»): pide `status` CSV + filtros
  // (fecha/monto) + `q` (del buscador global). Solo se pide al abrir la pestaña.
  const [closedPage, setClosedPage] = useState(1);
  const [closedFrom, setClosedFrom] = useState('');
  const [closedTo, setClosedTo] = useState('');
  const [closedMinPesos, setClosedMinPesos] = useState('');
  const [closedMaxPesos, setClosedMaxPesos] = useState('');
  // Debounce (P-5): el filtrado client-side de las pestañas OPERATIVAS sigue usando el `search`
  // inmediato (arriba), pero lo que alimenta la RED de «Cerradas» (buscador global + montos) sólo
  // entra por su VALOR DEBOUNCED, para no disparar un fetch por pulsación. Las fechas no se debouncean.
  const debouncedClosedSearch = useDebouncedValue(search);
  const debouncedClosedMinPesos = useDebouncedValue(closedMinPesos);
  const debouncedClosedMaxPesos = useDebouncedValue(closedMaxPesos);
  const closedMinCents = pesosToCents(debouncedClosedMinPesos);
  const closedMaxCents = pesosToCents(debouncedClosedMaxPesos);
  // El buscador global alimenta `q` server-side cuando la pestaña activa es «Cerradas».
  const closedQ = debouncedClosedSearch.trim() === '' ? undefined : debouncedClosedSearch.trim();
  const closedFilters = {
    // ⚠️ v1.51.8 (BL-18) — **`live: false`, NO un CSV que enumere los cuatro terminales.**
    // Aquí sobrevivía la última copia de esa enumeración en el cliente, después de haberla
    // retirado de los otros cinco sitios. El servidor filtra **por exclusión** sobre su propio set
    // terminal (criterio 129), así que **un terminal nuevo entra a esta pestaña solo**: sin tocar
    // este archivo, sin tocar el endpoint y sin que nadie tenga que acordarse.
    live: false,
    page: closedPage,
    pageSize: M5_PAGE_SIZE,
    q: closedQ,
    from: closedFrom || undefined,
    to: closedTo || undefined,
    minCents: closedMinCents ?? undefined,
    maxCents: closedMaxCents ?? undefined,
  };
  const closedQuery = useQuery({
    queryKey: [
      'admin-buylist-closed',
      closedPage,
      closedQ ?? '',
      closedFrom,
      closedTo,
      closedMinCents ?? '',
      closedMaxCents ?? '',
    ],
    queryFn: () => getAdminBuylist(closedFilters),
    enabled: activeTab === 'cerradas',
  });
  const closedTotalPages =
    closedQuery.data && closedQuery.data.pageSize > 0
      ? Math.max(1, Math.ceil(closedQuery.data.total / closedQuery.data.pageSize))
      : 1;
  // Cualquier cambio de filtro vuelve a la página 1 (evita quedar en una página inexistente).
  function resetClosedPage() {
    setClosedPage(1);
  }

  // --- Pestaña «Piezas rechazadas» (contrato §M5 · GET /admin/buylist/rejected-items) ---
  // Query aparte (transversal a solicitudes), paginada server-side; solo se pide al abrirla.
  const [rejectedPage, setRejectedPage] = useState(1);
  const rejectedQuery = useQuery({
    queryKey: ['admin-buylist-rejected', rejectedPage],
    queryFn: () => getAdminRejectedBuylistItems({ page: rejectedPage }),
    enabled: activeTab === 'piezas_rechazadas',
  });
  const rejectedTotalPages =
    rejectedQuery.data && rejectedQuery.data.pageSize > 0
      ? Math.max(1, Math.ceil(rejectedQuery.data.total / rejectedQuery.data.pageSize))
      : 1;

  /** Salta desde una fila rechazada a su solicitud (folio al buscador, etapa automática). */
  function jumpToRequest(sellRequestId: string) {
    setSearch(sellRequestId);
    setTab(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{tModules('m5')}</h1>
      <p className="text-sm text-muted">{t('cherryPick')}</p>
      {pageNotice && (
        <div data-testid="m5-page-notice">
          <Banner variant="success" role="status">
            {pageNotice}
            {goVerifying && (
              <>
                {' '}
                <button
                  type="button"
                  className="underline underline-offset-4 hover:text-accent"
                  onClick={() => {
                    setTab('verificando');
                    setGoVerifying(false);
                  }}
                >
                  {t('receiveReview.goVerifying')}
                </button>
              </>
            )}
          </Banner>
        </div>
      )}

      {/* Buscador por folio/usuario (clave i18n admin.searchGlobal) */}
      <div className="max-w-sm">
        <Input
          label={t('searchLabel')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tm('searchGlobal')}
        />
      </div>

      {/* Las CUATRO colas del ciclo (§23.8). Son vistas con ACCIÓN PROPIA y por eso viven fuera de
          las pestañas de etapa: éstas particionan `SellRequestStatus`, aquéllas contestan un
          pendiente NUESTRO que, si nadie mira, cuesta dinero o cuesta una venta. */}
      <BuylistCycleQueues isSuperAdmin={isSuperAdmin} />

      {/* Pestañas por etapa: cada operativa muestra el conteo de solicitudes en esa etapa.
          «Cerradas» (v1.25) y «Piezas rechazadas» (v1.18) son transversales, server-side paginadas; su
          conteo es el `total` del query dedicado (solo tras cargar). */}
      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-1 border-b border-border">
        {M5_OP_TABS.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            type="button"
            aria-selected={activeTab === tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              '-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:shadow-focus focus-visible:outline-none',
              activeTab === tb.key ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
            )}
          >
            {t(`tabs.${tb.key}`)}
            <span className="tabular text-xs text-muted">{counts[tb.key]}</span>
          </button>
        ))}
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'cerradas'}
          onClick={() => setTab('cerradas')}
          className={cn(
            '-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:shadow-focus focus-visible:outline-none',
            activeTab === 'cerradas' ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
          )}
        >
          {t('tabs.cerradas')}
          {closedQuery.data && (
            <span className="tabular text-xs text-muted">{closedQuery.data.total}</span>
          )}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'piezas_rechazadas'}
          onClick={() => setTab('piezas_rechazadas')}
          className={cn(
            '-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:shadow-focus focus-visible:outline-none',
            activeTab === 'piezas_rechazadas' ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
          )}
        >
          {t('tabs.piezas_rechazadas')}
          {rejectedQuery.data && (
            <span className="tabular text-xs text-muted">{rejectedQuery.data.total}</span>
          )}
        </button>
      </div>

      {activeTab === 'piezas_rechazadas' ? (
        <QueryState
          isLoading={rejectedQuery.isLoading}
          isError={rejectedQuery.isError}
          error={rejectedQuery.error}
          onRetry={() => rejectedQuery.refetch()}
        >
          {rejectedQuery.data && (
            <div className="flex flex-col gap-4">
              {/* PROJECT criterio 16 / contrato §M5: una carta rechazada (no-NM) JAMÁS se
                  convierte a inventario vendible → esta pestaña no ofrece esa acción. */}
              <p className="text-xs text-muted">{t('rejected.intro')}</p>
              {rejectedQuery.data.data.length === 0 ? (
                <EmptyState title={t('rejected.empty')} />
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4">
                  {rejectedQuery.data.data.map((row) => {
                    const phase = rejectPhase(row.returnDeadlineAt, row.abandonDeadlineAt);
                    return (
                      <div key={row.id} className="flex flex-col gap-2 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <CardImage src={row.card.imageSmallUrl} alt={row.card.name} className="w-10 shrink-0" />
                          <span className="text-sm font-medium" lang="en">
                            {row.card.name}
                          </span>
                          <span className="text-xs text-muted" lang="en">
                            {row.card.setName} · #{row.card.number}
                          </span>
                          <FinishBadge finish={row.finish} productType={row.productType} />
                          {/* La cotización original NO se paga: fuera del total (tachada). */}
                          {row.quotedPriceCents != null && (
                            <span className="tabular text-xs text-muted line-through">
                              {formatMoneyCents(row.quotedPriceCents, locale)}
                            </span>
                          )}
                          <Badge tone={PHASE_TONE[phase]} shape="outline">
                            {t(`rejected.phase.${phase}`)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                          {/* Vendedor legible (nombre + correo); UUID relegado al tooltip. */}
                          <Link
                            href={{ pathname: '/admin/m6', query: { user: row.seller?.id ?? '' } }}
                            title={row.seller?.id}
                            aria-label={t('sellerLink', { id: row.seller?.name ?? row.seller?.id ?? '' })}
                            className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            {t('seller')}: {row.seller ? `${row.seller.name} · ${row.seller.email}` : '—'}
                          </Link>
                          <span>
                            {t('rejected.rejectedAtLabel')}:{' '}
                            <span className="tabular">{row.rejectedAt ? formatDate(row.rejectedAt, locale) : '—'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => jumpToRequest(row.sellRequestId)}
                            className="tabular underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            {t('rejected.viewRequest', { id: row.sellRequestId })}
                          </button>
                        </div>
                        {row.reason && (
                          <p className="text-sm">
                            <span className="text-muted">{t('rejected.reasonLabel')}:</span> {row.reason}
                          </p>
                        )}
                        {/* Plazos del server (7d devolución a costo del usuario / 30d abandono). */}
                        {row.returnDeadlineAt && row.abandonDeadlineAt ? (
                          <p className="text-xs text-muted">
                            {t('rejected.returnUntil', { date: formatDate(row.returnDeadlineAt, locale) })}
                            {' · '}
                            {t('rejected.abandonAt', { date: formatDate(row.abandonDeadlineAt, locale) })}
                          </p>
                        ) : (
                          <p className="text-xs text-muted">{t('rejected.noDeadlines')}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Paginación simple server-side (page/pageSize/total del contrato). */}
              {rejectedTotalPages > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rejectedPage <= 1}
                    onClick={() => setRejectedPage((p) => Math.max(1, p - 1))}
                  >
                    {t('rejected.prev')}
                  </Button>
                  <span className="tabular text-xs text-muted">
                    {t('rejected.pageInfo', { page: rejectedQuery.data.page, totalPages: rejectedTotalPages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rejectedPage >= rejectedTotalPages}
                    onClick={() => setRejectedPage((p) => p + 1)}
                  >
                    {t('rejected.next')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </QueryState>
      ) : activeTab === 'cerradas' ? (
        <div className="flex flex-col gap-4">
          {/* Filtros server-side de «Cerradas» (v1.25). El buscador global de arriba alimenta `q`. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input
                label={t('filters.dateFrom')}
                type="date"
                value={closedFrom}
                onChange={(e) => {
                  setClosedFrom(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
            <div className="w-40">
              <Input
                label={t('filters.dateTo')}
                type="date"
                value={closedTo}
                onChange={(e) => {
                  setClosedTo(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
            <div className="w-32">
              <Input
                label={t('filters.minAmount')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                value={closedMinPesos}
                onChange={(e) => {
                  setClosedMinPesos(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
            <div className="w-32">
              <Input
                label={t('filters.maxAmount')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                value={closedMaxPesos}
                onChange={(e) => {
                  setClosedMaxPesos(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
          </div>

          <QueryState
            isLoading={closedQuery.isLoading}
            isError={closedQuery.isError}
            error={closedQuery.error}
            onRetry={() => closedQuery.refetch()}
          >
            {closedQuery.data &&
              (closedQuery.data.data.length === 0 ? (
                <EmptyState title={t('closed.empty')} />
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4">
                  {closedQuery.data.data.map((req) => (
                    <div key={req.id} data-testid={`m5-closed-${req.id}`} className="flex flex-col gap-2 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-sm font-medium">{req.id}</span>
                          {/* §23.1d: `expirada` se pinta por su MOTIVO, no por su estado — una
                              `no_offer` es culpa NUESTRA y no puede salir en rojo acusatorio. */}
                          <StatusBadge
                            domain="sellRequest"
                            value={req.status}
                            reason={req.expiredReason}
                          />
                          <Link
                            href={{ pathname: '/admin/m6', query: { user: req.userId } }}
                            title={req.userId}
                            aria-label={t('sellerLink', { id: req.seller?.name ?? req.userId })}
                            className="text-xs text-muted underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            {t('seller')}: {sellerLabel(req)}
                          </Link>
                          <span className="tabular text-xs text-muted">
                            {t('created')}: {formatDate(req.createdAt, locale)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="tabular text-sm">
                            {t('quoted')}: {formatMoneyCents(req.quotedTotalCents, locale)}
                          </span>
                          {req.approvedTotalCents != null && (
                            <span className="tabular text-sm text-success">
                              {t('approvedTotal')}: {formatMoneyCents(req.approvedTotalCents, locale)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Resumen de los ítems. IMP-B: la solicitud cerrada/pagada es terminal a
                          NIVEL SOLICITUD, pero un ítem `aprobada` y NO convertido sigue siendo
                          convertible a inventario (el guard del backend mira el `itemStatus`, no el
                          estado de la solicitud: `convert-to-inventory` exige solo `aprobada`). El
                          orden natural pagar→convertir dejaba la carta atorada al desaparecer el
                          botón. Se ofrece la acción por-ítem cuando el backend aún la permite. */}
                      <div className="flex flex-col gap-1">
                        {req.items.map((it) => {
                          const stillConvertible = it.itemStatus === 'aprobada';
                          const convertPending =
                            convertMutation.isPending && convertMutation.variables?.itemId === it.id;
                          return (
                            <div key={it.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span className="font-medium text-text" lang="en">
                                {it.card.name}
                              </span>
                              <FinishBadge finish={it.finish} productType={it.productType} />
                              <StatusBadge domain="sellItem" value={it.itemStatus} />
                              <span
                                className={cn(
                                  'tabular',
                                  it.itemStatus === 'rechazada' && 'line-through',
                                )}
                              >
                                {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                              </span>
                              {it.approvedPriceCents != null && (
                                <span className="tabular text-success">
                                  {t('approvedLabel')}: {formatMoneyCents(it.approvedPriceCents, locale)}
                                </span>
                              )}
                              {stillConvertible && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  loading={convertPending}
                                  onClick={() => convertMutation.mutate({ requestId: req.id, itemId: it.id })}
                                >
                                  {t('convert')}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            {/* Paginación server-side (page/pageSize/total del contrato v1.25). */}
            {closedQuery.data && closedTotalPages > 1 && (
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={closedPage <= 1}
                  onClick={() => setClosedPage((p) => Math.max(1, p - 1))}
                >
                  {t('closed.prev')}
                </Button>
                <span className="tabular text-xs text-muted">
                  {t('closed.pageInfo', { page: closedQuery.data.page, totalPages: closedTotalPages })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={closedPage >= closedTotalPages}
                  onClick={() => setClosedPage((p) => p + 1)}
                >
                  {t('closed.next')}
                </Button>
              </div>
            )}
          </QueryState>
        </div>
      ) : (
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (visible.length === 0 ? (
            <EmptyState title={searchTerm !== '' ? t('emptySearch') : t('emptyTab')} />
          ) : (
            visible.map((req) => {
          // ⚠️ **DINERO SALIENTE.** Aquí vivía la SEXTA copia: `SELL_REQUEST_PAYABLE_STATES`
          // transcrito a mano —y **con uno solo de los términos** del servidor—, así que la
          // pantalla habilitaba el pago en filas donde el servidor responde 422. No era una copia
          // que pudiera desincronizarse algún día: **ya lo estaba.** Ahora lo deriva el servidor
          // (`isPayable`, §4.39c sitio 10) del MISMO cuerpo que el pre-check y la guarda atómica de
          // `pay-spei`: tres lectores, una regla.
          //
          // ⚠️ **Y la prueba de que la forma es la correcta la dieron v1.57 Y v1.61:** la fórmula
          // ganó `receivedAt IS NOT NULL` (§M5-P — *«no se paga lo que no ha llegado»*) y después
          // `approvedTotalCents IS NOT NULL` + V-b (§M5-V — *«ni lo que no se ha juzgado»*), y
          // **esta línea no se tocó ninguna de las dos veces**. Una copia local habría tenido que
          // enterarse; ésta no tiene de qué enterarse. ⛔ Por eso tampoco se escribe aquí cuántos
          // términos son ni cuál va primero: esa cuenta vive en §M5-V.0 —y la vigila
          // `payability-contract.test.ts`—, y es exactamente la que ya caducó en dos comentarios.
          //
          // ⚠️ El ROL se queda aquí y NO se funde en el campo: «¿esta solicitud está en condición
          // de pagarse?» es propiedad de LA FILA; «¿puedo pagarla yo?» es propiedad DEL ACTOR.
          // Un check de permiso en el cliente es affordance; un check de máquina de estados es una
          // regla duplicada — solo la segunda se cura. El servidor impone el rol igual con
          // `MoneyOutGuard`: `isPayable: true` NO autoriza un pago.
          //
          // `=== true` por lo mismo que `isTerminal === false`, y con más razón: si el campo
          // faltara, el botón que sobra es un **botón de pago**.
          const canPay = isSuperAdmin && req.isPayable === true;
          // ⚠️ **POR QUÉ el botón está apagado** (contrato §M5-V.5, v1.61). `isPayable` dice *si*
          // se puede pagar; este número dice **qué falta y a dónde ir** — sin él, el súper-admin
          // se queda delante de un control muerto sin explicación, que es la mitad del defecto que
          // §M5-P llamó ALTA («un control que desinforma al que autoriza el dinero»).
          //
          // ⛔ **NO se cuenta aquí**, aunque `req.items` esté a mano: el set de estados «sin
          // veredicto» ES la regla, y transcribirlo sería la SÉPTIMA copia de un set de estados en
          // un flujo de dinero — exactamente lo que `isTerminal` e `isPayable` vinieron a borrar.
          // Y llevaría **dos** reglas, no una: la lista de estados **y** el filtro `offerDecision
          // = 'buy'` (las `skip` no cuentan). *La segunda es justo la que un lector se salta.*
          //
          // `?? 0` porque el campo es ADITIVO (backend primero, frontend después): contra un
          // backend anterior a v1.61 no se pinta nada, en vez de «faltan undefined cartas».
          // El copy es NORMATIVO (DESIGN_SYSTEM §27.1.4, «la cadena preventiva del botón
          // apagado»); la clave es de frontend. Se muestra ⇔ `pendingDecisionItemCount > 0`.
          const pendingDecisions = req.pendingDecisionItemCount ?? 0;
          const pendingDecisionsNote =
            pendingDecisions > 0 ? t('pay.pendingDecisions', { count: pendingDecisions }) : undefined;
          // §27.1.4: *«un botón apagado sin motivo visible es un callejón»* — el motivo se pinta
          // debajo y el botón lo REFERENCIA, para que el lector de pantalla lo anuncie con él.
          const pendingDecisionsId = `pay-pending-${req.id}`;
          // Solo se muestran las acciones de la ETAPA actual de la solicitud:
          //  - decidir carta (aprobar/ajustar/rechazar) solo tras recibir/verificar;
          //  - revelar CLABE / pagar SPEI solo en verificación o por-pagar.
          const canDecide = req.status === 'recibida' || req.status === 'verificacion';
          const showMoneyOut = req.status === 'verificacion' || req.status === 'aprobada';
          // «Rechazar solicitud» (v1.24): cierre explícito del hueco de estado (bug P-4). El
          // endpoint SÓLO cierra si TODOS los ítems ya están `rechazada`; para no ofrecer un
          // botón que siempre daría 422, se muestra exactamente en esa precondición y nunca
          // sobre una solicitud ya terminal.
          const allItemsRejected =
            req.items.length > 0 && req.items.every((it) => it.itemStatus === 'rechazada');
          // ⚠️ `isTerminal` lo DERIVA EL SERVIDOR (contrato §M5 · v1.51, ARCHITECTURE §4.39c
          // sitio 9). Aquí vivía `REQUEST_TERMINAL`, la QUINTA copia del set terminal y la única
          // fuera del backend: escrita a mano con TRES estados, se quedó corta cuando el enum
          // creció a CUATRO, y sobre una solicitud `expirada` ofrecía un botón que el servidor
          // contesta con 409. Se borró y NO se sustituyó por otra constante de frontend: la copia
          // se cura eliminando la NECESIDAD de la copia, no moviéndola de archivo.
          //
          // `=== false` y no `!req.isTerminal` a propósito: si el campo faltara (backend anterior
          // a v1.51), fallar hacia «no ofrecer la acción» deja al operador sin un botón; fallar al
          // revés le ofrece un cierre que el servidor rechaza. Fail-closed, como todo lo que toca
          // el cierre de una solicitud.
          const canRejectRequest = req.isTerminal === false && allItemsRejected;
          return (
            <div key={req.id} data-testid={`m5-request-${req.id}`} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-sm font-medium">{req.id}</span>
                  <StatusBadge domain="sellRequest" value={req.status} reason={req.expiredReason} />
                  {/* Vendedor legible (v1.18: seller.name + seller.email del server); el UUID
                      queda en el tooltip. Sigue enlazando a su ficha 360° en M6 (?user=<id>). */}
                  <Link
                    href={{ pathname: '/admin/m6', query: { user: req.userId } }}
                    title={req.userId}
                    aria-label={t('sellerLink', { id: req.seller?.name ?? req.userId })}
                    className="text-xs text-muted underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t('seller')}: {sellerLabel(req)}
                  </Link>
                  {/* Fecha de creación (orden createdAt desc lo aplica el server; no se re-ordena). */}
                  <span className="tabular text-xs text-muted">
                    {t('created')}: {formatDate(req.createdAt, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="tabular text-sm">
                    {t('quoted')}: {formatMoneyCents(req.quotedTotalCents, locale)}
                  </span>
                  {/* Total aprobado RECOMPUTADO por el backend (excluye rechazadas, SEC-A1:
                      la UI nunca suma dinero por su cuenta). */}
                  {req.approvedTotalCents != null && (
                    <span className="tabular text-sm text-success">
                      {t('approvedTotal')}: {formatMoneyCents(req.approvedTotalCents, locale)}
                    </span>
                  )}
                </div>
              </div>

              <PipelineStepper steps={steps} current={req.status} />

              {/* Acciones a nivel solicitud: recepción física, verificación y cierre explícito */}
              <div className="flex flex-wrap gap-2">
                {/* §23.6 · la MESA DE DECISIÓN es la acción principal de una `cotizada`: es
                    donde se decide QUÉ comprar y a cuánto, viendo cuántas copias ya tenemos y
                    cuántas vienen en camino. Va antes que «Recibir» porque bajo el ciclo de
                    oferta una `cotizada` ya no salta a `recibida`: pasa por `ofertada`. */}
                {req.status === 'cotizada' && (
                  <Button
                    size="sm"
                    variant={deskFor === req.id ? 'ghost' : 'primary'}
                    onClick={() => setDeskFor(deskFor === req.id ? null : req.id)}
                  >
                    {deskFor === req.id ? tDesk('close') : tDesk('open')}
                  </Button>
                )}
                {/* §25.8 «Declinar ahora» (D39): `secondary`, no `destructive` — no destruimos nada del
                    cliente, le contestamos. Solo `cotizada` abierta (`isTerminal` del SERVIDOR, fail-closed). */}
                {req.status === 'cotizada' && req.isTerminal === false && (
                  <Button size="sm" variant="secondary" onClick={() => openCloseAction('decline', req.id)}>
                    {tDesk('decline.action')}
                  </Button>
                )}
                {/* Contrato «Qué ofrece M5 en cada estado»: en `ofertada` la otra acción es `offer/cancel`. */}
                {req.status === 'ofertada' && (
                  <Button size="sm" variant="secondary" onClick={() => openCloseAction('cancelOffer', req.id)}>
                    {tDesk('cancelOffer.action')}
                  </Button>
                )}
                {/* §M5-S (v1.68, cierre de P-58): «Marcar recibida» SOLO en `en_transito` — el
                    único predecesor legítimo de `recibida` (`aceptada → confirm-shipment →
                    en_transito → receive`). Antes colgaba de `cotizada`: el paso equivocado,
                    que saltaba al 5 sin precio pactado ni aceptación. Desde `recibida` el
                    servidor responde `200` idempotente, así que el botón desaparece: no hay
                    nada que repetir. Candado S-3: test de render por los 11 estados. */}
                {req.status === 'en_transito' && (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={receiveMutation.isPending && receiveMutation.variables === req.id}
                    onClick={() => receiveMutation.mutate(req.id)}
                  >
                    {t('receive')}
                  </Button>
                )}
                {/* §M5-S: «Verificar» SOLO en `recibida` (su único predecesor). */}
                {req.status === 'recibida' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={verifyMutation.isPending && verifyMutation.variables === req.id}
                    onClick={() => verifyMutation.mutate(req.id)}
                  >
                    {t('verify')}
                  </Button>
                )}
                {/* Cierre explícito «Rechazar solicitud» (v1.24 · POST .../reject): sólo cuando
                    TODOS los ítems ya están rechazados y la solicitud NO es terminal —según el
                    `isTerminal` del SERVIDOR (v1.51), no según una lista local. Resuelve la
                    solicitud atorada en «Verificando» del caso reportado por el PO (bug P-4). */}
                {canRejectRequest && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => openRejectRequest(req)}
                  >
                    {t('rejectRequest')}
                  </Button>
                )}
              </div>

              {deskFor === req.id && (
                <BuylistDecisionDesk
                  sellRequestId={req.id}
                  onClose={() => setDeskFor(null)}
                  // §60.5 d: «Declinar» DENTRO de la mesa abre el MISMO diálogo y verbo que el de la fila.
                  onDecline={req.status === 'cotizada' && req.isTerminal === false ? () => openCloseAction('decline', req.id) : undefined}
                />
              )}

              {/* Guía + confirmación: solo en `aceptada`, que es el único estado donde las dos
                  acciones existen. Capturar la guía NO mueve el estado; confirmar sí — y son dos
                  actos separados porque el plazo mide algo del VENDEDOR y nos enteramos por algo
                  NUESTRO. */}
              {req.status === 'aceptada' && <BuylistShipmentActions request={req} />}
              {/* §60.5 b (HECHOS.md:45): una `aceptada` NO se cancela — la fila dice dónde está la acción. */}
              {req.status === 'aceptada' && (
                <p className="text-xs text-muted" data-testid={`m5-accepted-note-${req.id}`}>
                  {t('acceptedNote')}
                </p>
              )}
              {verifyFailedFor === req.id && req.status === 'recibida' && (
                <Banner variant="warning" role="status">
                  {t('receiveReview.verifyFailed')}
                </Banner>
              )}

              {(() => {
                // §60.5 c — barra de rechazo múltiple: solo con ≥ 1 rechazable (⛔ las `skip` no cuentan).
                const rejectable = req.items.filter((it) => isBulkRejectable(req.status, it) && !notOfferedIds.has(it.id));
                if (rejectable.length === 0) return null;
                const sel = (bulkSelected[req.id] ?? []).filter((id) => rejectable.some((it) => it.id === id));
                const n = rejectable.length;
                const k = sel.length;
                const hintId = `m5-bulk-hint-${req.id}`;
                return (
                  <div className="flex flex-wrap items-center gap-3 border-y border-border py-2" data-testid={`m5-bulk-bar-${req.id}`}>
                    <label className="flex min-h-[44px] items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-text"
                        checked={k > 0 && k === n}
                        aria-checked={k > 0 && k < n ? 'mixed' : k === n}
                        ref={(el) => {
                          if (el) el.indeterminate = k > 0 && k < n;
                        }}
                        onChange={() => setSelectedFor(req.id, k === n ? [] : rejectable.map((it) => it.id))}
                      />
                      {t('bulkReject.all', { n })}
                    </label>
                    <span className="text-sm" aria-live="polite">
                      {t('bulkReject.count', { k })}
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={k === 0}
                      aria-describedby={k === 0 ? hintId : undefined}
                      onClick={() => openBulk(req.id, rejectable.filter((it) => sel.includes(it.id)).map((it) => it.id))}
                    >
                      {t('bulkReject.selected', { k })}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const ids = rejectable.map((it) => it.id);
                        setSelectedFor(req.id, ids);
                        openBulk(req.id, ids);
                      }}
                    >
                      {t('bulkReject.allCta', { n })}
                    </Button>
                    {k === 0 && (
                      <span id={hintId} className="text-xs text-muted">
                        {t('bulkReject.hint')}
                      </span>
                    )}
                  </div>
                );
              })()}

              <div className="flex flex-col divide-y divide-border">
                {req.items.map((it) => {
                  const decisionPending =
                    decisionMutation.isPending && decisionMutation.variables?.itemId === it.id;
                  const decidable = !ITEM_TERMINAL.has(it.itemStatus);
                  const isRejected = it.itemStatus === 'rechazada';
                  // §60.7 a / §E2E-ADM.2 (F-4): la decisión por carta va por `offerDecision`. `skip` ⇒ «NO COMPRADA»
                  // y ningún botón ni casilla; `buy` ⇒ Aprobar y Rechazar (⛔ Ajustar); `null` (pre-ciclo) ⇒ los tres.
                  const notBought = it.offerDecision === 'skip' || notOfferedIds.has(it.id);
                  const canAdjust = it.offerDecision !== 'buy' && it.offerDecision !== 'skip';
                  const bulkable = isBulkRejectable(req.status, it) && !notOfferedIds.has(it.id);
                  const checked = (bulkSelected[req.id] ?? []).includes(it.id);
                  const cardBlock = (
                    <>
                      {/* Imagen de catálogo por ítem: único referente visual para verificar
                          la carta física contra la que llegó a la bóveda. */}
                      <CardImage src={it.card.imageSmallUrl} alt={it.card.name} className="w-10 shrink-0" />
                      <span className="text-sm font-medium" lang="en">
                        {it.card.name}
                      </span>
                    </>
                  );
                  return (
                    <div key={it.id} className="flex flex-col gap-1 py-3" data-testid={`m5-item-${it.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {bulkable ? (
                          <label className="flex min-h-[44px] items-center gap-3">
                            <input
                              type="checkbox"
                              className="h-5 w-5 accent-text"
                              checked={checked}
                              aria-label={t('bulkReject.selectOne', { card: it.card.name, folio: it.id })}
                              onChange={(e) =>
                                setSelectedFor(
                                  req.id,
                                  e.target.checked
                                    ? [...(bulkSelected[req.id] ?? []), it.id]
                                    : (bulkSelected[req.id] ?? []).filter((x) => x !== it.id),
                                )
                              }
                            />
                            {cardBlock}
                          </label>
                        ) : (
                          cardBlock
                        )}
                        <FinishBadge finish={it.finish} productType={it.productType} />
                        {/* Ítem rechazado: cotización tachada — NO suma en el total aprobado. */}
                        <span className={cn('tabular text-xs text-muted', isRejected && 'line-through')}>
                          {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                        </span>
                        {it.approvedPriceCents != null && (
                          <span className="tabular text-xs text-success">
                            {t('approvedLabel')}: {formatMoneyCents(it.approvedPriceCents, locale)}
                          </span>
                        )}
                        <StatusBadge domain="sellItem" value={it.itemStatus} />
                        {notBought && (
                          <span className={cn('font-mono text-[11px] uppercase tracking-[0.06em]', notOfferedIds.has(it.id) ? 'text-accent' : 'text-muted')} data-testid={`m5-not-bought-${it.id}`}>
                            {t('notBought.tag')}
                          </span>
                        )}
                        {isRejected && (
                          <Badge tone="danger" shape="outline">
                            {t('rejectedOutOfTotal')}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canDecide && decidable && !notBought && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={decisionPending && decisionMutation.variables?.decision === 'approve'}
                              onClick={() =>
                                decisionMutation.mutate({ requestId: req.id, itemId: it.id, decision: 'approve' })
                              }
                            >
                              {t('approve')}
                            </Button>
                            {canAdjust && (
                              <Button size="sm" variant="ghost" onClick={() => openAdjust(req.id, it)}>
                                {t('adjust')}
                              </Button>
                            )}
                            {/* v1.18: el rechazo exige MOTIVO (3–500) → abre el mini-diálogo. */}
                            <Button size="sm" variant="ghost" onClick={() => openReject(req.id, it)}>
                              {t('reject')}
                            </Button>
                          </>
                        )}
                        {/* Convertir a inventario: SOLO para aprobadas. Un ítem `rechazada`
                            (no-NM) NUNCA es convertible (contrato §M5, PROJECT criterio 16),
                            ni siquiera vencidos sus plazos: el botón no se ofrece. */}
                        {it.itemStatus !== 'convertida_inventario' && !isRejected && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={it.itemStatus !== 'aprobada'}
                            title={it.itemStatus !== 'aprobada' ? t('convertNeedsApproval') : undefined}
                            loading={
                              convertMutation.isPending && convertMutation.variables?.itemId === it.id
                            }
                            onClick={() => convertMutation.mutate({ requestId: req.id, itemId: it.id })}
                          >
                            {t('convert')}
                          </Button>
                        )}
                      </div>
                    </div>
                    {notBought && (
                      <p className="pl-14 text-xs text-muted">{t('notBought.note')}</p>
                    )}
                    {/* Detalle del rechazo dentro de la solicitud: motivo + plazos (server). */}
                    {isRejected && (
                      <div className="flex flex-col gap-0.5 pl-14 text-xs text-muted">
                        {it.rejectionReason && (
                          <p>
                            {t('rejected.reasonLabel')}: {it.rejectionReason}
                          </p>
                        )}
                        {it.rejectedAt && (
                          <p>
                            {t('rejected.rejectedAtLabel')}:{' '}
                            <span className="tabular">{formatDate(it.rejectedAt, locale)}</span>
                          </p>
                        )}
                        {it.returnDeadlineAt && it.abandonDeadlineAt && (
                          <p>
                            {t('rejected.returnUntil', { date: formatDate(it.returnDeadlineAt, locale) })}
                            {' · '}
                            {t('rejected.abandonAt', { date: formatDate(it.abandonDeadlineAt, locale) })}
                          </p>
                        )}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>

              {/* CLABE revelada bajo demanda: solo esta solicitud, solo hasta ocultarla */}
              {revealed?.requestId === req.id && (
                <Banner variant="warning" role="status" title={t('clabeLabel')}>
                  <span className="tabular font-medium text-text">{revealed.clabe}</span>
                  <p className="text-xs">{t('clabeNotice')}</p>
                </Banner>
              )}

              {/* Acciones de dinero saliente: solo en la etapa de verificación / por-pagar. */}
              {showMoneyOut && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-muted">{tm('moneyOutNote')}</span>
                    <div className="flex flex-wrap gap-2">
                      {revealed?.requestId === req.id ? (
                        <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
                          {t('hideClabe')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!isSuperAdmin}
                          title={!isSuperAdmin ? tm('masked') : undefined}
                          loading={revealMutation.isPending && revealMutation.variables === req.id}
                          onClick={() => revealMutation.mutate(req.id)}
                        >
                          {t('revealClabe')}
                        </Button>
                      )}
                      <Button
                        variant="accent"
                        size="sm"
                        disabled={!canPay || req.status === 'pagada'}
                        title={!isSuperAdmin ? tm('masked') : pendingDecisionsNote}
                        aria-describedby={pendingDecisionsNote ? pendingDecisionsId : undefined}
                        onClick={() => openPay(req.id)}
                      >
                        {t('paySpei')}
                      </Button>
                    </div>
                  </div>
                  {/* §M5-V.5 + §27.1.4: POR QUÉ está apagado, en texto secundario y bajo el botón. */}
                  {pendingDecisionsNote && (
                    <p id={pendingDecisionsId} className="text-xs text-muted sm:text-right">
                      {pendingDecisionsNote}
                    </p>
                  )}
                </div>
              )}

              {req.status === 'pagada' && (
                <p className="text-xs text-success">{t('paidNote')}</p>
              )}

              {feedback?.requestId === req.id && (
                <Banner
                  variant={feedback.kind === 'success' ? 'success' : 'danger'}
                  role={feedback.kind === 'success' ? 'status' : 'alert'}
                  title={feedback.kind === 'error' ? tc('errorTitle') : undefined}
                >
                  {feedback.message}
                </Banner>
              )}
              {showMoneyOut && !isSuperAdmin && (
                <Banner variant="warning">{te('MONEY_OUT_FORBIDDEN')}</Banner>
              )}
            </div>
          );
            })
          ))}
      </QueryState>
      )}

      {/* §60.5 c — «Rechazar seleccionadas / todas»: un motivo, UN correo (contrato v1.82 §PNL.4). Foco en el motivo. */}
      <Modal
        open={bulkTarget !== null}
        onClose={closeBulk}
        title={t('bulkReject.title', { k: bulkTarget?.itemIds.length ?? 0 })}
        footer={
          <>
            <Button variant="secondary" onClick={closeBulk}>
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!bulkReasonValid || (bulkTarget?.itemIds.length ?? 0) === 0}
              loading={bulkMutation.isPending}
              onClick={() =>
                bulkTarget &&
                bulkMutation.mutate({
                  requestId: bulkTarget.requestId,
                  itemIds: Array.from(new Set(bulkTarget.itemIds)),
                  reason: bulkReasonTrimmed,
                })
              }
              data-testid="m5-bulk-confirm"
            >
              {t('bulkReject.confirm', { k: bulkTarget?.itemIds.length ?? 0 })}
            </Button>
          </>
        }
      >
        {bulkTarget && (() => {
          const req = all.find((r) => r.id === bulkTarget.requestId);
          const rows = bulkTarget.itemIds
            .map((id) => req?.items.find((it) => it.id === id))
            .filter((it): it is SellItemDTO => !!it);
          const row = (it: SellItemDTO) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
              <span lang="en" className="font-medium">
                {it.card.name}
              </span>
              <span className="text-xs text-muted" lang="en">
                {it.card.setName} · #{it.card.number}
              </span>
              <FinishBadge finish={it.finish} productType={it.productType} />
              <span className="tabular font-mono text-[11px] text-muted">{it.id}</span>
            </li>
          );
          return (
            <div className="flex flex-col gap-3">
              <ul className="divide-y divide-border" data-testid="m5-bulk-list">
                {rows.slice(0, BULK_VISIBLE).map(row)}
              </ul>
              {rows.length > BULK_VISIBLE && (
                <details>
                  <summary className="cursor-pointer text-sm underline underline-offset-4">
                    {t('bulkReject.more', { r: rows.length - BULK_VISIBLE })}
                  </summary>
                  <ul className="divide-y divide-border">{rows.slice(BULK_VISIBLE).map(row)}</ul>
                </details>
              )}
              <Textarea
                ref={bulkReasonRef}
                label={t('bulkReject.reasonLabel')}
                hint={t('bulkReject.reasonHint')}
                value={bulkReason}
                maxLength={REJECT_REASON_MAX}
                counter={{ max: REJECT_REASON_MAX }}
                error={bulkReasonError ?? (bulkReason !== '' && !bulkReasonValid ? t('rejectReasonInvalid') : undefined)}
                onChange={(e) => {
                  setBulkReason(e.target.value);
                  setBulkReasonError(null);
                }}
                data-testid="m5-bulk-reason"
              />
              <p className="text-sm text-text">{t('bulkReject.notice')}</p>
              {bulkError && (
                <Banner variant="danger" role="alert">
                  <span data-testid="m5-bulk-error">{bulkError}</span>
                </Banner>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Cierre explícito de la solicitud (v1.24 · POST /admin/buylist/:id/reject). Confirmación
          destructiva (DESIGN_SYSTEM §7.6: «rechazar buylist»): resumen de consecuencia + motivo
          OPCIONAL (interno, sin correo) + botón `destructive` a la derecha. No mueve dinero. */}
      <Modal
        open={!!rejectRequestTarget}
        onClose={closeRejectRequest}
        title={t('rejectRequestTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeRejectRequest}>
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={rejectRequestMutation.isPending}
              onClick={() =>
                rejectRequestTarget &&
                rejectRequestMutation.mutate({
                  requestId: rejectRequestTarget.id,
                  reason: rejectRequestReason.trim() || undefined,
                })
              }
            >
              {t('rejectRequestConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rejectRequestTarget && (
            <p className="text-sm text-muted">
              <span className="tabular font-medium text-text">{rejectRequestTarget.id}</span>
              {' · '}
              {sellerLabel(rejectRequestTarget)}
            </p>
          )}
          <p className="text-sm">{t('rejectRequestConsequence')}</p>
          {/* Motivo OPCIONAL (0–500): interno al AuditLog, NO PII, no se envía correo. */}
          <Input
            label={t('rejectRequestReasonLabel')}
            hint={t('rejectRequestReasonHint')}
            type="text"
            maxLength={REJECT_REASON_MAX}
            value={rejectRequestReason}
            onChange={(e) => setRejectRequestReason(e.target.value)}
          />
          {rejectRequestError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {rejectRequestError}
            </Banner>
          )}
        </div>
      </Modal>

      {/* Modal de rechazo con motivo obligatorio (v1.18 · decision=reject + reason 3–500).
          El motivo llega al vendedor por CORREO junto con sus plazos (aviso en el copy). */}
      <Modal
        open={!!rejectTarget}
        onClose={closeReject}
        title={t('rejectTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeReject}>
              {tc('cancel')}
            </Button>
            <Button
              variant="accent"
              disabled={!rejectReasonValid}
              loading={decisionMutation.isPending && decisionMutation.variables?.decision === 'reject'}
              onClick={() =>
                rejectTarget &&
                rejectReasonValid &&
                decisionMutation.mutate({
                  requestId: rejectTarget.requestId,
                  itemId: rejectTarget.item.id,
                  decision: 'reject',
                  reason: rejectReasonTrimmed,
                })
              }
            >
              {t('rejectConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rejectTarget && (
            <p className="text-sm text-muted">
              <span lang="en" className="font-medium text-text">{rejectTarget.item.card.name}</span>
              {' · '}
              {t('quoted')}:{' '}
              <span className="tabular">
                {formatMoneyCents(rejectTarget.item.quotedPriceCents ?? 0, locale)}
              </span>
            </p>
          )}
          {/* Validación en cliente ANTES de enviar (espeja el 3–500 del backend). */}
          <Input
            label={t('rejectReasonLabel')}
            hint={t('rejectReasonHint')}
            error={rejectReason !== '' && !rejectReasonValid ? t('rejectReasonInvalid') : undefined}
            type="text"
            maxLength={REJECT_REASON_MAX}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <p className="text-xs text-muted">{t('rejectNotifyNote')}</p>
          {rejectError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {rejectError}
            </Banner>
          )}
        </div>
      </Modal>

      {/* §25.8 · confirmación §7.6 de «Declinar ahora» y de «Cancelar la oferta» (motivo interno opcional). */}
      <Modal
        open={!!closeAction}
        onClose={closeCloseAction}
        title={closeAction ? tDesk(`${closeAction.kind}.title`) : ''}
        footer={
          <>
            <Button variant="secondary" onClick={closeCloseAction}>
              {tc('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={closeReasonTooLong}
              loading={closeMutation.isPending}
              data-testid="m5-close-confirm"
              onClick={() =>
                closeAction &&
                !closeReasonTooLong &&
                closeMutation.mutate({ ...closeAction, reason: closeReason })
              }
            >
              {closeAction ? tDesk(`${closeAction.kind}.confirm`) : ''}
            </Button>
          </>
        }
      >
        {closeAction && (
          <div className="flex flex-col gap-3">
            <p className="tabular text-sm font-medium">{closeAction.requestId}</p>
            <p className="leading-[1.7]">{tDesk(`${closeAction.kind}.body`)}</p>
            <Input
              label={tDesk(`${closeAction.kind}.reasonLabel`)}
              hint={tDesk(`${closeAction.kind}.reasonHint`)}
              error={closeReasonTooLong ? tDesk('reasonTooLong') : undefined}
              type="text"
              maxLength={REJECT_REASON_MAX}
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
            />
            {closeError && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                {closeError}
              </Banner>
            )}
          </div>
        )}
      </Modal>

      {/* Modal de ajuste de precio por carta (decision=adjust + approvedPriceCents) */}
      <Modal
        open={!!adjustTarget}
        onClose={closeAdjust}
        title={t('adjustTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeAdjust}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={adjustCents == null}
              loading={decisionMutation.isPending && decisionMutation.variables?.decision === 'adjust'}
              onClick={() =>
                adjustTarget &&
                adjustCents != null &&
                decisionMutation.mutate({
                  requestId: adjustTarget.requestId,
                  itemId: adjustTarget.item.id,
                  decision: 'adjust',
                  approvedPriceCents: adjustCents,
                })
              }
            >
              {t('adjustConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {adjustTarget && (
            <p className="text-sm text-muted">
              <span lang="en" className="font-medium text-text">{adjustTarget.item.card.name}</span>
              {' · '}
              {t('quoted')}:{' '}
              <span className="tabular">
                {formatMoneyCents(adjustTarget.item.quotedPriceCents ?? 0, locale)}
              </span>
            </p>
          )}
          <Input
            label={t('adjustPriceLabel')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={adjustPrice}
            onChange={(e) => setAdjustPrice(e.target.value)}
          />
          {adjustCents != null && (
            <p className="text-xs text-muted">= {formatMoneyCents(adjustCents, locale)}</p>
          )}
          <p className="text-xs text-muted">{t('adjustHint')}</p>
          {adjustError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {adjustError}
            </Banner>
          )}
        </div>
      </Modal>

      {/* Modal de pago SPEI manual (referencia obligatoria; queda en bitácora) */}
      <Modal
        open={!!payTarget}
        onClose={closePay}
        title={t('paySpeiTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closePay}>
              {tc('cancel')}
            </Button>
            <Button
              variant="accent"
              disabled={speiReference.trim() === ''}
              loading={payMutation.isPending}
              onClick={() =>
                payTarget && payMutation.mutate({ requestId: payTarget, speiReference: speiReference.trim() })
              }
            >
              {t('paySpeiConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {payTarget && (
            <p className="text-sm text-muted">
              <span className="tabular font-medium text-text">{payTarget}</span>
            </p>
          )}
          <Input
            label={t('speiReferenceLabel')}
            type="text"
            value={speiReference}
            onChange={(e) => setSpeiReference(e.target.value)}
          />
          <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
          {payError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {payError}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}
