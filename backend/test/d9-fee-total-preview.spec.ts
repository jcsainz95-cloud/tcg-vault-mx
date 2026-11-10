/**
 * D9 §8.4 (iii) — la vista previa del dial de IVA muestra el total que REALMENTE se cobra: el exhibido con la comisión de
 * plataforma dentro (`feeIncludedPriceCentsOf`). 11600 con 3.6 % / IVA 16 ⇒ 12200. Sin `stripeFeePct` el total = exhibido.
 */
import { ivaTransferPosition, ivaTransferPreview } from '../src/modules/settings/iva-transfer';

describe('D9 §8.4(iii) — totalChargedCents de la vista previa del dial', () => {
  it('con la comisión (0.036) el total cobrado es 12200 para un exhibido de 11600', () => {
    const p = ivaTransferPosition(10000, 100, 16, 0.036);
    expect(p.displayPriceCents).toBe(11600);
    expect(p.totalChargedCents).toBe(12200);
    expect(p.netRevenueCents).toBe(10000); // la comisión no mueve el neto del acuse
  });
  it('sin comisión (omitida o 0) el total es el exhibido', () => {
    expect(ivaTransferPosition(10000, 100, 16).totalChargedCents).toBe(11600);
    expect(ivaTransferPosition(10000, 100, 16, 0).totalChargedCents).toBe(11600);
  });
  it('el delta del acuse NO depende de la comisión', () => {
    const base = { currentPct: 100, proposedPct: 50, ivaRatePct: 16, samplePriceCents: 10000 };
    const a = ivaTransferPreview(base);
    const b = ivaTransferPreview({ ...base, stripeFeePct: 0.036 });
    expect(b.netDeltaPerUnitCents).toBe(a.netDeltaPerUnitCents);
    expect(b.proposed.totalChargedCents).toBeGreaterThan(a.proposed.totalChargedCents);
  });
});
