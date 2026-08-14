import { describe, expect, it } from 'vitest';
import { assertFetchableUrl, blockedReasonForAddress } from '../src/services/url-guard.js';

/**
 * SSRF guard.
 *
 * Accessly fetches arbitrary URLs on a customer's instruction, which is exactly
 * the shape of an SSRF primitive. These tests are a security control, not a
 * correctness nicety — a regression here would let any user read cloud metadata
 * or internal services through the report snippets.
 */

const guard = (resolved: string[] = ['93.184.216.34']) => ({
  blockPrivateHosts: true,
  resolve: async () => resolved,
});

describe('address classification', () => {
  it('blocks IPv4 ranges that are not publicly routable', () => {
    const blocked = [
      ['127.0.0.1', 'loopback'],
      ['10.1.2.3', 'private network'],
      ['172.16.0.1', 'private network'],
      ['172.31.255.255', 'private network'],
      ['192.168.1.1', 'private network'],
      ['169.254.169.254', 'link-local (cloud metadata)'],
      ['100.64.0.1', 'carrier-grade NAT'],
      ['0.0.0.0', 'this network'],
      ['224.0.0.1', 'multicast'],
    ] as const;

    for (const [address, reason] of blocked) {
      expect(blockedReasonForAddress(address), address).toBe(reason);
    }
  });

  it('allows public IPv4 addresses, including ones adjacent to blocked ranges', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '11.0.0.1']) {
      expect(blockedReasonForAddress(address), address).toBeNull();
    }
  });

  it('blocks IPv6 loopback, link-local and unique-local addresses', () => {
    expect(blockedReasonForAddress('::1')).toBe('loopback');
    expect(blockedReasonForAddress('fe80::1')).toBe('link-local');
    expect(blockedReasonForAddress('fd00::1')).toBe('unique local address');
  });

  it('blocks IPv4-mapped IPv6 addresses that wrap a private address', () => {
    // ::ffff:127.0.0.1 is a classic bypass — it looks like IPv6 and routes to
    // loopback.
    expect(blockedReasonForAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(blockedReasonForAddress('::ffff:169.254.169.254')).toBe('link-local (cloud metadata)');
  });

  it('allows public IPv6 addresses', () => {
    expect(blockedReasonForAddress('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });
});

describe('assertFetchableUrl', () => {
  it('accepts a public https URL', async () => {
    const url = await assertFetchableUrl('https://example.com/page', guard());
    expect(url.hostname).toBe('example.com');
  });

  it('rejects non-http protocols', async () => {
    for (const target of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
      await expect(assertFetchableUrl(target, guard())).rejects.toThrow(/http and https/i);
    }
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(
      assertFetchableUrl('https://user:pass@example.com/', guard()),
    ).rejects.toThrow(/credentials/i);
  });

  it('rejects a literal private address without a DNS lookup', async () => {
    await expect(
      assertFetchableUrl('http://169.254.169.254/latest/meta-data/', {
        blockPrivateHosts: true,
        resolve: async () => {
          throw new Error('DNS must not be consulted for a literal address');
        },
      }),
    ).rejects.toThrow(/not reachable/i);
  });

  it('rejects localhost and .local hostnames', async () => {
    for (const target of ['http://localhost:3000/', 'http://api.local/', 'http://x.localhost/']) {
      await expect(assertFetchableUrl(target, guard())).rejects.toThrow(/not reachable/i);
    }
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    // This is the case a string-based check misses entirely.
    await expect(
      assertFetchableUrl('https://internal.example.com/', guard(['10.0.0.5'])),
    ).rejects.toThrow(/not reachable/i);
  });

  it('rejects when any resolved address is private, not only the first', async () => {
    await expect(
      assertFetchableUrl('https://mixed.example.com/', guard(['93.184.216.34', '127.0.0.1'])),
    ).rejects.toThrow(/not reachable/i);
  });

  it('names the offending address in the detail so the user can act on it', async () => {
    // The message stays generic; the specifics go in `detail`, which is what
    // the Problem Details response surfaces underneath the title.
    await expect(
      assertFetchableUrl('https://internal.example.com/', guard(['169.254.169.254'])),
    ).rejects.toMatchObject({
      detail: expect.stringContaining('169.254.169.254'),
    });
  });

  it('rejects a hostname that cannot be resolved', async () => {
    await expect(
      assertFetchableUrl('https://nope.invalid/', {
        blockPrivateHosts: true,
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toThrow(/could not be resolved/i);
  });

  it('rejects an unparseable URL', async () => {
    await expect(assertFetchableUrl('http://', guard())).rejects.toThrow(/could not be parsed/i);
  });

  it('skips host checks only when explicitly disabled', async () => {
    const url = await assertFetchableUrl('http://127.0.0.1:8080/', {
      blockPrivateHosts: false,
    });
    expect(url.hostname).toBe('127.0.0.1');
  });
});
