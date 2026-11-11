/**
 * §GSHOP (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md §B) — cliente de `GET /catalog/merchant-feed` (público).
 * Un archivo por dominio (deuda DT-API). El front no calcula precios: `priceCents` viene del servidor.
 */
import { apiRequest } from '../api-client';
import { config } from '../config';

const MOCKS_BUILD = process.env.NEXT_PUBLIC_USE_MOCKS === 'true';

/** Forma de la spec §B («Fuente de datos»). Si el contrato publicado cambia, manda el contrato. */
export interface MerchantFeedItem {
  id: string;
  kind: 'card' | 'sealed';
  /** Ruta canónica SIN locale (`/catalog/<id>` | `/sellado/<id>`); el front antepone el locale por defecto (= `sitemap.ts`). */
  path: string;
  title: string;
  description: string;
  imageUrl: string | null;
  /** Centavos MXN enteros, IVA y comisión incluidos (= `Offer.price` de la ficha). */
  priceCents: number;
  availability?: 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder';
  condition: 'new' | 'used';
  brand: 'Pokémon';
  gtin: string | null;
  identifierExists?: boolean;
  googleProductCategory?: string;
  /** Envío a MX con la regla viva del servidor (centavos; 0 si gratis). */
  shippingCents?: number;
  returns?: 'not_permitted';
  groupId?: string | null;
}

export interface MerchantFeedResponse {
  items: MerchantFeedItem[];
  generatedAt: string;
}

export interface ServerFeedOptions {
  next?: { revalidate?: number; tags?: string[] };
  signal?: AbortSignal;
}

export async function getMerchantFeed(server?: ServerFeedOptions): Promise<MerchantFeedResponse> {
  if (!(MOCKS_BUILD && config.useMocks)) {
    return apiRequest<MerchantFeedResponse>('/catalog/merchant-feed', { next: server?.next, signal: server?.signal });
  }
  return {
    generatedAt: '2026-11-11T12:00:00.000Z',
    items: [
      {
        id: 'card:base1-4',
        kind: 'card',
        path: '/catalog/base1-4',
        title: 'Charizard 4/102 Base Set - Carta Pokémon (NM)',
        description: 'Carta "Charizard" & más.\nEstado NM.',
        imageUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
        priceCents: 10500,
        condition: 'used',
        brand: 'Pokémon',
        gtin: null,
        identifierExists: false,
        shippingCents: 10000,
      },
      {
        id: 'sealed:sv3-etb',
        kind: 'sealed',
        path: '/sellado/sv3-etb',
        title: 'Elite Trainer Box Obsidian Flames - Pokémon',
        description: 'Caja sellada.',
        imageUrl: 'https://images.pokemontcg.io/sv3/logo.png',
        priceCents: 129900,
        condition: 'new',
        brand: 'Pokémon',
        gtin: null,
        identifierExists: false,
        shippingCents: 17500,
      },
    ],
  };
}
