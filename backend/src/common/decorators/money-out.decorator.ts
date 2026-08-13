import { SetMetadata } from '@nestjs/common';

export const MONEY_OUT_KEY = 'moneyOut';

/**
 * Marca una acción como "dinero saliente" (pago SPEI de buylist, reembolso, recompra).
 * El MoneyOutGuard exige `super_admin`; cualquier otro rol recibe 403 MONEY_OUT_FORBIDDEN
 * y el intento queda auditado. ARCHITECTURE §5, §7; PROJECT criterio 26.
 */
export const MoneyOut = () => SetMetadata(MONEY_OUT_KEY, true);
