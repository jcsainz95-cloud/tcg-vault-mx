import type { Metadata } from 'next';
import { RouteMessages } from '@/components/i18n/RouteMessages';

/**
 * §PROV — portal privado de tiendas aliadas. ⛔ No se indexa (noindex en todas sus páginas), no está en
 * `sitemap.ts` ni en `llms.txt`, y `robots.ts` lo desautoriza (`/*\/proveedores`).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function SupplierRootLayout({ children }: { children: React.ReactNode }) {
  return <RouteMessages scope="storefront">{children}</RouteMessages>;
}
