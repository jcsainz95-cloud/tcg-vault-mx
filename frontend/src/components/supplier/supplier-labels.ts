import type { BadgeTone } from '@/lib/status-map';
import type { OfferStatus, PurchaseStatus, RequestStatus } from '@/lib/api/suppliers';

export const OFFER_TONE: Record<OfferStatus, BadgeTone> = {
  open: 'info',
  countered: 'warning',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  expired: 'neutral',
};
export const PURCHASE_TONE: Record<PurchaseStatus, BadgeTone> = {
  agreed: 'info',
  collected: 'warning',
  verified: 'warning',
  paid: 'success',
  cancelled: 'neutral',
};
export const REQUEST_TONE: Record<RequestStatus, BadgeTone> = {
  open: 'success',
  filled: 'info',
  closed: 'neutral',
  expired: 'neutral',
};
