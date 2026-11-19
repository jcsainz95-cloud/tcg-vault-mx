import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { OptionsView, initialRateId } from './QuoteViews';
import { quote } from './sdx-test-fixtures';

/** §ENV3.8: «Capturar guía» preselecciona lo cotizado al cliente y muestra lo cobrado contra el costo actual. */
function view(q: ReturnType<typeof quote>, selected: string | null, locale: 'es' | 'en' = 'es') {
  return renderWithProviders(
    <OptionsView
      quote={q}
      selected={selected}
      onSelect={vi.fn()}
      showBranch={false}
      onToggleBranch={vi.fn()}
      onRequote={vi.fn()}
      packages={null}
      packagesError={false}
      packageOpen={false}
      onTogglePackage={vi.fn()}
      onPackage={vi.fn()}
      pickReasonId="pick-reason"
    />,
    locale,
  );
}

describe('§ENV3.8 · initialRateId', () => {
  it('usa la tarifa que el servidor emparejó con lo cotizado; sin ella, la recomendada; sin customerQuote, la recomendada', () => {
    const q = quote();
    const other = q.rates.find((r) => r.rateId !== q.recommendedRateId && !r.hidden)!;
    const cq = { serviceCode: 'fedex_standard_overnight', serviceName: 'FedEx Standard Overnight', chargedCents: 22000, costQuotedCents: 20000, fallback: false };
    expect(initialRateId({ ...q, customerQuote: { ...cq, preselectedRateId: other.rateId } })).toBe(other.rateId);
    expect(initialRateId({ ...q, customerQuote: { ...cq, preselectedRateId: null } })).toBe(q.recommendedRateId);
    expect(initialRateId({ ...q, customerQuote: null })).toBe(q.recommendedRateId);
    expect(initialRateId(q)).toBe(q.recommendedRateId);
  });
});

describe('§ENV3.8 · nota «Cotizado al cliente»', () => {
  const q0 = quote();
  const rate = q0.rates.find((r) => !r.hidden)!;
  const base = { serviceCode: 'x', serviceName: 'FedEx Standard Overnight', chargedCents: 22000, preselectedRateId: rate.rateId, fallback: false };

  it('muestra lo cobrado, lo cotizado y el costo actual con la diferencia (más caro ⇒ aviso AG-26)', () => {
    const costQuoted = rate.priceCents - 3500;
    view({ ...q0, customerQuote: { ...base, costQuotedCents: costQuoted } }, rate.rateId);
    const note = screen.getByTestId('sdx-customer-quote');
    expect(note).toHaveTextContent('el cliente pagó MX$220.00 de envío');
    expect(note).toHaveTextContent('Costo actual de la opción marcada');
    expect(note).toHaveTextContent('MX$35.00 más que lo cotizado');
    expect(note).toHaveTextContent('el sistema avisa al dueño');
    expect(screen.queryByTestId('sdx-customer-quote-fallback')).toBeNull();
  });

  it('servicio de respaldo ⇒ lo dice; igual o menor ⇒ sin alarma (EN)', () => {
    view({ ...q0, customerQuote: { ...base, fallback: true, costQuotedCents: rate.priceCents + 1000 } }, rate.rateId, 'en');
    expect(screen.getByTestId('sdx-customer-quote-fallback')).toHaveTextContent('The quoted service is no longer available');
    expect(screen.getByTestId('sdx-customer-quote-current')).toHaveTextContent('MX$10.00 less than quoted.');
  });

  it('envío sin cotización v3 ⇒ no se pinta nada', () => {
    view(q0, rate.rateId);
    expect(screen.queryByTestId('sdx-customer-quote')).toBeNull();
  });
});
