/**
 * tournament.util.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.12, L0-SEG-02).
 *
 * El cupo del torneo se asigna **AL CONFIRMAR, por orden** (⛔ no al registrar): N altas PENDING no
 * mueven el cupo; al confirmar se reparten CONFIRMED hasta el cupo y el resto WAITLIST. Esta función
 * es la decisión PURA; la reserva ATÓMICA (dos confirmaciones simultáneas por el último lugar ⇒ 1
 * CONFIRMED + 1 WAITLIST, nunca 3) la hace `CardShowService` dentro de una transacción serializable
 * contando las filas activas CONFIRMED del día.
 */
import { CardShowSignupStatus } from '@prisma/client';

/**
 * Dado cuántas preinscripciones CONFIRMED hay ya para ese día y el cupo (null ⇒ cupo desconocido/no
 * recortado), decide el estado de la que se confirma ahora.
 */
export function assignOnConfirm(currentConfirmed: number, capPerDay: number | null): CardShowSignupStatus {
  if (capPerDay === null) return CardShowSignupStatus.confirmed; // cupo desconocido ⇒ no se recorta
  return currentConfirmed < capPerDay ? CardShowSignupStatus.confirmed : CardShowSignupStatus.waitlist;
}

/** Últimos 4 dígitos del Player ID para el correo («terminado en NNNN»). ⛔ nunca el completo. */
export function playerIdLast4(playerId: string): string {
  const digits = playerId.replace(/\D/g, '');
  return digits.slice(-4);
}
