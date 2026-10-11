import { M11View } from './M11View';

/**
 * M11 · Sellado (§diseño §1). A diferencia de M10/M2, la RUTA es `vault_operator+`: NO se envuelve
 * en `SuperAdminOnly`. El operador de bóveda usa las secciones (i)/(ii)/(iii) (alta, inventario,
 * cola); el panel de diales (iv) se gatea DENTRO de `M11View` con `SuperAdminOnly`. Defensa en
 * profundidad: el backend ya rechaza por rol (403) los endpoints de dinero.
 */
export default function M11Page() {
  return <M11View />;
}
