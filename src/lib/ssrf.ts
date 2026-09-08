/**
 * Outbound-fetch guard for the authorization server (#340).
 *
 * Anything the AS fetches because a client told it to (today nothing; the
 * Client ID Metadata Document behind a CIMD client_id when that lands) is a
 * server-side request forgery surface: a hostile client_id can point at the
 * Docker network, the cloud metadata service, or this very container. The
 * guard is three checks that all have to pass:
 *
 *   1. the URL itself: https only, no credentials, no literal private address;
 *   2. every address the hostname resolves to is public;
 *   3. the socket is pinned to the addresses that passed check 2, so a DNS
 *      answer that changes between resolve and connect (rebinding) cannot
 *      steer the connection somewhere private.
 *
 * The Coolify base URL is deliberately NOT routed through here. It is operator
 * configuration, and on a Coolify deployment it is an internal address by
 * design.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Resolves a hostname to every address it answers with. Injectable for tests. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

const forbidden = new BlockList();
// IPv4: "this" network, RFC 1918, CGNAT, loopback, link-local (incl. the cloud
// metadata service at 169.254.169.254), IETF protocol assignments, benchmarking,
// multicast, reserved and broadcast.
forbidden.addSubnet('0.0.0.0', 8, 'ipv4');
forbidden.addSubnet('10.0.0.0', 8, 'ipv4');
forbidden.addSubnet('100.64.0.0', 10, 'ipv4');
forbidden.addSubnet('127.0.0.0', 8, 'ipv4');
forbidden.addSubnet('169.254.0.0', 16, 'ipv4');
forbidden.addSubnet('172.16.0.0', 12, 'ipv4');
forbidden.addSubnet('192.0.0.0', 24, 'ipv4');
forbidden.addSubnet('192.168.0.0', 16, 'ipv4');
forbidden.addSubnet('198.18.0.0', 15, 'ipv4');
forbidden.addSubnet('224.0.0.0', 4, 'ipv4');
forbidden.addSubnet('240.0.0.0', 4, 'ipv4');
// IPv6: unspecified, loopback, NAT64 (hides an unchecked IPv4 behind it),
// unique-local, link-local, multicast. IPv4-mapped addresses are checked by
// BlockList against the IPv4 rules above.
forbidden.addSubnet('::', 128, 'ipv6');
forbidden.addSubnet('::1', 128, 'ipv6');
forbidden.addSubnet('64:ff9b::', 96, 'ipv6');
forbidden.addSubnet('fc00::', 7, 'ipv6');
forbidden.addSubnet('fe80::', 10, 'ipv6');
forbidden.addSubnet('ff00::', 8, 'ipv6');

/** True for anything that is not a public unicast address (unparseable counts). */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return forbidden.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/**
 * Check 1: the URL as written. Throws UnsafeUrlError on anything that is not a
 * credential-free https URL to a non-local hostname or public literal address.
 */
export function assertPublicUrl(raw: string, options?: { allowInsecureHttp?: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError(`not a URL: ${raw}`);
  }
  const allowed = options?.allowInsecureHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowed.includes(url.protocol)) {
    throw new UnsafeUrlError(`${url.protocol} is not an allowed scheme for an outbound fetch`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('outbound URLs must not carry credentials');
  }
  const host = bareHost(url);
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeUrlError(`${host || '(empty)'} is not a public host`);
  }
  if (isIP(host) !== 0 && isForbiddenAddress(host)) {
    throw new UnsafeUrlError(`${host} is not a public address`);
  }
  return url;
}

const systemResolver: Resolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));

/** Check 2: every address the name resolves to is public; returns them. */
export async function resolvePublicAddresses(
  hostname: string,
  resolver: Resolver = systemResolver,
): Promise<ResolvedAddress[]> {
  const addresses = await resolver(hostname);
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`${hostname} did not resolve`);
  }
  for (const entry of addresses) {
    if (isForbiddenAddress(entry.address)) {
      throw new UnsafeUrlError(`${hostname} resolves to a private address (${entry.address})`);
    }
  }
  return addresses;
}

/**
 * Check 3: a Node `lookup` that answers from the vetted list and never
 * consults DNS again, so the connection cannot be rebound after the check.
 */
export function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === 'object' && options !== null && options.all) {
      callback(
        null,
        addresses.map((entry) => ({ address: entry.address, family: entry.family })),
      );
      return;
    }
    callback(null, addresses[0].address, addresses[0].family);
  };
}

export interface FetchPublicJsonOptions {
  /** Hard deadline for the whole exchange. Claude allows 10 s for discovery. */
  timeoutMs?: number;
  /** Response size cap; a metadata document is a few hundred bytes. */
  maxBytes?: number;
  /** Development only (mirrors MCP_ALLOW_INSECURE_HTTP). */
  allowInsecureHttp?: boolean;
  resolver?: Resolver;
}

/**
 * GET a JSON document from a public URL with all three checks applied.
 * Redirects are not followed: a 3xx is a failure, because following one would
 * re-open every question the checks just answered.
 */
export async function fetchPublicJson(
  raw: string,
  options: FetchPublicJsonOptions = {},
): Promise<unknown> {
  const { timeoutMs = 10_000, maxBytes = 64 * 1024 } = options;
  const url = assertPublicUrl(raw, { allowInsecureHttp: options.allowInsecureHttp });
  const host = bareHost(url);
  const literal = isIP(host);
  const addresses =
    literal !== 0
      ? [{ address: host, family: literal === 6 ? (6 as const) : (4 as const) }]
      : await resolvePublicAddresses(host, options.resolver);

  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        lookup: pinnedLookup(addresses),
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new UnsafeUrlError(
              `${url.host} answered ${res.statusCode}; redirects are not followed`,
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new UnsafeUrlError(`${url.host} response exceeds ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new UnsafeUrlError(`${url.host} did not return JSON`));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(new UnsafeUrlError(`${url.host} gave no response within ${timeoutMs}ms`)),
    );
    req.on('error', reject);
    req.end();
  });
}
