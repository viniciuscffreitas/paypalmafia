import express from 'express';
import type { BotModule } from './types';
import { createLogger } from './core/logger';

const logger = createLogger('server');

export function createWebhookServer(modules: BotModule[], port: number): express.Application {
  const app = express();

  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  for (const module of modules) {
    if (module.webhookRoutes) {
      app.use(`/webhooks/${module.name}`, module.webhookRoutes);
      logger.info(`Webhook routes registered: /webhooks/${module.name}`);
    }
  }

  app.listen(port, () => {
    logger.info(`Webhook server listening on port ${port}`);
  });

  return app;
}
