import { describe, expect, it } from 'vitest';
import { stampButtonLabel } from './IdsCaptureFields';

const t = (k: string) => ({ 'stampButton.staff': 'Staff', 'stampButton.event_promo': 'Promo de evento', noStamp: 'Sin liga' }[k] ?? k);
describe('stampButtonLabel', () => {
  it('etiqueta igual al tipo: un solo nombre', () => {
    expect(stampButtonLabel(t, { type: 'staff', label: 'Staff' } as never)).toBe('Staff');
    expect(stampButtonLabel(t, { type: 'staff', label: ' staff ' } as never)).toBe('Staff');
    expect(stampButtonLabel(t, { type: 'event_promo', label: 'Promo de Evento' } as never)).toBe('Promo de evento');
  });
  it('etiqueta distinta se conserva; sin sello, noStamp', () => {
    expect(stampButtonLabel(t, { type: 'staff', label: 'Worlds' } as never)).toBe('Staff Worlds');
    expect(stampButtonLabel(t, null)).toBe('Sin liga');
    expect(stampButtonLabel(t, { type: 'staff' } as never)).toBe('Staff');
    expect(stampButtonLabel(t, { type: 'staff', label: null } as never)).toBe('Staff');
  });
});
