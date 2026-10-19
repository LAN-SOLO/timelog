import { useState } from 'react';

/** "37,5" / "37.5" → 37.5; leer oder ungültig → 0; begrenzt auf [0, max]. */
export function parseNum(v: string, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(v.trim().replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

/**
 * Zahlenfeld für Stunden und Euro: hält den getippten Text selbst, damit
 * Zwischenstände wie „37,“ oder „85,5“ stehen bleiben (ein reines
 * value={number}-Feld verschluckt Komma und Punkt). Nach außen geht nur die
 * Zahl; Komma und Punkt sind beide als Dezimaltrenner erlaubt.
 */
export function NumField({
  value,
  onChange,
  max,
  autoFocus,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(() => (value ? String(value) : ''));
  const [prev, setPrev] = useState(value);
  // Wert von außen geändert (z. B. anderer Datensatz) → Text nachziehen
  if (value !== prev) {
    setPrev(value);
    if (parseNum(text, max) !== value) setText(value ? String(value) : '');
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      autoFocus={autoFocus}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = parseNum(raw, max);
        setPrev(n);
        onChange(n);
      }}
      onBlur={() => {
        // Ungültiges oder Begrenztes sichtbar korrigieren, gültige Eingabe
        // (auch mit Komma) so stehen lassen, wie sie getippt wurde
        const n = parseNum(text, max);
        const raw = Number(text.trim().replace(',', '.'));
        if (text.trim() === '' || raw !== n) setText(n ? String(n) : '');
      }}
    />
  );
}
