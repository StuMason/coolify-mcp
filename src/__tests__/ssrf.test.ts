import { jest } from '@jest/globals';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  type ResolvedAddress,
  UnsafeUrlError,
  assertPublicUrl,
  fetchPublicJson,
  isForbiddenAddress,
  pinnedLookup,
  resolvePublicAddresses,
} from '../lib/ssrf.js';

describe('SSRF guard for AS outbound fetches (#340)', () => {
  it('knows the private, loopback, link-local, metadata and reserved ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'fc00::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
    ]) {
      expect(isForbiddenAddress(ip)).toBe(true);
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isForbiddenAddress(ip)).toBe(false);
    }
    expect(isForbiddenAddress('not-an-ip')).toBe(true);
  });

  it('accepts only clean public https URLs', () => {
    expect(assertPublicUrl('https://client.example.com/.well-known/cimd.json').hostname).toBe(
      'client.example.com',
    );
    for (const raw of [
      'http://client.example.com/x',
      'javascript:alert(1)',
      'data:application/json,{}',
      'file:///etc/passwd',
      'https://user:pw@client.example.com/x',
      'https://localhost/x',
      'https://api.localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://[::ffff:10.0.0.1]/x',
      'not a url',
    ]) {
      expect(() => assertPublicUrl(raw)).toThrow(UnsafeUrlError);
    }
    expect(
      assertPublicUrl('http://client.example.com/x', { allowInsecureHttp: true }).protocol,
    ).toBe('http:');
  });

  it('rejects a hostname when any resolved address is private', async () => {
    const mixed = async (): Promise<ResolvedAddress[]> => [
      { address: '93.184.216.34', family: 4 as const },
      { address: '10.0.0.5', family: 4 as const },
    ];
    await expect(resolvePublicAddresses('rebind.example', mixed)).rejects.toThrow(/private/);
    await expect(
      resolvePublicAddresses('nxdomain.example', async (): Promise<ResolvedAddress[]> => []),
    ).rejects.toThrow(UnsafeUrlError);
    const clean = async (): Promise<ResolvedAddress[]> => [
      { address: '93.184.216.34', family: 4 as const },
    ];
    await expect(resolvePublicAddresses('ok.example', clean)).resolves.toHaveLength(1);
  });

  it('pins the socket to the vetted addresses instead of resolving again', () => {
    const vetted = [
      { address: '93.184.216.34', family: 4 as const },
      { address: '2606:4700:4700::1111', family: 6 as const },
    ];
    const lookup = pinnedLookup(vetted);
    const single = jest.fn();
    lookup('rebind.example', {}, single);
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const all = jest.fn();
    lookup('rebind.example', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, vetted);
  });

  it('fetchPublicJson refuses before opening a socket when the target is private', async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const toLocal = async (): Promise<ResolvedAddress[]> => [
      { address: '127.0.0.1', family: 4 as const },
    ];
    try {
      await expect(
        fetchPublicJson(`http://cimd.example:${port}/doc.json`, {
          allowInsecureHttp: true,
          resolver: toLocal,
        }),
      ).rejects.toThrow(/private/);
      await expect(
        fetchPublicJson(`http://127.0.0.1:${port}/doc.json`, { allowInsecureHttp: true }),
      ).rejects.toThrow(UnsafeUrlError);
      await expect(
        fetchPublicJson('https://cimd.example/doc.json', { resolver: toLocal }),
      ).rejects.toThrow(/private/);
      await expect(
        fetchPublicJson(`http://cimd.example:${port}/doc.json`, { resolver: toLocal }),
      ).rejects.toThrow(/scheme/);
      expect(hits).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
