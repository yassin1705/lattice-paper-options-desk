import { describe, expect, it } from 'vitest';

import { isLocalControlRequest } from '@/lib/security/local-control';

describe('isLocalControlRequest', () => {
  it('allows direct localhost controls', () => {
    expect(
      isLocalControlRequest(new Request('http://localhost:3000/api/control')),
    ).toBe(true);
  });

  it('rejects a request forwarded through Cloudflare Tunnel', () => {
    expect(
      isLocalControlRequest(
        new Request('http://localhost:3000/api/control', {
          headers: {
            'cf-connecting-ip': '203.0.113.4',
            'cf-ray': 'test-ray',
            'x-forwarded-host': 'demo.example.com',
          },
        }),
      ),
    ).toBe(false);
  });
});
