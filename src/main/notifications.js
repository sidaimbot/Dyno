const http = require('http');
class NotificationServer {
  constructor({ onNotify, onError }) { this.onNotify = onNotify; this.onError = onError; this.server = null; }
  start() {
    this.server = http.createServer((req, res) => {
      const cors = {
        'Access-Control-Allow-Origin': 'null',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type'
      };
      // The island's own "send alert" form posts from a file:// page, so the preflight must succeed.
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method !== 'POST' || req.url !== '/notify') {
        res.writeHead(404); return res.end('Not found');
      }
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          this.onNotify({ title: String(data.title || 'Notification').slice(0, 160),
            message: String(data.message || '').slice(0, 1000), app: String(data.app || 'Local API').slice(0, 80) });
          res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
          res.end(JSON.stringify({ ok: true }));
        } catch (_) { res.writeHead(400); res.end('Invalid JSON'); }
      });
    });
    this.server.on('error', this.onError);
    this.server.listen(47831, '127.0.0.1', () => console.log('Notification API: http://127.0.0.1:47831/notify'));
  }
  stop() { this.server?.close(); }
}
module.exports = { NotificationServer };
