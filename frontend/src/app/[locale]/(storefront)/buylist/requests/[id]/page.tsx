import { SellRequestDetailView } from './SellRequestDetailView';

/**
 * **`/[locale]/buylist/requests/:id` — el destino del CTA del correo de la oferta.**
 *
 * ⚠️ **El `[locale]` no es decorativo.** El `routing` corre con `localePrefix: 'always'`, así que
 * `/buylist/requests/:id` **sin prefijo** no resuelve a esta pantalla. El resto de los correos del
 * proyecto ya construyen sus enlaces como `${origin}/<locale>/<path>` (ver `buildFrontendLink` en
 * el backend); el del ciclo de oferta es el único que salió sin prefijo, y por eso su variable de
 * entorno quedó deliberadamente vacía hasta que existiera esta ruta. **El path que el correo debe
 * apuntar es `/{locale}/buylist/requests/{sellRequestId}`**, con el `locale` del `User` — que es
 * el mismo con el que el backend renderiza el correo y `offer.terms`.
 *
 * `/buylist/requests/:id` es además ruta de la **API**, no de pantalla: no chocan porque el
 * frontend habla con el backend por `NEXT_PUBLIC_API_BASE_URL` (otro origen/prefijo), pero la
 * coincidencia de nombre es deliberada — el vendedor y el operador hablan del mismo objeto.
 */
export default async function SellRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SellRequestDetailView sellRequestId={id} />;
}
