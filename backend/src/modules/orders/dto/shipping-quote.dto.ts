/**
 * shipping-quote.dto.ts — `POST /checkout/shipping-quote` (§ENV3, API_CONTRACT). Body `{cp, items[]}`; ⛔ el cliente NO manda peso, medidas
 * ni costo (cualquier otra llave se ignora por la lista blanca del pipe y por `shippingQuoteCartDtoOf`, que solo copia lo que conoce).
 * `items[]`: `{inventoryItemId}` | `{accessoryId, quantity}` | `{pullToken, withEnergyBundle}`.
 */
import { ArrayMaxSize, ArrayMinSize, IsArray, Matches } from 'class-validator';
import { BusinessException } from '../../../common/business.exception';
import { GUEST_MAX_ITEMS } from '../guest-checkout.constants';
import { GuestQuoteDto } from './guest-checkout.dto';
import { ACCESSORY_LINES_MAX, DECK_PULLS_MAX } from './accessory-cart.dto';

const CP = /^\d{5}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ShippingQuoteRequestDto {
  @Matches(CP, { message: 'cp must be 5 digits' }) cp!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(GUEST_MAX_ITEMS + ACCESSORY_LINES_MAX + DECK_PULLS_MAX) items!: unknown[];
}

function bad(field: string): never {
  throw BusinessException.badRequest('VALIDATION_ERROR', `items: invalid ${field}`, { field: 'items' });
}

/** `items[]` → la forma del `quote` de invitado (que ya sabe podar, apartar accesorios y validar `pullToken`). */
export function shippingQuoteCartDtoOf(dto: ShippingQuoteRequestDto): GuestQuoteDto {
  const inventoryItemIds: string[] = [];
  const accessoryLines: { accessoryId: string; quantity: number }[] = [];
  const deckPulls: { pullToken: string; withEnergyBundle: boolean }[] = [];
  for (const raw of dto.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('item');
    const o = raw as Record<string, unknown>;
    if (typeof o.inventoryItemId === 'string') {
      if (!UUID.test(o.inventoryItemId)) bad('inventoryItemId');
      inventoryItemIds.push(o.inventoryItemId);
    } else if (typeof o.accessoryId === 'string') {
      if (!UUID.test(o.accessoryId) || !Number.isInteger(o.quantity) || (o.quantity as number) < 1 || (o.quantity as number) > 99) bad('accessory');
      accessoryLines.push({ accessoryId: o.accessoryId, quantity: o.quantity as number });
    } else if (typeof o.pullToken === 'string') {
      if (o.pullToken.length < 1 || o.pullToken.length > 4096 || typeof o.withEnergyBundle !== 'boolean') bad('pull');
      deckPulls.push({ pullToken: o.pullToken, withEnergyBundle: o.withEnergyBundle });
    } else {
      bad('item');
    }
  }
  if (new Set(accessoryLines.map((l) => l.accessoryId)).size !== accessoryLines.length) bad('accessory');
  const out = new GuestQuoteDto();
  out.inventoryItemIds = inventoryItemIds;
  if (accessoryLines.length > 0) out.accessoryLines = accessoryLines;
  if (deckPulls.length > 0) out.deckPulls = deckPulls;
  return out;
}
