import { describe, it, expect } from '@jest/globals';
import { parseHeaders } from '../lib/parse-headers.js';

describe('parseHeaders', () => {
  it('should parse a single header', () => {
    const result = parseHeaders(['--header', 'X-Custom: value']);
    expect(result).toEqual({ 'X-Custom': 'value' });
  });

  it('should parse multiple headers', () => {
    const result = parseHeaders(['--header', 'X-First: one', '--header', 'X-Second: two']);
    expect(result).toEqual({ 'X-First': 'one', 'X-Second': 'two' });
  });

  it('should ignore malformed headers without a colon', () => {
    const result = parseHeaders(['--header', 'no-colon-here']);
    expect(result).toEqual({});
  });

  it('should trim whitespace from key and value', () => {
    const result = parseHeaders(['--header', '  X-Spaced  :  some value  ']);
    expect(result).toEqual({ 'X-Spaced': 'some value' });
  });

  it('should handle header value containing colons', () => {
    const result = parseHeaders(['--header', 'Authorization: Bearer abc:def:ghi']);
    expect(result).toEqual({ Authorization: 'Bearer abc:def:ghi' });
  });

  it('should return empty object when no headers provided', () => {
    expect(parseHeaders([])).toEqual({});
    expect(parseHeaders(['--other', 'flag'])).toEqual({});
  });

  it('should ignore --header without a following value', () => {
    const result = parseHeaders(['--header']);
    expect(result).toEqual({});
  });
});
