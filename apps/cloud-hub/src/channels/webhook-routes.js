'use strict';

// Meta webhook endpoint for Messenger: GET = subscription verify, POST = events.
// POST: signature is checked on the raw bytes BEFORE anything is parsed (S-5.1). We answer 200
// right away and process in the background, because Meta retries slow deliveries (duplicates
// are dropped by message id anyway).
const express = require('express');
const { safeEqual } = require('../ids');

function messengerWebhookRouter({ adapter, chat, verifyToken, logger, onProcessed = () => {} }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && verifyToken && typeof token === 'string' && safeEqual(token, verifyToken) && typeof challenge === 'string' && /^[\w-]{1,200}$/.test(challenge)) {
      return res.type('text/plain').send(challenge);
    }
    res.sendStatus(403);
  });

  router.post('/', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!adapter.verifyWebhook(raw, req.get('x-hub-signature-256'))) {
      logger.warn('fb.webhook_bad_signature', { ip: req.ip });
      return res.status(401).json({ error: 'bad_signature' });
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'bad_json' });
    }
    res.sendStatus(200);
    chat.handleWebhook(body).then(onProcessed, (err) => logger.error('fb.webhook_failed', { error: err && err.message }));
  });

  return router;
}

module.exports = { messengerWebhookRouter };
