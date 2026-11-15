/** Network address checks for device data (pure) */

/** MAC written as 3C:52:82:1A:2B:3C (upper case, colons); other text is kept as typed; '' → undefined */
export function normalizeMac(v: string): string | undefined {
  const t = v.trim();
  if (!t) return undefined;
  const hex = t.replace(/[^0-9a-f]/gi, '');
  if (hex.length === 12 && /^[0-9a-f:.\-\s]+$/i.test(t)) return hex.toUpperCase().match(/../g)!.join(':');
  return t;
}

export const isMac = (v: string) => /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(v.trim());

/** IPv4 (optionally with /prefix), IPv6, or "dhcp" */
export function isIp(v: string): boolean {
  const t = v.trim().toLowerCase();
  if (t === 'dhcp') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/.exec(t);
  if (m) return [1, 2, 3, 4].every(i => Number(m[i]) <= 255) && (m[6] === undefined || Number(m[6]) <= 32);
  return /^[0-9a-f:]+(\/\d{1,3})?$/.test(t) && (t.match(/:/g) ?? []).length >= 2;
}
