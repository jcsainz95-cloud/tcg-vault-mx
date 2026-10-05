import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { SPEND_ALERT_SWITCHABLE_CODES } from '@/types/contract';

/**
 * **UX-GAS-7** (`DESIGN_SYSTEM §43.19.15`, §43.19.13): cada clave nueva de v4.20 existe en `es` y en `en`, y las tres
 * retiradas (`buy.ownerOnly`, `error.ownerOnly`, `labelAlert.unknown.ownerOnly`) no existen en ninguno. Más las de la
 * errata v1.80.12.10 (dueño) que esta entrega añade.
 */

function flat(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj };
  if (typeof obj !== 'object' || obj === null) return {};
  return Object.entries(obj as Record<string, unknown>).reduce(
    (acc, [k, v]) => ({ ...acc, ...flat(v, prefix ? `${prefix}.${k}` : k) }),
    {} as Record<string, string>,
  );
}
const ES = flat(es);
const EN = flat(en);

const ROOTS = ['admin.spendAlerts.', 'admin.m10.spend.', 'admin.m10.ownerOnly.', 'admin.dashboard.spendControl.', 'admin.m4.tracking.sdx.verify.', 'admin.m4.tracking.sdx.reason.'];
const SDX = 'admin.m4.tracking.sdx.';
const NEW = [
  `${SDX}buy.superAdminOnly`,
  `${SDX}buy.limit.dailySpend`,
  `${SDX}buy.limit.reissue`,
  `${SDX}options.limitNote`,
  `${SDX}options.limitReason.dailySpend`,
  `${SDX}options.limitReason.reissue`,
  `${SDX}processing.providerError`,
  ...['title', 'body', 'bodyNoTime', 'folio', 'copy', 'timeout', 'found', 'notCharged', 'notSent', 'manualVerified', 'manual', 'requote'].map((k) => `${SDX}verify.${k}`),
  ...['conflict', 'charged_not_found', 'ambiguous', 'balance_moved', 'unreadable', 'not_calibrated', 'duplicate', 'none'].map((k) => `${SDX}reason.${k}`),
  ...[
    'superAdminOnly',
    'limitNothing',
    'rateAlreadyPurchased',
    'providerIdTaken',
    'purchaseInFlight',
    'purchaseInFlightFolio',
    'purchaseInFlightReady',
    'wait.seconds',
    'wait.fewSeconds',
    'wait.minutes',
    'attemptsExhausted',
    'stalePurchase',
  ].map((k) => `${SDX}error.${k}`),
  'admin.m4.labelAlert.unknown.superAdminOnly',
  'admin.m4.labelAlert.orphan.title',
  'admin.m4.labelAlert.orphan.body',
  ...['intro', 'data.reference', 'data.recipient', 'data.address', 'data.carrier', 'data.price', 'data.chosenBy', 'data.noReference', 'conflict.label', 'conflict.required', 'releasedVerified', 'releasedNotSent', 'releasedUnverified', 'providerConflict'].map(
    (k) => `admin.m4.label.release.${k}`,
  ),
  'admin.m10.shipping.lowBalanceHint',
  'admin.modules.spendAlerts',
  ...['title', 'unseen', 'labels24h', 'personCap', 'personNoCap', 'noLabels', 'more'].map((k) => `admin.dashboard.spendControl.${k}`),
  ...SPEND_ALERT_SWITCHABLE_CODES.map((c) => `admin.spendAlerts.kind.${c}.title`),
  'admin.m6.ownerProtected',
];
const RETIRED = [`${SDX}buy.ownerOnly`, `${SDX}error.ownerOnly`, 'admin.m4.labelAlert.unknown.ownerOnly'];

describe('UX-GAS-7 · i18n de v4.20 (§43.19.13)', () => {
  it('cada clave nueva existe en ES y en EN, con texto', () => {
    for (const k of NEW) {
      expect(ES[k], `ES ${k}`).toBeTruthy();
      expect(EN[k], `EN ${k}`).toBeTruthy();
    }
  });
  it('los espacios nuevos tienen las MISMAS claves en los dos idiomas', () => {
    const ours = (cat: Record<string, string>) => Object.keys(cat).filter((k) => ROOTS.some((r) => k.startsWith(r))).sort();
    expect(ours(ES)).toEqual(ours(EN));
  });
  it('las tres retiradas no existen en ninguno', () => {
    for (const k of RETIRED) {
      expect(ES[k], k).toBeUndefined();
      expect(EN[k], k).toBeUndefined();
    }
  });
  it('SK11/§43.19.0: ningún texto de la ventana dice ya «Solo el dueño compra» ni «No hay tope aparte del saldo»', () => {
    const all = Object.values(ES).join('\n') + Object.values(EN).join('\n');
    expect(all).not.toMatch(/Solo el dueño compra guías|No hay tope aparte del saldo|only the owner buys labels/i);
  });
});

/** **v4.21** (`DESIGN_SYSTEM §43.20.11` FS-44): las claves nuevas existen en los dos idiomas; las dos retiradas en ninguno. */
const SA = 'admin.spendAlerts.';
const NEW_421 = [
  ...['muted', 'mutedAll', 'mutedOnly', 'mutedNone'].map((k) => `${SA}filters.${k}`),
  `${SA}ownerMarks`,
  `${SA}summary.muted`,
  `${SA}kind.AG-9.orphan_cancel_unknown`,
  ...['title', 'titleNoOwner', 'textChanged', 'textFirst', 'textNoOwner', 'textNoOwnerFrom'].map((k) => `${SA}kind.AG-21.${k}`),
  ...['staff_created', 'staff_password_reset', 'staff_status_changed', 'staff_deleted', 'owner_account_denied', 'owner_setting_denied', 'other'].map(
    (k) => `${SA}kind.AG-22.act.${k}`,
  ),
  ...['title', 'target', 'targetNone', 'role.super_admin', 'role.vault_operator'].map((k) => `${SA}kind.AG-22.${k}`),
  ...['sevAG1', 'sevAG9', 'sevAG22', 'alwaysOn'].map((k) => `admin.m10.spend.alerts.${k}`),
  'admin.m6.ownerTag',
  'admin.m6.ownerAccountSelf',
];
const RETIRED_421 = [`${SA}kind.AG-22.text`, 'admin.m10.spend.alerts.byCase'];

describe('FS-44 · i18n de v4.21 (§43.20)', () => {
  it('cada clave nueva existe en ES y en EN, con texto', () => {
    for (const k of NEW_421) {
      expect(ES[k], `ES ${k}`).toBeTruthy();
      expect(EN[k], `EN ${k}`).toBeTruthy();
    }
  });
  it('`kind.AG-22.text` y `alerts.byCase` no existen en ninguno', () => {
    for (const k of RETIRED_421) {
      expect(ES[k], k).toBeUndefined();
      expect(EN[k], k).toBeUndefined();
    }
  });
  it('OWN-4: ningún texto de la sección dice que un aviso apagado «no se registra»', () => {
    const spend = Object.entries({ ...ES, ...Object.fromEntries(Object.entries(EN).map(([k, v]) => [`en:${k}`, v])) })
      .filter(([k]) => k.replace(/^en:/, '').startsWith('admin.m10.spend.'))
      .map(([, v]) => v)
      .join('\n');
    expect(spend).not.toMatch(/no se registra|no se podrá ver|isn't recorded|aren't recorded|can't be seen later/);
  });
  it('§43.20.7: `ref.*` en ES sin artículo y ninguna frase ES de avisos dice «de {ref}» (sería «de el»)', () => {
    expect(ES[`${SA}ref.order`]).toBe('pedido {orderNumber}');
    expect(ES[`${SA}ref.shipment`]).toBe('envío {folio}');
    expect(ES[`${SA}ref.none`]).toBe('envío sin folio');
    const phrases = Object.entries(ES).filter(([k]) => k.startsWith(`${SA}kind.`));
    for (const [k, v] of phrases) expect(v, k).not.toMatch(/\b(de|en|a) \{ref\}/);
  });
});
