import { describe, it, expect, vi, afterEach } from 'vitest';
import * as api from '@/lib/api';
import { openLabelPdf } from './label-pdf';

/** BSD-TL-D8 (techlead): el nombre del PDF es el del SERVIDOR (`Content-Disposition`); `ref` solo es el respaldo. */
afterEach(() => vi.restoreAllMocks());

async function downloadedName(filename: string | null): Promise<string> {
  vi.spyOn(api, 'fetchShipmentLabelPdf').mockResolvedValue({ blob: new Blob(['%PDF']), filename });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  let name = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  await openLabelPdf('shp-1', 'ENV-000099', 'download');
  return name;
}

describe('openLabelPdf · nombre del archivo', () => {
  it('con `Content-Disposition` ⇒ el nombre del servidor', async () => {
    expect(await downloadedName('guia-sr123abc.pdf')).toBe('guia-sr123abc.pdf');
  });
  it('sin cabecera ⇒ el respaldo `guia-<ref>.pdf`', async () => {
    expect(await downloadedName(null)).toBe('guia-ENV-000099.pdf');
  });
});
