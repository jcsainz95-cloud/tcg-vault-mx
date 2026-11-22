import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import es from '../../../../../../messages/es.json';
import { SellerContact, normalizeWhatsappMx } from './SellerContact';

const wrap = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('normalizeWhatsappMx', () => {
  it.each([
    ['5512345678', '525512345678'],
    ['55 1234-5678', '525512345678'],
    ['+52 55 1234 5678', '525512345678'],
    ['525512345678', '525512345678'],
    ['+52 1 55 1234 5678', '525512345678'],
    ['(33) 1234 5678', '523312345678'],
  ])('%s -> %s', (raw, out) => expect(normalizeWhatsappMx(raw)).toBe(out));
  it.each([null, undefined, '', '12345', 'abc'])('%s -> null', (raw) => expect(normalizeWhatsappMx(raw)).toBeNull());
});

describe('SellerContact', () => {
  const seller = { name: 'Diana', email: 'd@example.mx', phone: '55 1234 5678' };
  it('con teléfono: tel: y WhatsApp', () => {
    wrap(<SellerContact seller={seller} />);
    expect(screen.getByText('55 1234 5678').closest('a')).toHaveAttribute('href', 'tel:5512345678');
    expect(screen.getByText('WhatsApp').closest('a')).toHaveAttribute('href', 'https://wa.me/525512345678');
  });
  it('sin teléfono: aviso y mailto', () => {
    wrap(<SellerContact seller={{ ...seller, phone: null }} />);
    expect(screen.getByText('Sin teléfono registrado')).toBeInTheDocument();
    expect(screen.getByText('Correo').closest('a')).toHaveAttribute('href', 'mailto:d@example.mx');
    expect(screen.queryByText('WhatsApp')).toBeNull();
  });
  it('sin teléfono propio pero con el del domicilio: lo marca', () => {
    wrap(<SellerContact seller={{ ...seller, phone: null }} pickupPhone="5598765432" />);
    expect(screen.getByText('(de su dirección)')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp').closest('a')).toHaveAttribute('href', 'https://wa.me/525598765432');
  });
});
