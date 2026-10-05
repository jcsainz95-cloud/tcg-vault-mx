import { describe, it, expect } from 'vitest';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';

/**
 * F-34 · **BRJ-UI-6** (`DESIGN_SYSTEM §60.15` + §26.3, v5.1): el botón de M5 se llama «Recibida: empezar revisión»
 * (`admin.m5.receive`, §60.5 a). Ningún texto puede mandar a pulsar el botón viejo «Marcar recibida» / “Mark received”:
 * el operador buscaría un botón que no existe.
 */
function values(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => values(v, path ? `${path}.${k}` : k));
  }
  return [];
}

describe('F-34 · BRJ-UI-6 — ningún texto nombra el botón viejo «Marcar recibida»', () => {
  it.each([
    ['es', es, /Marcar recibida/i],
    ['en', en, /Mark received/i],
  ] as const)('%s: 0 valores lo contienen', (_l, msgs, re) => {
    expect(values(msgs).filter(([, v]) => re.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('los dos textos de §60.15, carácter por carácter', () => {
    const e = es.error as unknown as Record<string, unknown> & { INVALID_TRANSITION_VERB: Record<string, string> };
    const n = en.error as unknown as Record<string, unknown> & { INVALID_TRANSITION_VERB: Record<string, string> };
    expect(e.REQUEST_NOT_RECEIVED).toBe(
      'Esta solicitud no tiene registrada la llegada del paquete, así que ninguna de sus cartas se puede aprobar. Cuando el paquete esté en tus manos, pulsa «Recibida: empezar revisión» en la solicitud y vuelve a aprobar. No se guardó nada.',
    );
    expect(n.REQUEST_NOT_RECEIVED).toBe(
      'This request has no record that the parcel arrived, so none of its cards can be approved. Once the parcel is in your hands, press “Received: start review” on the request and approve again. Nothing was saved.',
    );
    expect(e.INVALID_TRANSITION_VERB.receive).toBe('«Recibida: empezar revisión»');
    expect(n.INVALID_TRANSITION_VERB.receive).toBe('“Received: start review”');
    // Mismo nombre que el botón (§60.5 a).
    expect(es.admin.m5.receive).toBe('Recibida: empezar revisión');
    expect(en.admin.m5.receive).toBe('Received: start review');
  });
});
