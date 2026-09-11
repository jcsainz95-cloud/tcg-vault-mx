'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/session';
import { getKyc } from '@/lib/api';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { KycInfoDTO } from '@/types/contract';

/**
 * Estado agregado de los REQUISITOS de cuenta para vender (crear solicitud de buylist).
 *
 * El backend es la autoridad (guards JwtAuthGuard→RolesGuard→EmailVerifiedGuard sobre
 * POST /buylist/requests, contrato §6); este hook solo COMUNICA los requisitos ANTES
 * de que el usuario llene todo, para que no descubra el bloqueo con un 403 al final:
 * - sesión (401 UNAUTHENTICATED),
 * - correo verificado (403 EMAIL_NOT_VERIFIED),
 * - CLABE registrada / INE esperado (GET /users/me/kyc: clabeMasked, ineOnFile, y el VEREDICTO
 *   `ineRequiredForTotal` — ⛔ ya no hay topes que comparar aquí, §M6-K.5).
 */
export interface SellRequirements {
  /** `false` durante SSR y el primer render de cliente (patrón useSession): no pintar gating aún. */
  ready: boolean;
  isAuthenticated: boolean;
  /** `emailVerified` de la sesión (puede venir undefined en sesiones viejas → no se asume). */
  emailVerified?: boolean;
  /** true SOLO cuando la sesión trae `emailVerified === false` (espeja VerifyEmailBanner). */
  emailBlocked: boolean;
  /** KYC del contrato GET /users/me/kyc (solo customers; staff no consulta ese endpoint). */
  kyc?: KycInfoDTO;
  kycLoading: boolean;
  /**
   * v1.15: hay CLABE en archivo (booleano REAL `clabeOnFile` de GET /users/me/kyc). Habilita el atajo
   * "usar mi CLABE ****1234" (= OMITIR `clabe` en POST /buylist/requests, fallback server-side).
   */
  clabeOnFile: boolean;
  clabeMasked?: string;
  ineOnFile: boolean;
  /**
   * Heads-up de cliente: **el servidor dice** que con este total se va a exigir INE
   * (`ineRequiredForTotal`) y no hay INE en archivo → el backend pedirá INE (422 INE_REQUIRED).
   *
   * ⭐ v1.69 (P-78, §M6-K.5 · DESIGN_SYSTEM §34.9): **la comparación se SUSTITUYE, no se rompe.**
   * Antes el navegador comparaba `total > capPerRequestCents || monthUsed + total > capPerMonth`
   * —los tres números viajaban al cliente y §P.2.2 se sostenía sobre ellos—; ahora viaja
   * `?quotedTotalCents=N` y vuelve **un sí/no**. §P.2.2 **no se pierde**: se le sigue pidiendo la
   * INE **en el mismo paso en que captura su dirección**, no como un `422` sorpresa al final. Lo
   * que cambia es de dónde sale el veredicto — y que **el umbral ya no se le puede leer a nadie**.
   *
   * ⛔ **No hay booleano equivalente para el tope MENSUAL** (§M6-K.5): ése rechaza y no se remedia
   * subiendo nada, así que sigue apareciendo solo como `422` al enviar. ⛔ Y no se reconstruye el
   * umbral repitiendo la llamada: la decisión autoritativa es SIEMPRE server-side (SEC-A1).
   */
  ineExpected: boolean;
  /** habilita el CTA "Enviar solicitud": sesión activa y correo no bloqueado. */
  canSubmit: boolean;
}

export function useSellRequirements(totalEstimatedCents = 0): SellRequirements {
  const { user, isAuthenticated, ready } = useSession();

  // GET /users/me/kyc es de rol `customer` (contrato §1); para staff (vault_operator /
  // super_admin, que también pueden crear solicitudes) no se consulta para no provocar 403.
  const kycEnabled = ready && isAuthenticated && user?.role === 'customer';
  const kycQuery = useQuery({
    queryKey: ['kyc'],
    queryFn: () => getKyc(),
    enabled: kycEnabled,
    staleTime: 60_000,
  });
  const kyc = kycQuery.data;

  /**
   * ⭐ **El veredicto del servidor, en su PROPIA consulta** (§M6-K.5 · `?quotedTotalCents=N`).
   * Dos decisiones, y las dos salieron de medir:
   *
   * 1. **Llave aparte, no `['kyc', total]`.** El total cambia con cada carta del carrito; si
   *    formara parte de la llave de la lectura general, **toda** la lista de requisitos volvería a
   *    «Consultando el estado de tu cuenta…» en cada cambio. Medido: con la llave compartida, dos
   *    casos de `BuylistView.test` dejaban de encontrar el modal de la solicitud.
   * 2. **Debounce** (patrón P-5, ya en este código para lo mismo): sin él sería **un fetch por
   *    clic** en el selector de cantidad.
   *
   * `enabled` solo con total > 0: ⛔ no se le pregunta al servidor por un carrito vacío.
   */
  const debouncedTotalCents = useDebouncedValue(totalEstimatedCents, 400);
  const ineVerdictQuery = useQuery({
    queryKey: ['kyc-ine-required', debouncedTotalCents],
    queryFn: () => getKyc({ quotedTotalCents: debouncedTotalCents }),
    enabled: kycEnabled && debouncedTotalCents > 0,
    staleTime: 60_000,
  });

  const emailBlocked = ready && isAuthenticated && user?.emailVerified === false;
  const ineOnFile = kyc?.ineOnFile ?? false;

  return {
    ready,
    isAuthenticated,
    emailVerified: user?.emailVerified,
    emailBlocked,
    kyc,
    kycLoading: kycEnabled && kycQuery.isLoading,
    // v1.15: booleano REAL del contrato (`clabeOnFile`, requerido en GET /users/me/kyc). `?? false`
    // solo cubre el estado "sin KYC cargado aún" (kyc undefined), no un backend parcial.
    clabeOnFile: kyc?.clabeOnFile ?? false,
    clabeMasked: kyc?.clabeMasked,
    ineOnFile,
    // ⚠️ `?? false` = «el servidor no ha contestado todavía» (o no se le preguntó porque el
    // carrito está vacío): **no se avisa de un requisito que nadie ha afirmado**.
    ineExpected: (ineVerdictQuery.data?.ineRequiredForTotal ?? false) && !ineOnFile,
    canSubmit: ready && isAuthenticated && !emailBlocked,
  };
}
