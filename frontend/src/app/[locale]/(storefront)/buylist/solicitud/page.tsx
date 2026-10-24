import type { Metadata } from 'next';
import { SellRequestStepView } from './SellRequestStepView';

/** Paso con CLABE/INE: fuera de buscadores (como el detalle de una solicitud). Fuera de la medición: `routes.ts`. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function SellRequestStepPage() {
  return <SellRequestStepView />;
}
