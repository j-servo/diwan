import { describe, expect, it } from 'vitest';

import { isAllowedLocalUpgrade } from '../vite/localOrigin.ts';

describe('isAllowedLocalUpgrade', () => {
  it('allows same-origin localhost', () => {
    expect(isAllowedLocalUpgrade('http://localhost:5180', 'localhost:5180')).toBe(true);
  });
  it('allows same-origin 127.0.0.1', () => {
    expect(isAllowedLocalUpgrade('http://127.0.0.1:5180', '127.0.0.1:5180')).toBe(true);
  });
  it('allows same-origin [::1]', () => {
    expect(isAllowedLocalUpgrade('http://[::1]:5180', '[::1]:5180')).toBe(true);
  });
  it('allows a missing origin with a loopback host', () => {
    expect(isAllowedLocalUpgrade(undefined, 'localhost:5180')).toBe(true);
  });
  it('refuses a foreign origin', () => {
    expect(isAllowedLocalUpgrade('http://evil.com', 'localhost:5180')).toBe(false);
  });
  it('refuses the DNS-rebinding shape', () => {
    expect(isAllowedLocalUpgrade('http://evil.com:5180', 'evil.com:5180')).toBe(false);
  });
  it('refuses localhost origin against a 127.0.0.1 host', () => {
    expect(isAllowedLocalUpgrade('http://localhost:5180', '127.0.0.1:5180')).toBe(false);
  });
  it('refuses an origin on a different port', () => {
    expect(isAllowedLocalUpgrade('http://localhost:9999', 'localhost:5180')).toBe(false);
  });
  it('refuses a garbage origin', () => {
    expect(isAllowedLocalUpgrade('not a url', 'localhost:5180')).toBe(false);
  });
  it('refuses a missing host', () => {
    expect(isAllowedLocalUpgrade(undefined, undefined)).toBe(false);
    expect(isAllowedLocalUpgrade('http://localhost:5180', undefined)).toBe(false);
  });
});
