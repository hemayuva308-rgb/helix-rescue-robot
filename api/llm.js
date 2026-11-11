// Vercel serverless function: POST /api/llm { task, data }. Keys are read from environment variables only.
import { handle } from '../src/llm.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'x').split(',')[0].trim();
  const out = await handle(String(body?.task ?? ''), body?.data ?? {}, process.env, ip);
  res.status(out.status).json(out.body);
}
