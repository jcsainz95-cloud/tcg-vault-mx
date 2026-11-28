import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { LanguageSegment } from './LanguageSegment';

/** §BUYLIST-ES §5/§6.9 · el segmento Inglés | Español muestra el monto de cada opción y no pide red. */
describe('LanguageSegment', () => {
  it('pinta el monto de cada opción y marca la elegida', () => {
    renderWithIntl(
      <LanguageSegment name="Charizard" language="en" offers={{ en: 50000, es: 42500 }} onChange={() => {}} />,
    );
    const en = screen.getByRole('button', { name: /Inglés/ });
    const es = screen.getByRole('button', { name: /Español/ });
    expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(es).toHaveAttribute('aria-pressed', 'false');
    expect(en.textContent).toContain('500.00');
    expect(es.textContent).toContain('425.00');
    expect(screen.getByRole('group', { name: 'Idioma de Charizard' })).toBeInTheDocument();
  });

  it('un toque en la otra opción avisa el idioma; la elegida no re-dispara', () => {
    const onChange = vi.fn();
    renderWithIntl(<LanguageSegment name="X" language="en" offers={{ en: 100, es: 80 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Inglés/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Español/ }));
    expect(onChange).toHaveBeenCalledWith('es');
  });

  it('opción sin oferta: «Sin oferta», apagada y nunca MX$0', () => {
    renderWithIntl(<LanguageSegment name="X" language="en" offers={{ en: 100, es: null }} onChange={() => {}} />);
    const es = screen.getByRole('button', { name: /Español/ });
    expect(es).toBeDisabled();
    expect(es.textContent).toContain('Sin oferta');
    expect(es.textContent).not.toContain('0.00');
  });

  it('EN: etiquetas en inglés', () => {
    renderWithIntl(<LanguageSegment name="X" language="es" offers={{ en: 100, es: 80 }} onChange={() => {}} />, 'en');
    expect(screen.getByRole('button', { name: /Spanish/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /English/ })).toBeInTheDocument();
  });
});
