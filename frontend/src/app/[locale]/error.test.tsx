/**
 * LIVE-7 (API_CONTRACT §14.7) — `app/[locale]/error.tsx` y `app/global-error.tsx`:
 * muestran el estado de error y llaman a `POST /telemetry/client-error` UNA vez por error mostrado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { StrictMode, type ReactNode } from 'react';
import { renderWithIntl } from '@/test/render';
import es from '../../../messages/es.json';

const report = vi.fn().mockResolvedValue(undefined);
vi.mock('../report-client-error', () => ({ reportClientError: (...a: unknown[]) => report(...a) }));

import LocaleError from './error';
import GlobalError from '../global-error';

beforeEach(() => {
  report.mockClear();
  window.history.replaceState(null, '', '/es/checkout?step=2');
});
afterEach(() => window.history.replaceState(null, '', '/'));

describe('[locale]/error.tsx', () => {
  it('muestra el título y el texto de error del catálogo común, y «Reintentar» llama a reset', () => {
    const reset = vi.fn();
    renderWithIntl(<LocaleError error={Object.assign(new Error('boom'), { digest: 'D1' })} reset={reset} />);
    expect(screen.getByRole('heading', { name: 'Algo salió mal' })).toBeInTheDocument();
    expect(screen.getByText('No se pudo cargar la información.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('en inglés', () => {
    renderWithIntl(<LocaleError error={new Error('boom')} reset={() => {}} />, 'en');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('reporta una vez por error, con la ruta actual (la query la recorta el reportador)', () => {
    const err = Object.assign(new Error('boom'), { digest: 'D1' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="es" messages={es}>
        {children}
      </NextIntlClientProvider>
    );
    const { rerender } = render(<LocaleError error={err} reset={() => {}} />, { wrapper });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(err, '/es/checkout?step=2');
    rerender(<LocaleError error={err} reset={() => {}} />);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('StrictMode (doble efecto en desarrollo) ⇒ sigue siendo UN reporte', () => {
    const err = new Error('boom');
    renderWithIntl(
      <StrictMode>
        <LocaleError error={err} reset={() => {}} />
      </StrictMode>,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('un error NUEVO (tras reintentar) sí se reporta', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="es" messages={es}>
        {children}
      </NextIntlClientProvider>
    );
    const { rerender } = render(<LocaleError error={new Error('a')} reset={() => {}} />, { wrapper });
    rerender(<LocaleError error={new Error('b')} reset={() => {}} />);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('⛔ no pinta el mensaje crudo del error (puede traer datos internos)', () => {
    renderWithIntl(<LocaleError error={new Error('SELECT * FROM users')} reset={() => {}} />);
    expect(screen.queryByText(/SELECT/)).toBeNull();
  });
});

describe('global-error.tsx', () => {
  it('pinta su propio <html>, ofrece reintentar y reporta una vez', () => {
    const reset = vi.fn();
    const err = new Error('root boom');
    // global-error sustituye al layout raíz: trae <html>/<body> propios. En jsdom se monta en un
    // <div> (React avisa del anidamiento; en Next es la raíz del documento).
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GlobalError error={err} reset={reset} />);
    spy.mockRestore();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(err, '/es/checkout?step=2');
    fireEvent.click(screen.getByRole('button'));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/root boom/)).toBeNull();
  });
});
