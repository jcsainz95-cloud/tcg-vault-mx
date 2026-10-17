/**
 * Recurso `.ics` del Card Show CDMX — lo enlaza el correo de bienvenida al visitante (backend C3-W):
 * `{publicBase}/card-show/card-show-cdmx.ics?...`. Vive FUERA del i18n (el middleware ya cubre los
 * subpaths de `/card-show/`).
 *
 * El cuerpo VCALENDAR lo construye `buildCardShowIcs` en `./ics-builder` (fichero HERMANO): Next.js no
 * admite exports extra en un `route.ts` y el build de producción falla si la función se exporta desde aquí.
 */
import { buildCardShowIcs } from './ics-builder';

export function GET(): Response {
  return new Response(buildCardShowIcs(), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="card-show-cdmx.ics"',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
