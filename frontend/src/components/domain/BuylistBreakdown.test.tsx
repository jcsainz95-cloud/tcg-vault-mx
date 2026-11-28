import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import type { BuylistBreakdownDTO } from '@/types/contract';
import { BuylistBreakdown } from './BuylistBreakdown';

const ES: BuylistBreakdownDTO = {
  marketMxnCents: 100000,
  languagePenalty: { pct: 15, cents: -15000 },
  adjustedMarketCents: 85000,
  curveBp: 7000,
  curveOfferCents: 59500,
  cap: null,
  source: 'curve',
  finalOfferCents: 59500,
};

describe('BuylistBreakdown · orden del dueño (§BUYLIST-ES §3)', () => {
  it('mercado → −idioma → ajustado → % de la curva → oferta, en ese orden', () => {
    renderWithIntl(<BuylistBreakdown breakdown={ES} />);
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(['market', 'language', 'adjusted', 'base', 'offer']);
    const txt = screen.getByTestId('buylist-breakdown').textContent ?? '';
    expect(txt).toContain('1,000.00');
    expect(txt).toContain('Idioma español −15 %');
    expect(txt).toContain('150.00');
    expect(txt).toContain('850.00');
    expect(txt).toContain('Curva de compra 70 %');
    expect(txt).toContain('Te pagamos');
    expect(txt).toContain('595.00');
  });

  it('castigo con «−» (U+2212), nunca guion ASCII; y curveBp null se pinta sin cifra', () => {
    renderWithIntl(<BuylistBreakdown breakdown={ES} />);
    expect(screen.getByTestId('buylist-breakdown').querySelector('[data-row="language"] dd')?.textContent).toBe('−MX$150.00');
  });

  it('curveBp null: fila sin «null» ni NaN', () => {
    renderWithIntl(<BuylistBreakdown audience="admin" breakdown={{ ...ES, curveBp: null, curveOfferCents: null }} />);
    const txt = screen.getByTestId('buylist-breakdown').textContent ?? '';
    expect(txt).toContain('Curva de compra');
    expect(txt).not.toMatch(/null|NaN/);
  });

  it('curvaBp no entero ⇒ «≈» y monto de la curva tal cual; sin multiplicar en el cliente', () => {
    renderWithIntl(<BuylistBreakdown audience="admin" breakdown={{ ...ES, curveBp: 6998, curveOfferCents: 59483, finalOfferCents: 59483 }} />);
    const row = screen.getByTestId('buylist-breakdown').querySelector('[data-row="base"]');
    expect(row?.textContent).toContain('Curva de compra ≈ 69.98 %');
    expect(row?.textContent).toContain('594.83');
  });

  it('cap en_offer: línea de tope tras la curva y oferta = tope', () => {
    renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, curveOfferCents: 59500, cap: { reason: 'en_offer', cents: 50000 }, finalOfferCents: 50000 }} />);
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(['market', 'language', 'adjusted', 'base', 'cap', 'offer']);
    expect(screen.getByText(/Tope: oferta en inglés/)).toBeInTheDocument();
  });

  it('cap floor: «Piso de compra»', () => {
    renderWithIntl(<BuylistBreakdown audience="admin" breakdown={{ ...ES, cap: { reason: 'floor', cents: 60000 }, finalOfferCents: 60000 }} />);
    expect(screen.getByText('Piso de compra')).toBeInTheDocument();
  });

  it('BES-4 cliente: tope «piso» ⇒ «Oferta mínima de la tienda», sin curveBp ni monto de tope; jamás una cifra de tope', () => {
    // DTO del cliente: sin `curveOfferCents` ni `cap.cents`; con `floor` el servidor manda `curveBp:null`.
    const floor = { ...ES, curveBp: null, curveOfferCents: null, cap: { reason: 'floor' as const }, finalOfferCents: 60000 };
    renderWithIntl(<BuylistBreakdown breakdown={floor} />);
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(['market', 'language', 'adjusted', 'cap', 'offer']);
    expect(screen.getByText('Oferta mínima de la tienda')).toBeInTheDocument();
    expect(screen.queryByText(/Piso de compra/)).toBeNull();
    expect(document.querySelector('[data-row="cap"] dd')).toBeNull();
    expect(screen.getByTestId('buylist-breakdown').textContent).not.toMatch(/null|NaN/);
  });

  it('BES-4 cliente: aunque llegara `cap.cents`/`curveOfferCents`, no se pintan (floor y en_offer)', () => {
    renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, curveBp: null, cap: { reason: 'floor', cents: 77777 }, finalOfferCents: 60000 }} />);
    expect(screen.getByTestId('buylist-breakdown').textContent).not.toContain('777.77');
    expect(screen.getByTestId('buylist-breakdown').textContent).not.toContain('595.00');
  });

  it('BES-4 cliente: tope inglés ⇒ el monto es su propia oferta final, no `cap.cents`', () => {
    renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, cap: { reason: 'en_offer', cents: 12345 }, finalOfferCents: 50000 }} />);
    const row = document.querySelector('[data-row="cap"]');
    expect(row?.textContent).toContain('500.00');
    expect(row?.textContent).not.toContain('123.45');
  });

  it('source override: precio fijo con castigo, sin fila de curva', () => {
    renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, source: 'override', curveBp: 10000, curveOfferCents: 85000, finalOfferCents: 85000 }} />);
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((r) => r.getAttribute('data-row'));
    expect(rows).toEqual(['fixed', 'language', 'offer']);
    expect(screen.getByText('Precio fijo')).toBeInTheDocument();
    expect(screen.queryByText('Mercado ajustado')).not.toBeInTheDocument();
  });

  it('mesa del dueño: la última fila dice «Oferta»', () => {
    renderWithIntl(<BuylistBreakdown breakdown={ES} offerLabel="offerAdmin" audience="admin" />);
    expect(screen.getByText('Oferta')).toBeInTheDocument();
  });

  it('línea en inglés (sin castigo) o sin desglose: no pinta nada', () => {
    const a = renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, languagePenalty: null }} />);
    expect(a.container.firstChild).toBeNull();
    const b = renderWithIntl(<BuylistBreakdown breakdown={undefined} />);
    expect(b.container.firstChild).toBeNull();
  });
});

describe('BuylistBreakdown · source bounty (M5)', () => {
  it('source «bounty» en línea EN (sin castigo) no pinta desglose', () => {
    renderWithIntl(<BuylistBreakdown breakdown={{ ...ES, languagePenalty: null, source: 'bounty' }} />);
    expect(screen.queryByTestId('buylist-breakdown')).not.toBeInTheDocument();
  });
});
