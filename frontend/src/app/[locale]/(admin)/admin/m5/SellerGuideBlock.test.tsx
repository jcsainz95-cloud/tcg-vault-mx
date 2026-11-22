import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../../messages/es.json';
import type { AdminBuylistDTO, AdminInboundShipmentDTO } from '@/types/contract';

const openLabelPdf = vi.fn();
vi.mock('../m4/capture/label-pdf', () => ({ openLabelPdf: (...a: unknown[]) => openLabelPdf(...a) }));
import { SellerGuideBlock, hasSellerGuide, sellerGuideOf } from './SellerGuideBlock';

const base: AdminInboundShipmentDTO = {
  id: 'sh-1', folio: 'ENV-1', status: 'guia', labelSource: 'skydropx', labelProcessing: false,
  carrier: 'Paquetexpress', trackingNumber: 'PQX123', trackingUrl: 'https://track.example/PQX123',
  costCents: 25000, costIvaCents: 0, insuranceCostCents: 0, providerCanceledAt: null, cancelConfirmed: false,
};
const wrap = (i: AdminInboundShipmentDTO | null, req: Partial<Pick<AdminBuylistDTO, 'shipmentCarrier' | 'shipmentTrackingNumber'>> = {}) => {
  const g = sellerGuideOf({ inboundShipment: i, shipmentCarrier: null, shipmentTrackingNumber: null, ...req });
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <SellerGuideBlock requestId="SR-1" {...(g ?? {})} />
    </NextIntlClientProvider>,
  );
};
const PDF = { name: 'Ver / imprimir guía (PDF)' };
const src = (i: AdminInboundShipmentDTO | null, c: string | null = null, n: string | null = null) => ({ inboundShipment: i, shipmentCarrier: c, shipmentTrackingNumber: n });

describe('SellerGuideBlock', () => {
  beforeEach(() => openLabelPdf.mockReset().mockResolvedValue(undefined));

  it('skydropx: paquetería, número, rastreo y PDF (modo download, no bloqueable)', async () => {
    wrap(base);
    expect(screen.getByText('Paquetexpress')).toBeInTheDocument();
    expect(screen.getByText('PQX123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver rastreo' })).toHaveAttribute('href', 'https://track.example/PQX123');
    fireEvent.click(screen.getByRole('button', PDF));
    await waitFor(() => expect(openLabelPdf).toHaveBeenCalledWith('sh-1', 'ENV-1', 'download'));
  });

  it('manual real: inboundShipment null + guía en la solicitud (aceptada/en_transito): rótulo, número, sin PDF', () => {
    wrap(null, { shipmentCarrier: 'Estafeta', shipmentTrackingNumber: 'EST999' });
    expect(screen.getByText('Guía capturada a mano')).toBeInTheDocument();
    expect(screen.getByText('EST999')).toBeInTheDocument();
    expect(screen.getByText('Estafeta')).toBeInTheDocument();
    expect(screen.queryByRole('button', PDF)).toBeNull();
    expect(screen.queryByTestId('seller-guide-canceled')).toBeNull();
  });

  it('caso backend: fila cancelado vacía + guía real en la solicitud ⇒ guía manual, NO «Cancelada»', () => {
    const empty = { ...base, status: 'cancelado' as const, labelSource: null, carrier: null, trackingNumber: null, trackingUrl: null };
    wrap(empty, { shipmentCarrier: 'DHL', shipmentTrackingNumber: 'DHL777' });
    expect(screen.getByText('DHL777')).toBeInTheDocument();
    expect(screen.getByText('Guía capturada a mano')).toBeInTheDocument();
    expect(screen.queryByTestId('seller-guide-canceled')).toBeNull();
    expect(screen.queryByRole('button', PDF)).toBeNull();
  });

  it('cancelada con datos: lo indica y no ofrece PDF', () => {
    wrap({ ...base, status: 'cancelado', providerCanceledAt: '2026-11-01T10:00:00Z', cancelConfirmed: true });
    expect(screen.getByTestId('seller-guide-canceled')).toHaveTextContent('Guía cancelada');
    expect(screen.queryByRole('button', PDF)).toBeNull();
  });

  it('cancelación sellada sin confirmar (guia + providerCanceledAt): oculta PDF y rotula «en proceso»', () => {
    wrap({ ...base, providerCanceledAt: '2026-11-01T10:00:00Z', cancelConfirmed: false });
    expect(screen.getByTestId('seller-guide-canceling')).toHaveTextContent('Cancelación en proceso');
    expect(screen.queryByRole('button', PDF)).toBeNull();
  });

  it('hasSellerGuide: según trackingNumber/labelSource de la fila o guía manual de la solicitud', () => {
    expect(hasSellerGuide(src({ ...base, status: 'solicitado', labelSource: null, carrier: null, trackingNumber: null }))).toBe(false);
    expect(hasSellerGuide(src(null))).toBe(false);
    expect(hasSellerGuide(src(base))).toBe(true);
    expect(hasSellerGuide(src(null, 'DHL', 'X1'))).toBe(true);
    expect(hasSellerGuide(src({ ...base, status: 'cancelado', labelSource: null, carrier: null, trackingNumber: null }, 'DHL', 'X1'))).toBe(true);
    expect(hasSellerGuide(src({ ...base, status: 'cancelado', labelSource: null, carrier: null, trackingNumber: null }))).toBe(false);
  });
});
