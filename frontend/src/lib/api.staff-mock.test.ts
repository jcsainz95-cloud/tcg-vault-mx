import { describe, it, expect, beforeEach } from 'vitest';
import { createAdminUser, login } from './api';
import { ApiClientError } from './api-client';

/**
 * Rama MOCK del equipo sin correo (`API_CONTRACT §M6-U.2`, `§M6-U.6`): el servidor falso tiene que
 * hablar como el real en lo que la UI y los E2E de mocks leen.
 */
describe('api · mocks del equipo sin correo', () => {
  beforeEach(() => window.localStorage.clear());

  it('TD-5 (techlead sobre da6d910e): `409 USERNAME_TAKEN` lleva `details.field = "username"`, como el servidor real', async () => {
    const err = await createAdminUser({ name: 'Otro Luis', role: 'vault_operator', username: 'Luis.P' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(409);
    expect((err as ApiClientError).code).toBe('USERNAME_TAKEN');
    expect((err as ApiClientError).details).toEqual({ field: 'username' });
  });

  it('STF-17-E2E (mock): `ana` / `JEFA ` entran como staff SIN correo, con la temporal pendiente', async () => {
    const ana = await login({ email: 'ana', password: 'cualquiera' });
    expect(ana.user).toMatchObject({ email: null, username: 'ana', role: 'vault_operator', mustChangePassword: true, emailVerified: false });
    const jefa = await login({ email: 'JEFA ', password: 'cualquiera' });
    expect(jefa.user).toMatchObject({ email: null, username: 'jefa', role: 'super_admin', mustChangePassword: true });
  });

  it('con `@` sigue siendo un correo (la rama de siempre), aunque el usuario coincida', async () => {
    const res = await login({ email: 'ana@example.com', password: 'cualquiera' });
    expect(res.user.email).toBe('ana@example.com');
    expect(res.user.role).toBe('customer');
  });
});
