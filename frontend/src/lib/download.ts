/**
 * Descarga en el navegador un archivo de texto (p. ej. CSV de M7/M9). Aislado en
 * su propio módulo para poder mockearlo en tests sin tocar el DOM real.
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
