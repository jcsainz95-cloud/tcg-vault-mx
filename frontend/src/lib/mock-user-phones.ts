/**
 * Celulares de usuarios del MOCK de la ficha M6 (§CELULAR). Almacén neutro: lo leen los fixtures (`getAdminUser`) y lo
 * escribe el cliente de la ficha (`api/customer-file.ts`) SIN importar `lib/mock` (regla R1 de mock-boundary).
 */
export const mockUserPhones: Record<string, string> = { 'u-777': '5548214739' };
