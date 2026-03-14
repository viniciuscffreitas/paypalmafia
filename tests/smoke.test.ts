import { describe, it, expect } from 'vitest';
import { createTestDb, createTestContext, createMockClient } from './setup';
import express from 'express';

describe('Smoke Tests', () => {
  it('in-memory database initializes with all tables', () => {
    const db = createTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('projects');
    expect(tables).toContain('links');
    expect(tables).toContain('metrics_snapshots');
    expect(tables).toContain('standups');
    expect(tables).toContain('deployments');
    db.close();
  });

  it('mock client has required properties', () => {
    const client = createMockClient();
    expect(client.guilds.cache).toBeDefined();
    expect(client.user.tag).toBe('TestBot#0000');
    expect(typeof client.on).toBe('function');
    expect(typeof client.emit).toBe('function');
  });

  it('test context provides all ModuleContext fields', () => {
    const ctx = createTestContext();
    expect(ctx.client).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.logger).toBeDefined();
    expect(typeof ctx.logger.info).toBe('function');
    expect(typeof ctx.getModule).toBe('function');
    ctx.db.close();
  });

  it('express health endpoint responds 200', async () => {
    const app = express();
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    const server = app.listen(0);
    const addr = server.address() as any;
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    server.close();
  });
});
