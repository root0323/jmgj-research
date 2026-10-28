import { describe, it, expect } from '../../frontend/node_modules/vitest';
import { validData } from './storage';
describe('regional validation before durable storage', () => {
  it('requires actual bytes, exact expected size and digest', async () => {
    const b = new Uint8Array([137,72,68,70,13,10,26,10]);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), n => n.toString(16).padStart(2,'0')).join('');
    expect(await validData(new Response(b), digest, 8)).toBe(true);
    expect(await validData(new Response(b), digest, 9)).toBe(false);
    expect(await validData(new Response(b), '0'.repeat(64), 8)).toBe(false);
  });
  it('does not save HTML login pages, JSON errors or empty content as terrain', async () => {
    for (const text of ['<html>Login</html>', '{"error":"expired"}', '']) expect(await validData(new Response(text),'',0)).toBe(false);
    expect(await validData(new Response('missing', {status:404}),'',0)).toBe(false);
  });
});
