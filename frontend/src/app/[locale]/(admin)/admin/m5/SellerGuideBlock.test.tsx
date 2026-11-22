import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../../messages/es.json';
import type { AdminInboundShipmentDTO } from '@/types/contract';

const openLabelPdf = vi.fn();
vi.mock('../m4/capture/label-pdf', () => ({ openLabelPdf: (...a: unknown[]) => openLabelPdf(...a) }));
import { SellerGuideBlock, hasSellerGuide } from './SellerGuideBlock';

const base: AdminInboundShipmentDTO = {
  id: 'sh-1', folio: 'ENV-1', status: 'guia', labelSource: 'skydropx', labelProcessing: false,
  carrier: 'Paquetexpress', trackingNumber: 'PQX123', trackingUrl: 'https://track.example/PQX123',
  costCents: 25000, costIvaCents: 0, insuranceCostCents: 0, providerCanceledAt: null, cancelConfirmed: false,
};
const wrap = (i: AdminInboundShipmentDTO) =>
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      <SellerGuideBlock requestId="SR-1" inbound={i} />
    </NextIntlClientProvider>,
  );

describe('SellerGuideBlock', () => {
  beforeEach(() => openLabelPdf.mockReset().mockResolvedValue(undefined));

  it('skydropx: paquetería, número, rastreo y PDF', async () => {
    wrap(base);
    expect(screen.getByText('Paquetexpress')).toBeInTheDocument();
    expect(screen.getByText('PQX123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver rastreo' })).toHaveAttribute('href', 'https://track.example/PQX123');
    fireEvent.click(screen.getByRole('button', { name: 'Ver / imprimir guía (PDF)' }));
    await waitFor(() => expect(openLabelPdf).toHaveBeenCalledWith('sh-1', 'ENV-1', 'print'));
  });

  it('manual: sin botón de PDF, con aviso y número visibles', () => {
    wrap({ ...base, labelSource: 'manual', trackingUrl: null });
    expect(screen.getByText('Guía capturada a mano')).toBeInTheDocument();
    expect(screen.getByText('PQX123')).toBeInTheDocument();
    expect(screen.getByText('Paquetexpress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver / imprimir guía (PDF)' })).toBeNull();
  });

  it('cancelada: lo indica y no ofrece PDF', () => {
    wrap({ ...base, status: 'cancelado', providerCanceledAt: '2026-11-01T10:00:00Z' });
    expect(screen.getByTestId('seller-guide-canceled')).toHaveTextContent('Guía cancelada');
    expect(screen.queryByRole('button', { name: 'Ver / imprimir guía (PDF)' })).toBeNull();
  });

  it('hasSellerGuide: no aparece mientras la guía está solo solicitada', () => {
    expect(hasSellerGuide({ ...base, status: 'solicitado' })).toBe(false);
    expect(hasSellerGuide(null)).toBe(false);
    expect(hasSellerGuide(base)).toBe(true);
  });
});
