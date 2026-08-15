import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { PhotoUploader } from './PhotoUploader';
import * as api from '@/lib/api';

// jsdom no implementa URL.createObjectURL/revokeObjectURL (preview del INE): los stubbeamos.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock-ine');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fileInput() {
  // El input es sr-only; se selecciona por su aria-label.
  return screen.getByLabelText('INE (anverso)') as HTMLInputElement;
}

describe('PhotoUploader (IneUploader §7.10) — validación cliente + presign', () => {
  it('renderiza el label, el botón de captura y solo acepta imágenes', () => {
    renderWithIntl(<PhotoUploader label="INE (anverso)" />, 'es');
    expect(screen.getByText('INE (anverso)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tomar foto/ })).toBeInTheDocument();
    // accept="image/*" garantiza que el selector solo ofrezca imágenes.
    expect(fileInput().getAttribute('accept')).toBe('image/*');
  });

  it('rechaza un archivo que no es imagen (validación de TIPO) sin subir', async () => {
    const onUploaded = vi.fn();
    renderWithIntl(<PhotoUploader label="INE (anverso)" onUploaded={onUploaded} />, 'es');

    const pdf = new File(['%PDF-1.4'], 'ine.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput(), { target: { files: [pdf] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una imagen');
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('envía contentLength=file.size en el presign (residuo S-B3 end-to-end)', async () => {
    const presignSpy = vi.spyOn(api, 'presignUpload');
    renderWithIntl(<PhotoUploader label="INE (anverso)" />, 'es');

    const img = new File(['imgbytes'], 'ine.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput(), { target: { files: [img] } });

    await waitFor(() => expect(presignSpy).toHaveBeenCalled());
    expect(presignSpy.mock.calls[0][0]).toMatchObject({
      purpose: 'kyc_ine',
      contentType: 'image/jpeg',
      contentLength: img.size,
    });
  });

  it('rechaza por tamaño usando maxBytes del presign (fuente única de verdad)', async () => {
    const onUploaded = vi.fn();
    // El presign impone el tope real; el archivo (10 bytes) excede maxBytes=4 del presign.
    vi.spyOn(api, 'presignUpload').mockResolvedValue({
      uploadKey: 'kyc_ine/x.img',
      uploadUrl: 'mock://storage/kyc_ine/x',
      method: 'PUT',
      headers: {},
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      maxBytes: 4,
    });
    const uploadSpy = vi.spyOn(api, 'uploadToPresignedUrl');
    renderWithIntl(<PhotoUploader label="INE (anverso)" onUploaded={onUploaded} />, 'es');

    const big = new File(['0123456789'], 'ine.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput(), { target: { files: [big] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('tamaño máximo');
    // No se sube ni se expone la uploadKey cuando el presign rechaza por tamaño.
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it('con una imagen válida pide presign, sube y expone la uploadKey (rama mock)', async () => {
    const onUploaded = vi.fn();
    renderWithIntl(<PhotoUploader label="INE (anverso)" onUploaded={onUploaded} />, 'es');

    const img = new File(['imgbytes'], 'ine.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput(), { target: { files: [img] } });

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(onUploaded.mock.calls[0][0]).toMatch(/^kyc_ine\//);
    expect(await screen.findByText('Subida ✓')).toBeInTheDocument(); // estado de éxito visible
  });
});
