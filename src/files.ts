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
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (!f) return finish(null);
      f.text().then(finish).catch((e) => {
        done = true;
        input.remove();
        reject(e);
      });
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
