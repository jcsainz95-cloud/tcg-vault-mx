import { config } from '@/lib/config';
import { SUPPORT_CONTACT_FALLBACK } from '../checkout/support-contact';

/**
 * El buzón para los términos (DESIGN_SYSTEM §60.1 d · contrato v1.82 §PNL.1): página de servidor ⇒
 * `fetch` a `GET /support/contact` con `revalidate: 300` (el `max-age` del contrato). Cualquier
 * fallo (red, no-2xx, cuerpo sin `contact`) ⇒ el valor de respaldo. En modo mock no hay API: respaldo.
 */
export async function fetchSupportContactForServer(): Promise<string> {
  if (config.useMocks) return SUPPORT_CONTACT_FALLBACK;
  try {
    const res = await fetch(`${config.apiBaseUrl}/support/contact`, { next: { revalidate: 300 } });
    if (!res.ok) return SUPPORT_CONTACT_FALLBACK;
    const body = (await res.json()) as { contact?: unknown };
    return typeof body.contact === 'string' && body.contact.trim() ? body.contact.trim() : SUPPORT_CONTACT_FALLBACK;
  } catch {
    return SUPPORT_CONTACT_FALLBACK;
  }
}
