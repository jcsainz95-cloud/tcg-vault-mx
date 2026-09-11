import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { ApiClientError } from '@/lib/api-client';
import { PasswordForm } from './PasswordForm';

const changePassword = vi.fn();
vi.mock('@/lib/api', () => ({ changePassword: (...a: unknown[]) => changePassword(...a) }));

function renderForm(over: Partial<React.ComponentProps<typeof PasswordForm>> = {}) {
  const onSuccess = vi.fn();
  const onPasswordNotSet = vi.fn();
  renderWithIntl(
    <PasswordForm
      currentLabel="Contraseña actual"
      submitLabel="Cambiar contraseña"
      submittingLabel="Cambiando…"
      onSuccess={onSuccess}
      onPasswordNotSet={onPasswordNotSet}
      {...over}
    />,
    'es',
  );
  return { onSuccess, onPasswordNotSet };
}

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña nueva'), { target: { value: confirm } });
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

/** DESIGN_SYSTEM §33.7 variante A + códigos 422 del contrato v1.67 (`API_CONTRACT.md:4715-4726`). */
describe('PasswordForm · validación en submit y mapeo de errores', () => {
  // ⚠ Sin `beforeEach(mockReset/mockClear)`: con vitest 5, un hook que toca el spy seguido de
  // `mockRejectedValue()` en el test deja un rechazo que vitest atribuye al test aunque el
  // componente lo capture (medido: 4/4 rojos con hook, 0/4 sin él). Cada caso fija su
  // implementación y compara el conteo de llamadas contra el de su arranque.
  const calls = () => changePassword.mock.calls.length;

  it('el botón solo se habilita con los tres campos no vacíos', () => {
    renderForm();
    const btn = screen.getByRole('button', { name: 'Cambiar contraseña' });
    expect(btn).toBeDisabled();
    fill('temp', 'nueva-larga', 'nueva-larga');
    expect(btn).toBeEnabled();
  });

  it('< 8 caracteres → error en «Contraseña nueva» con aria-invalid/aria-describedby y foco; no llama a la API', () => {
    const before = calls();
    renderForm();
    fill('temp', 'corta', 'corta');
    submit();
    const field = screen.getByLabelText('Contraseña nueva');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('La contraseña debe tener al menos 8 caracteres.');
    expect(field).toHaveFocus();
    expect(calls()).toBe(before);
  });

  it('nueva ≠ confirmación → error en el campo 3', () => {
    const before = calls();
    renderForm();
    fill('temp', 'nueva-larga', 'otra-larga');
    submit();
    expect(screen.getByLabelText('Confirmar contraseña nueva')).toHaveAccessibleDescription('Las contraseñas no coinciden.');
    expect(calls()).toBe(before);
  });

  it('nueva = actual → «distinta de la actual» en el campo 2', () => {
    renderForm();
    fill('misma-larga', 'misma-larga', 'misma-larga');
    submit();
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAccessibleDescription(
      'La contraseña nueva debe ser distinta de la actual.',
    );
  });

  it('422 CURRENT_PASSWORD_INCORRECT → campo 1 con el copy del catálogo, sin navegar', async () => {
    changePassword.mockRejectedValue(
      new ApiClientError(422, { code: 'CURRENT_PASSWORD_INCORRECT', message: 'nope', details: { field: 'currentPassword' } }),
    );
    renderForm();
    fill('wrong-temp', 'nueva-larga', 'nueva-larga');
    submit();
    await waitFor(() =>
      expect(screen.getByLabelText('Contraseña actual')).toHaveAccessibleDescription('La contraseña actual no es correcta.'),
    );
    expect(screen.getByLabelText('Contraseña actual')).toHaveFocus();
  });

  it('422 PASSWORD_SAME_AS_CURRENT del servidor → campo 2', async () => {
    changePassword.mockRejectedValue(
      new ApiClientError(422, { code: 'PASSWORD_SAME_AS_CURRENT', message: 'same', details: { field: 'newPassword' } }),
    );
    renderForm();
    fill('a-temporal', 'nueva-larga', 'nueva-larga');
    submit();
    await waitFor(() =>
      expect(screen.getByLabelText('Contraseña nueva')).toHaveAccessibleDescription(
        'La contraseña nueva debe ser distinta de la actual.',
      ),
    );
  });

  it('429 RATE_LIMITED → banner warning «Demasiados intentos»', async () => {
    changePassword.mockRejectedValue(new ApiClientError(429, { code: 'RATE_LIMITED', message: 'slow' }));
    renderForm();
    fill('a-temporal', 'nueva-larga', 'nueva-larga');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos. Espera un minuto.');
  });

  it('422 PASSWORD_NOT_SET → avisa a la página (cambia a «Crear») sin pintar error de campo', async () => {
    changePassword.mockRejectedValue(new ApiClientError(422, { code: 'PASSWORD_NOT_SET', message: 'none' }));
    const { onPasswordNotSet } = renderForm();
    fill('x-temporal', 'nueva-larga', 'nueva-larga');
    submit();
    await waitFor(() => expect(onPasswordNotSet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('200 → onSuccess con la respuesta y los campos vacíos', async () => {
    const res = { ok: true, accessToken: 'a2', refreshToken: 'r2' };
    changePassword.mockResolvedValue(res);
    const { onSuccess } = renderForm();
    fill('a-temporal', 'nueva-larga', 'nueva-larga');
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(res));
    expect(changePassword).toHaveBeenLastCalledWith({ currentPassword: 'a-temporal', newPassword: 'nueva-larga' });
    expect(screen.getByLabelText('Contraseña nueva')).toHaveValue('');
  });

  it('no añade reglas de complejidad ni «mostrar contraseña» (§33.15.7)', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: /mostrar/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('minlength', '8');
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Contraseña actual')).toHaveAttribute('autocomplete', 'current-password');
  });
});
