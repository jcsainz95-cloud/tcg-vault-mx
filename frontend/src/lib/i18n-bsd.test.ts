import { describe, it, expect } from 'vitest';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { get, p66_3Offenders } from './i18n-p66-3.testkit';

/**
 * 💰 rev BSD-1 — **UX-BSD-9 (BSD-F8)** y **UX-BSD-16**: paridad ES/EN de las claves de `DESIGN_SYSTEM §BSD-UX.8`.
 *
 * ⚠️ Espacios re-medidos por frontend (§BSD-UX.6e lo pide: «frontend re-mide los nombres reales»):
 *  - diales de M10: `admin.m10.buylistCycle.{groups,labels,help,rule}` (el diseño decía `admin.m10.dials.{groups,labels,hints,rules}`);
 *  - datos de AG-23: `admin.spendAlerts.fact.*` (el diseño decía `field.*`, que en este catálogo son los campos de domicilio de AG-1);
 *  - `admin.spendAlerts.mail.AG-23.*` NO vive aquí: el correo `AVG-1` lo arma el backend (y `mail.*` es el estado del correo).
 * Más tres claves de frontend SIN diseño (contrato BSD-1.1 C-8 y BSD-1.3 punto 4), marcadas en FRONTEND_NOTES §BSD.
 */
const KEYS: string[] = [
  'status.sellRequestExpiry.not_continued',
  ...['closedNotContinued', 'pickupLockedInProgress'].map((k) => `buylist.offer.${k}`),
  ...['title', 'body', 'bodyNoCarrier', 'tracking', 'download', 'downloading', 'alsoInEmail', 'downloadShort', 'errorUnavailable', 'errorTemporary'].map(
    (k) => `buylist.offer.label.${k}`,
  ),
  ...[
    'title', 'ref', 'originTitle', 'sender', 'senderMissing', 'senderHint', 'senderSuggestion', 'useSuggestion', 'scopeNote', 'resyncNote',
    'senderRequired', 'destinationTitle', 'destinationName', 'destinationNote', 'feeDeducted', 'boxValue', 'marginNegative', 'pickupYes',
    'pickupNo', 'deliveryHome', 'deliveryBranch', 'showBranch', 'hideBranch', 'noRecommended', 'confirmNegative', 'confirmBranch',
    'sentToSeller', 'processingNote', 'bought', 'manualIntro', 'reissueBody', 'reissueNotAccepted', 'reissueSellerShipped',
    ...['featureDisabled', 'notAccepted', 'sellerShipped', 'manualExists', 'noPickupAddress', 'senderMissingQuote', 'storeAddressMissing', 'destinationRejected'].map(
      (k) => `error.${k}`,
    ),
  ].map((k) => `admin.m4.tracking.sdx.inbound.${k}`),
  'admin.m5.desk.readOnlyByStatus.aceptada',
  'admin.m5.acceptedNote',
  ...['generate', 'summary', 'cost', 'processing', 'costFromProvider', 'alreadySkydropx', 'inProgress', 'preparing', 'alertFilter', 'openLabel'].map(
    (k) => `admin.m5.inbound.${k}`,
  ),
  ...[
    'action', 'title', 'body', 'bodySdx', 'bodyManual', 'bodyInProgress', 'reasonLabel', 'reasonHint', 'reasonTooShort', 'confirm', 'back', 'done',
    ...['status', 'sellerShipped', 'shipmentConfirmed', 'reason', 'forbidden', 'unknown', 'notDone'].map((k) => `error.${k}`),
  ].map((k) => `admin.m5.declineAccepted.${k}`),
  ...['line', 'tag', 'note', 'inDays'].map((k) => `admin.m5.guideDue.${k}`),
  'admin.dashboard.buylistGuideDue',
  'admin.dashboard.buylistInboundLabelAlert',
  'admin.m10.buylistCycle.groups.buylistGuideClose',
  'admin.m10.buylistCycle.groups.buylistGuideCloseNote',
  ...['labels', 'help', 'rule'].flatMap((g) => [`admin.m10.buylistCycle.${g}.buylistGuideCloseCalendarDays`, `admin.m10.buylistCycle.${g}.buylistGuideWarnDaysBeforeClose`]),
  'admin.spendAlerts.kind.AG-23.title',
  'admin.spendAlerts.kind.AG-23.text',
  ...['sellRequestId', 'closesAt', 'offerGrossCents'].map((k) => `admin.spendAlerts.fact.${k}`),
];
const M7_NEW = ['buylistFeeRetained', 'buylistGuideCost', 'buylistGuideMargin', 'buylistGuideMarginHelp', 'buylistGuideMarginNegative', 'buylistGuideCostMissing'];

/** Los `{arg}` de primer nivel de un mensaje ICU (los de los plurales no cuentan). */
function args(msg: string): string[] {
  const out = new Set<string>();
  let depth = 0;
  for (let i = 0; i < msg.length; i++) {
    if (msg[i] === '{') {
      // Solo las llaves de PRIMER nivel abren un argumento; dentro de un plural, `{hoy}` es texto de la rama.
      if (depth === 0) {
        const m = /^\{(\w+)\s*[,}]/.exec(msg.slice(i));
        if (m) out.add(m[1]);
      }
      depth++;
    } else if (msg[i] === '}') depth--;
  }
  return [...out].sort();
}

describe('UX-BSD-9 (BSD-F8) · paridad ES/EN de §BSD-UX.8', () => {
  it.each(KEYS)('%s existe en ES y en EN, no vacía, con los mismos argumentos', (k) => {
    const a = get(es, k);
    const b = get(en, k);
    expect(typeof a, `falta en es.json: ${k}`).toBe('string');
    expect(typeof b, `falta en en.json: ${k}`).toBe('string');
    expect(String(a).trim()).not.toBe('');
    expect(String(b).trim()).not.toBe('');
    expect(args(String(a))).toEqual(args(String(b)));
  });

  it('BX2 · ninguna frase del VENDEDOR sobre `not_continued` culpa: ⛔ expir|venc|plazo|no enviaste', () => {
    for (const cat of [es, en]) {
      for (const k of ['status.sellRequestExpiry.not_continued', 'buylist.offer.closedNotContinued']) {
        expect(String(get(cat, k))).not.toMatch(/expir|venc|plazo|no enviaste|deadline|expired|didn.t send/i);
      }
    }
  });

  it('UX-BSD-10 · la copia vieja «ya no se cancela» no queda en las dos claves que cambian', () => {
    for (const k of ['admin.m5.desk.readOnlyByStatus.aceptada', 'admin.m5.acceptedNote']) {
      expect(String(get(es, k))).not.toMatch(/ya no se cancela/);
      expect(String(get(en, k))).not.toMatch(/can no longer be cancelled/);
    }
  });
});

describe('UX-BSD-16 · M7: las seis claves nuevas y la fórmula', () => {
  it.each(M7_NEW)('admin.m7.pnl.%s en ES y EN, sin «buylist» ni códigos internos', (k) => {
    for (const cat of [es, en]) {
      const v = String(get(cat, `admin.m7.pnl.${k}`));
      expect(v.trim()).not.toBe('');
      expect(v).not.toMatch(/buylist|M-?\d|AG-\d|AV-\d/i);
    }
  });
  it('la fórmula sigue con «Stripe» y «ajustes de paquetería», y gana «descontada a vendedores» / «deducted from sellers»', () => {
    expect(String(get(es, 'admin.m7.pnl.formula'))).toMatch(/Stripe/);
    expect(String(get(en, 'admin.m7.pnl.formula'))).toMatch(/Stripe/);
    expect(String(get(es, 'admin.m7.pnl.formula'))).toContain('ajustes de paquetería');
    expect(String(get(es, 'admin.m7.pnl.formula'))).toContain('descontada a vendedores');
    expect(String(get(en, 'admin.m7.pnl.formula'))).toContain('deducted from sellers');
    const offenders = (['es', 'en'] as const).flatMap((l) =>
      p66_3Offenders(l, Object.fromEntries(M7_NEW.map((k) => [k, String(get(l === 'es' ? es : en, `admin.m7.pnl.${k}`))]))),
    );
    expect(offenders).toEqual([]);
  });
});
