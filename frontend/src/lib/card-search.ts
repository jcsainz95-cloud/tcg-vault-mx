/**
 * §BUSCADOR-CARTAS (`docs/DECISIONES.md`): el servidor entiende nombre, número y código impreso («PRE 078»); la pantalla
 * NO duplica esa lógica. Aquí solo vive el tope del campo (el servidor recorta `q` a 60 caracteres: se evita escribir de más)
 * y los textos comunes (`common.cardSearch.*`, es/en).
 */
export const CARD_SEARCH_MAX = 60;
