'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { Role } from '@/types/contract';

interface RoleCtx {
  role: Role;
  setRole: (r: Role) => void;
  isSuperAdmin: boolean;
}

const Ctx = createContext<RoleCtx>({ role: 'super_admin', setRole: () => {}, isSuperAdmin: true });

/**
 * Contexto de rol de back-office. MOCK: el backend deriva el rol del JWT
 * (contrato §0). Aquí se simula para demostrar el enmascarado financiero y las
 * restricciones de dinero saliente (vault_operator vs super_admin).
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>('super_admin');

  useEffect(() => {
    const stored = window.localStorage.getItem('tcg.role') as Role | null;
    if (stored) setRoleState(stored);
  }, []);

  function setRole(r: Role) {
    setRoleState(r);
    window.localStorage.setItem('tcg.role', r);
  }

  return (
    <Ctx.Provider value={{ role, setRole, isSuperAdmin: role === 'super_admin' }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRole() {
  return useContext(Ctx);
}
