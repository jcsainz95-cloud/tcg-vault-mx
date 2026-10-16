import { CARD_SHOW } from '@/content/card-show';

/**
 * Aviso de privacidad SIMPLIFICADO (RONDA_0 §5.a), va JUNTO a los formularios y enlaza al aviso
 * INTEGRAL que YA está live (⛔ decisión JC: NO se redacta uno nuevo; la versión final se revisa con
 * product-owner). Solo nombra TCG HUNT y Jakomi (marcas públicas).
 *
 * ⛔ No menciona Cloudflare ni ningún captcha: la landing va sin Turnstile (§CARDSHOW.14).
 */
export function PrivacyMini() {
  return (
    <p className="mt-4 text-[12px] leading-relaxed text-muted">
      <span className="eyebrow">Aviso de privacidad (resumen)</span>
      <br />
      TCG HUNT usa los datos que nos das en este formulario —tu correo y, en la preinscripción al torneo, el nombre
      del jugador, el Player ID y, si es menor, el consentimiento de su tutor— para avisarte del Card Show, gestionar
      tu preinscripción y enviarte información del evento y de TCG HUNT. Para el torneo compartimos tus datos con{' '}
      <strong>Jakomi</strong>. Puedes negarte a recibir información promocional sin afectar tu registro. Consulta el
      aviso integral y cómo ejercer tus derechos ARCO en{' '}
      <a href={CARD_SHOW.footer.privacidadUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
        tcghunt.mx/es/privacidad
      </a>
      .
    </p>
  );
}
