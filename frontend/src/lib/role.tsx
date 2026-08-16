'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { Role } from '@/types/contract';
import { config } from '@/lib/config';
import { useSession } from '@/lib/session';

interface RoleCtx {
  role: Role;
  setRole: (r: Role) => void;
  isSuperAdmin: boolean;
  /**
   * El selector "Ver como" (switcher de rol) solo existe en modo mock/demo. En
   * modo real el rol lo dicta la sesión y el backend es la autoridad, así que el
   * switcher se oculta.
   */
  canSwitchRole: boolean;
}

const Ctx = createContext<RoleCtx>({
  role: 'customer',
  setRole: () => {},
  isSuperAdmin: false,
  canSwitchRole: false,
});

/**
 * Contexto de rol de back-office.
 * - **Modo real** (`config.useMocks === false`): el rol = `role` del usuario de la
 *   SESIÓN (`useSession().user.role`); el backend deriva el rol del JWT (contrato
 *   §0) y es la autoridad. `setRole` es no-op y el switcher se oculta. Esto es
 *   defensa de UI: enmascara módulos/dinero saliente según el rol autenticado.
 * - **Modo mock/demo** (`config.useMocks !== false`): el rol es un dial local
 *   (localStorage) para poder demostrar el enmascarado financiero y las
 *   restricciones de dinero saliente (vault_operator vs super_admin) sin backend.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const [mockRole, setMockRole] = useState<Role>('super_admin');

  useEffect(() => {
    if (!config.useMocks) return;
    const stored = window.localStorage.getItem('tcg.role') as Role | null;
    if (stored) setMockRole(stored);
  }, []);

  function setRole(r: Role) {
    // En modo real el rol lo manda el backend: el switcher no existe y esto es no-op.
    if (!config.useMocks) return;
    setMockRole(r);
    window.localStorage.setItem('tcg.role', r);
  }

  const role: Role = config.useMocks ? mockRole : user?.role ?? 'customer';

  return (
    <Ctx.Provider
      value={{
        role,
        setRole,
        isSuperAdmin: role === 'super_admin',
        canSwitchRole: config.useMocks,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useRole() {
  return useContext(Ctx);
}
