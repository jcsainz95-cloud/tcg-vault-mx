import { describe, it, expect } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { versionErrorCode, versionErrorText } from './version-errors';
import es from '../../../../../../messages/es.json';

const errs = es.admin.m5.flow.f2.version.errors as Record<string, string>;
const t = (k: string, v?: Record<string, string>) => (errs[k] ?? k).replace('{cap}', v?.cap ?? '').replace('{amount}', v?.amount ?? '');

describe('version-errors · §BUYLIST-ES §4.1/§4.7', () => {
  it('cada código nuevo tiene texto propio y distingue details.reason', () => {
    const e = (s: number, code: string, details?: Record<string, unknown>) => new ApiClientError(s, { code, message: 'x', details });
    expect(versionErrorText(e(422, 'VERSION_PRICE_UNAVAILABLE', { reason: 'no_price' }), t, 'es')).toBe(errs.unavailable);
    expect(versionErrorText(e(422, 'VERSION_PRICE_UNAVAILABLE', { reason: 'wrong_card' }), t, 'es')).toBe(errs.wrongCard);
    expect(versionErrorText(e(409, 'VERSION_ALREADY_SET'), t, 'es')).toBe(errs.alreadySet);
    expect(versionErrorText(e(409, 'VERSION_MISMATCH_PENDING'), t, 'es')).toBe(errs.mismatchPending);
    expect(versionErrorText(e(409, 'VERSION_NOT_CONFIRMED'), t, 'es')).toBe(errs.notConfirmed);
    expect(versionErrorCode(e(409, 'CONFLICT'))).toBeNull();
  });
});
