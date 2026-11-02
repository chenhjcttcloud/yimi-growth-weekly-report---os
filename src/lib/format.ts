export function cnNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function percent(value: number, digits = 0) {
  return `${cnNumber(value, digits)}%`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function truncate(text: string, max = 96) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

// SQLite datetime('now') is UTC even when the browser or server uses Beijing time.
export function parseServerTimestamp(value?: string): number {
  const text = String(value || '').trim().replace(' ', 'T');
  if (!text) return Number.NaN;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : text + 'Z');
}
