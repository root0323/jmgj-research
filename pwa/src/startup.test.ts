import { describe, it, expect, vi } from '../../frontend/node_modules/vitest';
import { prepareStorage } from './startup';
function fixture(script = 'https://app.example/sw.js', controlled = true) {
  const workers = Object.assign(new EventTarget(), { controller: controlled ? {} : null, getRegistration: vi.fn(), register: vi.fn() });
  const registration = { active: { scriptURL: script, postMessage: vi.fn() }, update: vi.fn().mockRejectedValue(Error('offline')) };
  workers.getRegistration.mockResolvedValue(registration); workers.register.mockResolvedValue(registration);
  return { workers: workers as unknown as ServiceWorkerContainer, raw: workers, registration };
}
describe('installed PWA startup', () => {
  it('starts with the installed worker when a network update fails', async () => {
    const f = fixture(); expect(await prepareStorage(f.workers, 'https://app.example')).toBe(f.registration);
    expect(f.raw.register).not.toHaveBeenCalled(); expect(f.registration.update).toHaveBeenCalledOnce();
  });
  it('replaces a background worker instead of trusting the wrong root script', async () => {
    const f = fixture('https://app.example/background-sw.js'); await prepareStorage(f.workers, 'https://app.example');
    expect(f.raw.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });
  it('claims an uncontrolled page before importing the shared UI', async () => {
    const f = fixture(undefined, false), result = prepareStorage(f.workers, 'https://app.example', 100);
    await vi.waitFor(() => expect(f.registration.active.postMessage).toHaveBeenCalledWith({ type: 'CLAIM_CLIENT' }));
    f.raw.controller = {}; f.raw.dispatchEvent(new Event('controllerchange'));
    expect(await result).toBe(f.registration);
  });
  it('reports an unresponsive worker instead of a permanent blank screen', async () => {
    const f = fixture(undefined, false);
    await expect(prepareStorage(f.workers, 'https://app.example', 5)).rejects.toThrow('저장소 준비');
  });
});
