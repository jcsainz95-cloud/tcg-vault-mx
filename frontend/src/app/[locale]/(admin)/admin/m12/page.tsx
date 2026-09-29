import { M12View } from './M12View';

/**
 * §13 Fase 2 — «Ensayo · decks del meta» (dry-run del auto-fetch). Ruta `vault_operator+`: NO se
 * envuelve en `SuperAdminOnly`, porque el backend `GET /admin/decks-meta/preview` admite operador
 * (es una verificación, no un acto de dinero — no publica nada). Defensa en profundidad: el backend
 * sigue siendo la autoridad y rechaza por rol.
 */
export default function M12Page() {
  return <M12View />;
}
