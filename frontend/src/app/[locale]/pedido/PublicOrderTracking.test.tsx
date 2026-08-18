import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import type { GuestOrderTrackingDTO } from '@/types/contract';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { PublicOrderTracking } from './PublicOrderTracking';

/** DTO tal cual lo define el contrato §4-G.3 (incluidos los campos que NO se pintan). */
const DTO: GuestOrderTrackingDTO = {
  orderNumber: 'TCG-000123',
  status: 'preparando',
  placedAt: '2026-08-16T18:20:00.000Z',
  paidAt: '2026-08-16T18:21:10.000Z',
  emailMasked: 'j***@***.com',
  items: [
    {
      name: 'Blastoise',
      setName: 'Base Set',
      number: '2',
      finish: 'normal',
      productType: 'raw',
      rawCondition: 'NM',
      imageSmallUrl: 'https://images.pokemontcg.io/base1/2.png',
      unitPriceCents: 140800,
    },
  ],
  breakdown: {
    subtotalCents: 140800,
    shippingFeeCents: 17500,
    ivaCents: 25328,
    ivaRatePct: 16,
    processingFeeCents: 6800,
    totalCents: 190428,
    currency: 'MXN',
  },
  shipping: {
    city: 'Guadalajara',
    state: 'Jalisco',
    postalCodeMasked: '***45',
    recipientNameMasked: 'Juan P.',
  },
  payment: { brand: 'visa', last4: '4242' },
  claim: { available: true },
  support: { evidenceContact: 'soporte@tcgvaultmx.com', disputeWindowDays: 7 },
  tokenExpiresAt: '2026-11-14T18:20:00.000Z',
};

function renderTracking(data: GuestOrderTrackingDTO = DTO) {
  return renderWithProviders(
    <PublicOrderTracking
      data={data}
      updatedAt={new Date('2026-08-17T10:30:00.000Z')}
      isRefreshing={false}
      onRefresh={vi.fn()}
      onResendLink={vi.fn()}
    />,
    'es',
  );
}

describe('PublicOrderTracking · vista pública (criterios 50, 51)', () => {
  it('muestra número de pedido, estado, artículos y total pagado', () => {
    renderTracking();
    expect(screen.getByTestId('tracking-order-number')).toHaveTextContent('TCG-000123');
    expect(screen.getByTestId('tracking-status-label')).toHaveTextContent('PREPARANDO');
    expect(screen.getByText('Blastoise')).toBeInTheDocument();
    expect(screen.getByTestId('amount-breakdown')).toBeInTheDocument();
    expect(screen.getByText('Envío')).toBeInTheDocument();
  });

  it('sin guía todavía muestra PENDIENTE, y con guía muestra paquetería + número (criterio 50)', () => {
    const { unmount } = renderTracking();
    expect(screen.getByText('PENDIENTE')).toBeInTheDocument();
    unmount();

    renderTracking({
      ...DTO,
      status: 'enviado',
      shipping: { ...DTO.shipping, carrier: 'Estafeta', trackingNumber: '7712 4498 0021' },
    });
    expect(screen.getByText('Estafeta')).toBeInTheDocument();
    expect(screen.getByText('7712 4498 0021')).toBeInTheDocument();
  });

  it('DATOS MÍNIMOS: solo ciudad/estado y terminación de tarjeta (criterio 51)', () => {
    renderTracking();
    expect(screen.getByText('Envío a Guadalajara, Jalisco')).toBeInTheDocument();
    expect(screen.getByText('TARJETA ···· 4242')).toBeInTheDocument();

    // Prohibido: correo (ni enmascarado), destinatario, CP, dirección completa.
    expect(screen.queryByText(/j\*\*\*@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Juan P\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*\*45/)).not.toBeInTheDocument();
  });

  it('NO ofrece ninguna acción sensible: solo copiar, actualizar y reenviar (criterio 51)', () => {
    renderTracking();
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels).toEqual(
      expect.arrayContaining(['Copiar', 'Actualizar', 'Reenviar el enlace a mi correo']),
    );
    for (const forbidden of [/cancelar/i, /reembols/i, /cambiar dirección/i, /factura/i]) {
      expect(labels.some((l) => forbidden.test(l))).toBe(false);
    }
  });

  it('un pedido reembolsado no explica el proceso: versalita + línea de soporte', () => {
    renderTracking({ ...DTO, status: 'reembolsado' });
    expect(screen.getByTestId('tracking-status-label')).toHaveTextContent('REEMBOLSADO');
    expect(screen.getByText('Consulta con soporte citando tu número de pedido.')).toBeInTheDocument();
  });

  it('avisa que el enlace es TEMPORAL solo con el token de checkout de 120 min (§4-G.7a)', () => {
    // Enlace de correo (90 días): sin aviso.
    const { unmount } = renderTracking();
    expect(screen.queryByTestId('temporary-link-notice')).not.toBeInTheDocument();
    unmount();

    // Token de checkout (caduca dentro de 2 h): avisa y remite al correo, para que nadie
    // guarde esta URL como si fuera el enlace duradero.
    renderTracking({
      ...DTO,
      tokenExpiresAt: new Date(Date.now() + 90 * 60_000).toISOString(),
    });
    expect(screen.getByTestId('temporary-link-notice')).toBeInTheDocument();
    // Y la salida está a la vista: pedir un enlace nuevo.
    expect(screen.getByRole('button', { name: 'Reenviar el enlace a mi correo' })).toBeInTheDocument();
  });

  it('la disputa se atiende por correo a soporte citando el pedido (criterio 56b)', () => {
    renderTracking();
    expect(screen.getByTestId('evidence-email')).toHaveTextContent('soporte@tcgvaultmx.com');
  });
});
