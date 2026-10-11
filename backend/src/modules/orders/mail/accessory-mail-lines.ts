/**
 * accessory-mail-lines.ts — los renglones de accesorio en los correos del pedido (API_CONTRACT §AC.12 con §AC.19.1):
 * nombre, cantidad, precio unitario, total de línea y, en paquete, deck y componentes. ⛔ SIN foto: el correo necesitaría
 * una URL con host que el backend no tiene, y ningún correo de pedido lleva imágenes (`<img`: 0).
 */
import type { EnergyType } from '@prisma/client';
import type { AccessoryMailLine } from '../accessory-lines-view';

export type { AccessoryMailLine };

const ENERGY_LABEL: Record<'es' | 'en', Record<EnergyType, string>> = {
  es: { grass: 'Planta', fire: 'Fuego', water: 'Agua', lightning: 'Rayo', psychic: 'Psíquica', fighting: 'Lucha', darkness: 'Oscura', metal: 'Metálica' },
  en: { grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Lightning', psychic: 'Psychic', fighting: 'Fighting', darkness: 'Darkness', metal: 'Metal' },
};

/** Una línea de texto por renglón: «Penny sleeves ×3 — $267.00» / «Paquete de energías — Deck ×1 (Fuego ×8) — $20.00». */
export function accessoryMailTextLines(lines: readonly AccessoryMailLine[] | undefined, locale: 'es' | 'en', money: (cents: number) => string): string[] {
  return (lines ?? []).map((l) => {
    if (l.deckName !== null) {
      const head = locale === 'en' ? 'Energy bundle' : 'Paquete de energías';
      const comps = l.components.map((c) => `${ENERGY_LABEL[locale][c.energyType]} ×${c.quantity}`).join(', ');
      return `${head} — ${l.deckName} ×${l.quantity}${comps ? ` (${comps})` : ''} — ${money(l.lineTotalCents)}`;
    }
    return `${l.name} ×${l.quantity} — ${money(l.lineTotalCents)}`;
  });
}
