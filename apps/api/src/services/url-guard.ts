import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ForbiddenTargetError } from '../domain/errors.js';

/**
 * Server-side request forgery guard.
 *
 * Accessly fetches arbitrary URLs on a customer's say-so, which is exactly the
 * shape of an SSRF primitive: without this, anyone with an account could point
 * the scanner at `http://169.254.169.254/` and read our cloud metadata out of
 * the resulting report snippets.
 *
 * We resolve the hostname and check the *resolved addresses*, not the string,
 * because `http://localtest.me` and a DNS record pointing at 127.0.0.1 both
 * look public until you resolve them.
 */

/** CIDR blocks that must never be fetched. */
const BLOCKED_V4 = [
  { base: '0.0.0.0', bits: 8, why: 'this network' },
  { base: '10.0.0.0', bits: 8, why: 'private network' },
  { base: '100.64.0.0', bits: 10, why: 'carrier-grade NAT' },
  { base: '127.0.0.0', bits: 8, why: 'loopback' },
  { base: '169.254.0.0', bits: 16, why: 'link-local (cloud metadata)' },
  { base: '172.16.0.0', bits: 12, why: 'private network' },
  { base: '192.0.0.0', bits: 24, why: 'IETF protocol assignments' },
  { base: '192.168.0.0', bits: 16, why: 'private network' },
  { base: '198.18.0.0', bits: 15, why: 'benchmarking' },
  { base: '224.0.0.0', bits: 4, why: 'multicast' },
  { base: '240.0.0.0', bits: 4, why: 'reserved' },
] as const;

function ipv4ToInt(address: string): number {
  return address
    .split('.')
    .reduce((total, octet) => (total << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

function blockedReasonV4(address: string): string | null {
  const value = ipv4ToInt(address);
  for (const block of BLOCKED_V4) {
    const mask = (0xffffffff << (32 - block.bits)) >>> 0;
    if ((value & mask) === (ipv4ToInt(block.base) & mask)) return block.why;
  }
  return null;
}

function blockedReasonV6(address: string): string | null {
  const normalised = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalised === '::1' || normalised === '::') return 'loopback';
  if (normalised.startsWith('fe80')) return 'link-local';
  // Unique local addresses: fc00::/7
  if (/^f[cd]/.test(normalised)) return 'unique local address';
  // Multicast: ff00::/8
  if (normalised.startsWith('ff')) return 'multicast';
  // 6to4 can tunnel straight into private IPv4 space: 2002::/16
  if (normalised.startsWith('2002:')) return '6to4 tunnel address';
  // NAT64: 64:ff9b::/96 (the /96 boundary is elided — an over-block here is
  // safe, an under-block is not)
  if (normalised.startsWith('64:ff9b:')) return 'NAT64 address';
  // Discard-only prefix: 100::/64
  if (normalised.startsWith('100::')) return 'discard-only address';
  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
  if (mapped?.[1]) return blockedReasonV4(mapped[1]);
  // IPv4-compatible IPv6 (deprecated but routable in some stacks), e.g. ::127.0.0.1
  const compatible = /^::(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
  if (compatible?.[1]) return blockedReasonV4(compatible[1]);
  return null;
}

export function blockedReasonForAddress(address: string): string | null {
  const family = isIP(address);
  if (family === 4) return blockedReasonV4(address);
  if (family === 6) return blockedReasonV6(address);
  return null;
}

export interface UrlGuardOptions {
  readonly blockPrivateHosts: boolean;
  /** Injected so tests can assert the guard without touching real DNS. */
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
}

async function defaultResolve(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

/**
 * Validate a URL for fetching. Throws `ForbiddenTargetError` when the target is
 * not something we are willing to request.
 */
export async function assertFetchableUrl(
  rawUrl: string,
  options: UrlGuardOptions,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ForbiddenTargetError('That URL could not be parsed.', rawUrl);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ForbiddenTargetError(
      'Only http and https URLs can be scanned.',
      `Received protocol "${url.protocol}".`,
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new ForbiddenTargetError(
      'URLs with embedded credentials cannot be scanned.',
      'Remove the username and password from the URL.',
    );
  }

  if (!options.blockPrivateHosts) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // A literal IP needs no DNS round trip.
  if (isIP(hostname) !== 0) {
    const reason = blockedReasonForAddress(hostname);
    if (reason) {
      throw new ForbiddenTargetError(
        'That address is not reachable from Accessly.',
        `${hostname} is a ${reason} address. Scan a publicly reachable URL instead.`,
      );
    }
    return url;
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ForbiddenTargetError(
      'That address is not reachable from Accessly.',
      'Local hostnames cannot be scanned. Use the paste-HTML scanner for pages that are not yet published.',
    );
  }

  const resolve = options.resolve ?? defaultResolve;
  let addresses: readonly string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    throw new ForbiddenTargetError(
      'That hostname could not be resolved.',
      `DNS lookup failed for "${hostname}".`,
    );
  }

  for (const address of addresses) {
    const reason = blockedReasonForAddress(address);
    if (reason) {
      throw new ForbiddenTargetError(
        'That address is not reachable from Accessly.',
        `"${hostname}" resolves to ${address}, which is a ${reason} address.`,
      );
    }
  }

  return url;
}
