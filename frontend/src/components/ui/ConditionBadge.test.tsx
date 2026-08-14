import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ConditionBadge } from './ConditionBadge';

describe('ConditionBadge (v1.1 — raw solo NM)', () => {
  it('muestra el nombre legible de NM y no el código pelón (ES)', () => {
    renderWithIntl(<ConditionBadge productType="raw" rawCondition="NM" />, 'es');
    expect(screen.getByText('Casi nueva (NM)')).toBeInTheDocument();
  });

  it('espeja el label en inglés', () => {
    renderWithIntl(<ConditionBadge productType="raw" rawCondition="NM" />, 'en');
    expect(screen.getByText('Near Mint (NM)')).toBeInTheDocument();
  });

  it('expone la descripción del estándar en title + aria-label y es focuseable (tooltip)', () => {
    const { container } = renderWithIntl(<ConditionBadge productType="raw" rawCondition="NM" />, 'es');
    const badge = container.querySelector('[tabindex="0"]') as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toContain('Como nueva');
    expect(badge.getAttribute('aria-label')).toContain('Casi nueva (NM)');
    expect(badge.getAttribute('aria-label')).toContain('Bordes limpios');
  });

  it('en compact colapsa a "NM" conservando el aria-label completo', () => {
    const { container } = renderWithIntl(
      <ConditionBadge productType="raw" rawCondition="NM" compact />,
      'es',
    );
    const badge = container.querySelector('[tabindex="0"]') as HTMLElement;
    expect(badge.textContent).toContain('NM');
    expect(badge.getAttribute('aria-label')).toContain('Casi nueva');
  });

  it('para sellado muestra "Sellado" + el subtipo localizado', () => {
    renderWithIntl(<ConditionBadge productType="sealed" sealedSubtype="etb" />, 'es');
    expect(screen.getByText('Sellado')).toBeInTheDocument();
    expect(screen.getByText('ETB')).toBeInTheDocument();
  });

  it('para graded muestra la compañía + grado', () => {
    renderWithIntl(<ConditionBadge productType="graded" gradingCompany="PSA" gradeValue="10" />, 'es');
    expect(screen.getByText(/PSA/)).toBeInTheDocument();
  });

  it('para graded con certNumber muestra "PSA 10 · #cert" y aria-label con el certificado (v1.2)', () => {
    const { container } = renderWithIntl(
      <ConditionBadge productType="graded" gradingCompany="PSA" gradeValue="10" certNumber="12345678" />,
      'es',
    );
    expect(screen.getByText(/PSA 10/)).toBeInTheDocument();
    expect(screen.getByText(/#12345678/)).toBeInTheDocument();
    const chip = container.querySelector('[aria-label*="12345678"]');
    expect(chip).toBeTruthy();
  });
});
