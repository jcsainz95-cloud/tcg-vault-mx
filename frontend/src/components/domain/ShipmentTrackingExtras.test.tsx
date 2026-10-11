import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { CUSTOMER_TIMELINE_KINDS, type CustomerTimelineEventDTO } from '@/types/contract';
import { ShipmentTimeline, TrackingLink } from './ShipmentTrackingExtras';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

/** UX-SDX-15 (`DESIGN_SYSTEM §43.11`, SK10): lo que ve el cliente del rastreo. */

describe('UX-SDX-15 · liga de rastreo', () => {
  it('con `trackingUrl` ⇒ un enlace externo «Rastrear en la paquetería» con rel noopener', () => {
    renderWithIntl(<TrackingLink url="https://rastreo.example/abc" />, 'es');
    const a = screen.getByRole('link', { name: /Rastrear en la paquetería/ });
    expect(a).toHaveAttribute('href', 'https://rastreo.example/abc');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a.getAttribute('rel')).toMatch(/\bnoopener\b/);
  });
  it('sin `trackingUrl` ⇒ cero enlaces (⛔ nunca se construye con la guía)', () => {
    const { container } = renderWithIntl(
      <div>
        <TrackingLink url={undefined} />
        <TrackingLink url={null} />
      </div>,
      'es',
    );
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('UX-SDX-15 · movimientos', () => {
  it('los siete `kind` tienen rótulo en ES y EN', () => {
    for (const cat of [es, en]) {
      const tl = (cat as unknown as { status: { timeline: Record<string, string> } }).status.timeline;
      for (const k of CUSTOMER_TIMELINE_KINDS) expect(tl[k], k).toBeTruthy();
    }
  });
  it('el más reciente arriba; «en sucursal» con su nombre; un `kind` fuera del contrato no se pinta crudo', () => {
    const events = [
      { kind: 'label_created', at: '2026-10-01T10:00:00Z' },
      { kind: 'at_branch', at: '2026-10-03T10:00:00Z', branchName: 'Punto99 Sur' },
      { kind: 'exception', at: '2026-10-04T10:00:00Z' },
    ] as unknown as CustomerTimelineEventDTO[];
    renderWithIntl(<ShipmentTimeline events={events} />, 'es');
    const list = within(screen.getByTestId('shipment-timeline')).getAllByRole('listitem');
    expect(list).toHaveLength(2);
    expect(list[0].textContent).toMatch(/^En sucursal: Punto99 Sur\. Pasa a recogerlo\. · /);
    expect(list[1].textContent).toMatch(/^Guía creada · /);
    expect(screen.getByTestId('shipment-timeline').textContent).not.toMatch(/exception/);
  });
  it('F-5 · empate de `at`: el servidor manda `at asc`; la pantalla solo invierte (no re-ordena)', () => {
    const events = [
      { kind: 'label_created', at: '2026-10-01T10:00:00Z' },
      { kind: 'shipped', at: '2026-10-02T10:00:00Z' },
      { kind: 'in_transit', at: '2026-10-02T10:00:00Z' },
    ] as unknown as CustomerTimelineEventDTO[];
    renderWithIntl(<ShipmentTimeline events={events} />, 'es');
    const list = within(screen.getByTestId('shipment-timeline')).getAllByRole('listitem');
    expect(list).toHaveLength(3);
    // asc del servidor: [label_created, shipped, in_transit] ⇒ invertido: [in_transit, shipped, label_created]
    expect(list[2].textContent).toMatch(/^Guía creada · /);
    expect(list[0].textContent).toMatch(/^En camino/);
    expect(list[1].textContent).toMatch(/^Salió/);
  });
  it('sin eventos ⇒ nada', () => {
    const { container } = renderWithIntl(<ShipmentTimeline events={[]} />, 'es');
    expect(container).toBeEmptyDOMElement();
  });
});
