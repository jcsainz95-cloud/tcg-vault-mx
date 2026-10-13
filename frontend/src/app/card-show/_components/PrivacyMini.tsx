import { CARD_SHOW } from '@/content/card-show';

/**
 * Aviso de privacidad SIMPLIFICADO (RONDA_0 §5.a), ≤120 palabras, va JUNTO a los formularios.
 * Lee los marcadores de `content/card-show.ts` (razón social, domicilio, organizador, versión):
 * mientras falten los datos se ven como huecos; se rellenan el día del anuncio, fuera del repo.
 * El enlace lleva al aviso INTEGRAL (tcghunt.mx/privacidad).
 *
 * ⛔ No menciona Cloudflare ni ningún captcha: la landing va sin Turnstile (§CARDSHOW.14).
 */
export function PrivacyMini() {
  const p = CARD_SHOW.privacidad;
  return (
    <p className="mt-4 text-[12px] leading-relaxed text-muted">
      <span className="eyebrow">Aviso de privacidad (resumen)</span>
      <br />
      TCG HUNT, operada por <strong>{p.razonSocial}</strong> (<strong>{p.domicilio}</strong>), tratará los datos que
      nos des en este formulario —tu correo y, en la preinscripción al torneo, nombre del jugador, Player ID y, si es
      menor, el consentimiento de su tutor— para avisarte del Card Show, gestionar tu preinscripción y enviarte
      información del evento y de TCG HUNT. Para el torneo, compartimos tus datos con <strong>{p.organizador}</strong>.
      Puedes negarte a recibir información promocional sin afectar tu registro. Consulta el aviso integral y cómo
      ejercer tus derechos ARCO en{' '}
      <a href={p.integralUrl} className="text-accent underline underline-offset-2">
        tcghunt.mx/privacidad
      </a>
      . Versión <strong>{p.version}</strong>.
    </p>
  );
}
