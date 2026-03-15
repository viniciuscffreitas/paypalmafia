import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, createTestContext } from '../setup';
import { autoBookmarkModule } from '../../src/modules/auto-bookmark/index';
import { Events } from 'discord.js';

const BOOKMARK_EMOJI = '🔖';
const PROJECT_ID = 'proj-test';
const CATEGORY_ID = 'cat-123';

function buildMessage(overrides: Partial<any> = {}): any {
  const reactMock = vi.fn().mockResolvedValue(undefined);
  const replyMock = vi.fn().mockResolvedValue(undefined);
  return {
    author: { bot: false, tag: 'user#0001', id: 'user-1' },
    channel: { parentId: CATEGORY_ID },
    content: 'Veja esse link https://example.com/docs',
    react: reactMock,
    reply: replyMock,
    ...overrides,
  };
}

describe('auto-bookmark module', () => {
  let ctx: ReturnType<typeof createTestContext>;

  beforeEach(async () => {
    const db = createTestDb();
    ctx = createTestContext(db);

    // Seed project
    db.prepare(
      'INSERT INTO projects (id, name, discord_category_id) VALUES (?, ?, ?)'
    ).run(PROJECT_ID, 'test-project', CATEGORY_ID);

    await autoBookmarkModule.onLoad(ctx as any);
  });

  it('saves link automatically when URL is detected (no user reaction needed)', async () => {
    const message = buildMessage();

    ctx.client.emit(Events.MessageCreate, message);
    await new Promise((r) => setTimeout(r, 50));

    const link = ctx.db
      .prepare('SELECT * FROM links WHERE project_id = ?')
      .get(PROJECT_ID) as any;

    expect(link).not.toBeNull();
    expect(link.url).toBe('https://example.com/docs');
  });

  it('reacts with 🔖 after saving the link', async () => {
    const message = buildMessage();

    ctx.client.emit(Events.MessageCreate, message);
    await new Promise((r) => setTimeout(r, 50));

    expect(message.react).toHaveBeenCalledWith(BOOKMARK_EMOJI);
  });

  it('does NOT save link if message is from a bot', async () => {
    const message = buildMessage({ author: { bot: true, tag: 'bot#0001', id: 'bot-1' } });

    ctx.client.emit(Events.MessageCreate, message);
    await new Promise((r) => setTimeout(r, 50));

    const links = ctx.db
      .prepare('SELECT * FROM links WHERE project_id = ?')
      .all(PROJECT_ID);

    expect(links).toHaveLength(0);
  });

  it('does NOT save link if channel has no project', async () => {
    const message = buildMessage({
      channel: { parentId: 'unknown-category' },
    });

    ctx.client.emit(Events.MessageCreate, message);
    await new Promise((r) => setTimeout(r, 50));

    const links = ctx.db
      .prepare('SELECT * FROM links WHERE project_id = ?')
      .all(PROJECT_ID);

    expect(links).toHaveLength(0);
  });

  it('does NOT save if message has no URL', async () => {
    const message = buildMessage({ content: 'Olá turma, sem links aqui' });

    ctx.client.emit(Events.MessageCreate, message);
    await new Promise((r) => setTimeout(r, 50));

    const links = ctx.db
      .prepare('SELECT * FROM links WHERE project_id = ?')
      .all(PROJECT_ID);

    expect(links).toHaveLength(0);
  });

  it('saves multiple URLs from a single message', async () => {
    const message = buildMessage({
      content: 'Dois links: https://first.com e https://second.com',
    });

    ctx.client.emit(Events.MessageCreate, message);
    await new Promise((r) => setTimeout(r, 50));

    const links = ctx.db
      .prepare('SELECT * FROM links WHERE project_id = ?')
      .all(PROJECT_ID);

    expect(links).toHaveLength(2);
  });

  it('does NOT save duplicate URL if same link is posted twice', async () => {
    const msg1 = buildMessage();
    const msg2 = buildMessage();

    ctx.client.emit(Events.MessageCreate, msg1);
    await new Promise((r) => setTimeout(r, 50));
    ctx.client.emit(Events.MessageCreate, msg2);
    await new Promise((r) => setTimeout(r, 50));

    const links = ctx.db
      .prepare('SELECT * FROM links WHERE project_id = ?')
      .all(PROJECT_ID);

    expect(links).toHaveLength(1);
  });

  it('does NOT react with 🔖 if URL was already saved (duplicate)', async () => {
    const msg1 = buildMessage();
    const msg2 = buildMessage();

    ctx.client.emit(Events.MessageCreate, msg1);
    await new Promise((r) => setTimeout(r, 50));
    ctx.client.emit(Events.MessageCreate, msg2);
    await new Promise((r) => setTimeout(r, 50));

    // First message reacted, second should not
    expect(msg1.react).toHaveBeenCalledWith(BOOKMARK_EMOJI);
    expect(msg2.react).not.toHaveBeenCalled();
  });
});
