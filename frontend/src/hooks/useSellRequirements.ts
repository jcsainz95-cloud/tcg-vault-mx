'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/session';
import { getKyc } from '@/lib/api';
import type { KycInfoDTO } from '@/types/contract';

/**
 * Estado agregado de los REQUISITOS de cuenta para vender (crear solicitud de buylist).
 *
 * El backend es la autoridad (guards JwtAuthGuard→RolesGuard→EmailVerifiedGuard sobre
 * POST /buylist/requests, contrato §6); este hook solo COMUNICA los requisitos ANTES
 * de que el usuario llene todo, para que no descubra el bloqueo con un 403 al final:
 * - sesión (401 UNAUTHENTICATED),
 * - correo verificado (403 EMAIL_NOT_VERIFIED),
 * - CLABE registrada / INE esperado (GET /users/me/kyc: clabeMasked, ineOnFile, topes).
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
  /** hay CLABE registrada en KYC (`clabeMasked` presente). El contrato §6 igual pide capturarla al enviar. */
  clabeOnFile: boolean;
  clabeMasked?: string;
  ineOnFile: boolean;
  /**
   * Heads-up de cliente: el total ESTIMADO supera el tope por solicitud (o el remanente
   * mensual) y no hay INE en archivo → el backend pedirá INE (422 INE_REQUIRED).
   * La decisión autoritativa es SIEMPRE server-side (SEC-A1); esto solo avisa antes.
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
    queryFn: getKyc,
    enabled: kycEnabled,
    staleTime: 60_000,
  });
  const kyc = kycQuery.data;

  const emailBlocked = ready && isAuthenticated && user?.emailVerified === false;
  const ineOnFile = kyc?.ineOnFile ?? false;
  const overCaps =
    !!kyc &&
    totalEstimatedCents > 0 &&
    (totalEstimatedCents > kyc.capPerRequestCents ||
      kyc.monthUsedCents + totalEstimatedCents > kyc.capPerMonthCents);

  return {
    ready,
    isAuthenticated,
    emailVerified: user?.emailVerified,
    emailBlocked,
    kyc,
    kycLoading: kycEnabled && kycQuery.isLoading,
    clabeOnFile: !!kyc?.clabeMasked,
    clabeMasked: kyc?.clabeMasked,
    ineOnFile,
    ineExpected: overCaps && !ineOnFile,
    canSubmit: ready && isAuthenticated && !emailBlocked,
  };
}
