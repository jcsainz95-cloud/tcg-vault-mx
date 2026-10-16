/**
 * ⭐ v1.96⟨mkt-tienda⟩ (§E3) — inyecta un bloque JSON-LD en el HTML del SERVIDOR. `type="application/
 * ld+json"` no ejecuta JS, pero la CSP con nonce (`security/csp.ts`) gobierna TODO `<script>`: por eso
 * recibe el `nonce` de la petición (como el resto de scripts del layout). Un solo bloque con
 * `@graph` por ficha (Product+Offer, Organization, BreadcrumbList).
 *
 * El JSON se serializa escapando `<` para que una `</script>` dentro de un string (nombre de carta,
 * descripción) no cierre la etiqueta antes de tiempo (XSS clásico de JSON-LD).
 */
export function JsonLd({ data, nonce }: { data: Record<string, unknown>; nonce?: string }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // El contenido es JSON serializado por nosotros, con `<` escapado: no es HTML de usuario.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
