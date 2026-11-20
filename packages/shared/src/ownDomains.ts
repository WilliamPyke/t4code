/**
 * Our domains, newest first. Both serve the same app, board host and downloads: saved links,
 * per-origin browser storage and installed apps still name the older one.
 */
export const OWN_DOMAINS = ["tinkjam.com", "trellium.org"] as const;

/**
 * The same host on each of our domains, itself first (`boards.trellium.org` and
 * `boards.tinkjam.com`). A host on no domain of ours stands alone.
 */
export function ownDomainHosts(host: string): ReadonlyArray<string> {
  const lower = host.toLowerCase().replace(/\.$/, "");
  const domain = OWN_DOMAINS.find((own) => lower === own || lower.endsWith(`.${own}`));
  if (domain === undefined) return [host];
  const prefix = lower.slice(0, lower.length - domain.length);
  return [lower, ...OWN_DOMAINS.filter((own) => own !== domain).map((own) => `${prefix}${own}`)];
}

/** `ownDomainHosts` for an origin: the same scheme and port on each of our domains. */
export function ownDomainOrigins(origin: string): ReadonlyArray<string> {
  if (!URL.canParse(origin)) return [origin];
  const url = new URL(origin);
  const port = url.port === "" ? "" : `:${url.port}`;
  return ownDomainHosts(url.hostname).map((hostname) => `${url.protocol}//${hostname}${port}`);
}
