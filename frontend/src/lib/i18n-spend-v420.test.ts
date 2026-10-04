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
