import { describe, it, expect, vi } from 'vitest';
import { createWebhookServer } from '../src/server';

describe('createWebhookServer', () => {
  it('logs every incoming POST to /webhooks/* with method, path and IP', async () => {
    const logSpy = vi.fn();

    const fakeModule = {
      name: 'linear',
      description: 'test',
      commands: [],
      webhookRoutes: (() => {
        const { Router } = require('express');
        const r = Router();
        r.post('/', (_req: any, res: any) => res.json({ ok: true }));
        return r;
      })(),
    };

    const app = createWebhookServer([fakeModule], 0, logSpy);

    const server = app.listen(0);
    const { port } = server.address() as any;

    await fetch(`http://127.0.0.1:${port}/webhooks/linear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Issue', action: 'update' }),
    });

    server.close();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/POST.*\/linear/)
    );
  });

  it('does NOT log GET /health requests', async () => {
    const logSpy = vi.fn();
    const app = createWebhookServer([], 0, logSpy);

    const server = app.listen(0);
    const { port } = server.address() as any;

    await fetch(`http://127.0.0.1:${port}/health`);
    server.close();

    expect(logSpy).not.toHaveBeenCalled();
  });
});
