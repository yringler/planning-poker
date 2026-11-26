/** Returns a safe http(s) link + its domain for display, or null if `url` isn't a valid one. */
export function parseTicketUrl(url: string | undefined): { href: string; host: string } | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return { href: parsed.href, host: parsed.hostname };
  } catch {
    return null;
  }
}
