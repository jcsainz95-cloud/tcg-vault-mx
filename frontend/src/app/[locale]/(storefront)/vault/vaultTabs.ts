/**
 * Constantes compartidas entre la bóveda y el flujo de retiro (§33.4):
 * - `?tab=retiros` hace direccionable la pestaña «Retiros» de `/vault` (la enlazan el detalle del
 *   retiro, el aviso de reclamables y el propio flujo de solicitar).
 * - Tras pagar un retiro, `/shipments` navega a `/vault?tab=retiros` y deja esta marca en
 *   `sessionStorage`; la bóveda la consume UNA vez y pinta «Retiro solicitado. Aquí verás su
 *   avance.» (`role="status"`). Va en sessionStorage y no en la URL para que un marcador o una
 *   recarga no repitan un aviso de algo que ya no acaba de pasar.
 */
export const VAULT_WITHDRAWALS_TAB = 'retiros';
export const VAULT_WITHDRAWALS_HREF = `/vault?tab=${VAULT_WITHDRAWALS_TAB}`;
export const WITHDRAWAL_REQUESTED_KEY = 'tcg.vault.withdrawalRequested';
