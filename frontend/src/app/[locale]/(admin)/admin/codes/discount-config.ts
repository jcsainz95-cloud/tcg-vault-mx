import type { DiscountCodeBatchDTO, DiscountCodeCreateRequest, DiscountCodeDTO } from '@/types/contract';
import { ALL_SCOPES, type ConfigDraft, type FieldErrors } from './DiscountConfigFields';
import { centsToPesos, isoToMxInput, mxInputToIso, pesosToCents } from './dsc-format';

type T = (key: string, values?: Record<string, string | number>) => string;

/** La config del contrato (§DSC.7) que comparten código suelto y lote. */
export type ConfigBody = Omit<DiscountCodeCreateRequest, 'code' | 'maxTotalUses' | 'maxUsesPerCustomer'>;

/**
 * Borrador ⇒ cuerpo del contrato, con la validación de forma que el panel puede hacer antes de enviar (el servidor
 * sigue siendo la autoridad: `422 VALIDATION_ERROR {field}` se pinta en el mismo campo). Las cuatro casillas marcadas
 * ⇒ `productScopes: []` (= todos, §DSC.1); ninguna ⇒ no se guarda (maqueta D4).
 */
export function toConfig(d: ConfigDraft, t: T): { body?: ConfigBody; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const body: ConfigBody = { kind: d.kind };
  if (d.kind === 'percent') {
    const pct = Number(d.percentPct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) errors.percentPct = t('errors.validation');
    else body.percentPct = pct;
    const cap = pesosToCents(d.maxDiscountPesos);
    if (cap !== null && (Number.isNaN(cap) || cap < 1)) errors.maxDiscountCents = t('errors.validation');
    else if (cap !== null) body.maxDiscountCents = cap;
  }
  if (d.kind === 'fixed_amount') {
    const amount = pesosToCents(d.amountPesos);
    if (amount === null || Number.isNaN(amount) || amount < 1) errors.amountCents = t('errors.validation');
    else body.amountCents = amount;
  }
  const min = pesosToCents(d.minSubtotalPesos);
  if (min !== null && (Number.isNaN(min) || min < 1)) errors.minSubtotalCents = t('errors.validation');
  else if (min !== null) body.minSubtotalCents = min;
  if (d.startsAt) {
    const s = mxInputToIso(d.startsAt);
    if (!s) errors.startsAt = t('errors.validation');
    else body.startsAt = s;
  }
  if (d.endsAt) {
    const e = mxInputToIso(d.endsAt, true);
    if (!e) errors.endsAt = t('errors.validation');
    else body.endsAt = e;
  }
  if (d.scopes.length === 0) errors.productScopes = t('errors.noScopes');
  else body.productScopes = d.scopes.length === ALL_SCOPES.length ? [] : ALL_SCOPES.filter((s) => d.scopes.includes(s));
  body.destinations = d.destination === 'both' ? [] : [d.destination];
  return Object.keys(errors).length > 0 ? { errors } : { body, errors };
}

/** DTO del servidor ⇒ borrador (edición). `endsAt` vuelve al minuto que capturó el dueño (−60 s, §DSC.6). */
export function fromDTO(c: DiscountCodeDTO | DiscountCodeBatchDTO): ConfigDraft {
  return {
    kind: c.kind,
    percentPct: c.percentPct != null ? String(c.percentPct) : '',
    amountPesos: centsToPesos(c.amountCents),
    maxDiscountPesos: centsToPesos(c.maxDiscountCents),
    minSubtotalPesos: centsToPesos(c.minSubtotalCents),
    startsAt: isoToMxInput(c.startsAt),
    endsAt: isoToMxInput(c.endsAt, true),
    scopes: c.productScopes.length === 0 ? [...ALL_SCOPES] : [...c.productScopes],
    destination: c.destinations.length === 1 ? c.destinations[0] : 'both',
  };
}

/** `422 VALIDATION_ERROR { field }` del servidor ⇒ error bajo ese campo (o el general si el campo no está en pantalla). */
export function serverFieldError(details: Record<string, unknown> | undefined, t: T): FieldErrors {
  const f = typeof details?.field === 'string' ? details.field : null;
  return f ? { [f]: t('errors.validation') } : {};
}
