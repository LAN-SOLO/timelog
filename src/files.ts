// Dateien speichern und öffnen — in der App über den Tauri-Dialog und das
// Dateisystem, im Browser über Download bzw. Dateiauswahl.
import { api, bytesToBase64, isTauri } from './api';

export interface FileFilter {
  name: string;
  extensions: string[];
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Text speichern. `false` = vom Nutzer abgebrochen. */
export async function saveTextFile(name: string, content: string, filter: FileFilter, mime = 'text/plain'): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: name, filters: [filter] });
    if (!path) return false;
    await api.writeTextFile(path, content);
    return true;
  }
  download(name, new Blob([content], { type: `${mime};charset=utf-8` }));
  return true;
}

/** Binärdaten speichern. `false` = vom Nutzer abgebrochen. */
export async function saveBinaryFile(name: string, bytes: Uint8Array, filter: FileFilter, mime = 'application/octet-stream'): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: name, filters: [filter] });
    if (!path) return false;
    await api.writeFile(path, bytesToBase64(bytes));
    return true;
  }
  download(name, new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mime }));
  return true;
}

/**
 * Text wie `decode_text` in commands.rs: UTF-16 mit BOM (Windows-Editor
 * „Unicode“) oder UTF-8 — ein UTF-8-BOM bleibt stehen, den entfernt der
 * Paket-Parser.
 */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);
}

/** Textdatei auswählen und lesen. `null` = abgebrochen. */
export async function openTextFile(filter: FileFilter): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ multiple: false, filters: [filter] });
    const path = typeof sel === 'string' ? sel : null;
    if (!path) return null;
    return api.readTextFile(path);
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filter.extensions.map((e) => `.${e}`).join(',');
    input.style.display = 'none';
    let done = false;
    let focusTimer: number | undefined;
    const cleanup = () => {
      done = true;
      window.removeEventListener('focus', onFocus);
      window.clearTimeout(focusTimer);
      input.remove();
    };
    const finish = (v: string | null) => {
      if (done) return;
      cleanup();
      resolve(v);
    };
    // Browser ohne `cancel`-Ereignis (Safari < 16.4, ältere Chromium): Nach dem
    // Schließen der Dateiauswahl bekommt das Fenster den Fokus zurück. Kommt
    // danach keine Datei an, gilt die Auswahl als abgebrochen — sonst bliebe
    // der Import-Knopf bis zum Neuladen gesperrt. Die Wartezeit lässt `change`
    // Vorrang (einige Browser melden den Fokus vor der Datei).
    const onFocus = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (!done && !input.files?.length) finish(null);
      }, 1500);
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return finish(null);
      f.arrayBuffer().then((b) => finish(decodeText(new Uint8Array(b)))).catch((e) => {
        if (done) return;
        cleanup();
        reject(e);
      });
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
    // Erst nach dem Öffnen lauschen: ein Fokus aus dem Klick selbst zählt nicht.
    window.setTimeout(() => {
      if (!done) window.addEventListener('focus', onFocus);
    }, 0);
  });
}
