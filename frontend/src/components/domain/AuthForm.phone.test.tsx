import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { AuthForm } from './AuthForm';

/** §CELULAR: el registro exige el celular (10 dígitos MX, mismo helper que el servidor). */
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const register = vi.fn();
vi.mock('@/lib/api', () => ({
  login: vi.fn(),
  register: (...a: unknown[]) => register(...a),
  loginWithGoogle: vi.fn(),
}));

function fill(phone: string) {
  fireEvent.change(screen.getByLabelText(/Correo/), { target: { value: 'a@b.mx' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Abcdef123!' } });
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ash' } });
  fireEvent.change(screen.getByLabelText('Celular (10 dígitos)'), { target: { value: phone } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
}

beforeEach(() => register.mockReset());

describe('AuthForm — registro con celular obligatorio', () => {
  it('el campo es obligatorio y lleva el prefijo +52', () => {
    renderWithIntl(<AuthForm mode="register" />, 'es');
    const f = screen.getByLabelText('Celular (10 dígitos)');
    expect(f).toBeRequired();
    expect(screen.getByText('+52')).toBeInTheDocument();
  });

  it('celular inválido: error en línea y NO llama a register', async () => {
    renderWithIntl(<AuthForm mode="register" />, 'es');
    fill('123');
    expect(await screen.findByText('Escribe tu celular de 10 dígitos')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('celular falso (0000000000) tampoco pasa', async () => {
    renderWithIntl(<AuthForm mode="register" />, 'es');
    fill('0000000000');
    expect(await screen.findByText('Escribe tu celular de 10 dígitos')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('celular pegado con +52 viaja normalizado a 10 dígitos (sin recortes del navegador)', async () => {
    register.mockResolvedValue({ user: { role: 'customer', phoneRequired: false } });
    renderWithIntl(<AuthForm mode="register" />, 'es');
    fill('+52 55-1234-5678');
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0]![0]).toMatchObject({ phone: '5512345678' });
  });
});
