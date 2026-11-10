// Zero-dependency server: static files + two small tool endpoints.
//   POST /api/alert  -> sends a Telegram message if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, otherwise logs (mock).
//   POST /api/brief  -> optional advisory briefing from an OpenAI-compatible endpoint (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).
//                       The briefing is advisory text only; it never reaches the safety gate.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

async function body(req) { let b = ''; for await (const c of req) { b += c; if (b.length > 20000) break; } try { return JSON.parse(b || '{}'); } catch { return {}; } }
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function alertHandler(req, res) {
  const { message = '' } = await body(req);
  const text = String(message).slice(0, 1000);
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.log('[alert:mock]', text); return send(res, 200, { sent: false, mode: 'mock' }); }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: `[SIMULATION] ${text}` }) });
    return send(res, 200, { sent: r.ok, mode: 'telegram', status: r.status });
  } catch (e) { return send(res, 200, { sent: false, mode: 'telegram', error: String(e.message ?? e) }); }
}

async function briefHandler(req, res) {
  const { summary = {} } = await body(req);
  const base = process.env.LLM_BASE_URL, key = process.env.LLM_API_KEY, model = process.env.LLM_MODEL;
  const fallback = `Advisory briefing (template): outcome ${summary.outcome ?? 'n/a'} in ${summary.t ?? '?'}s. Every lift, dispatch and public alert needed commander approval; the safety gate blocked ${summary.gateStats?.blocked ?? 0} proposed actions.`;
  if (!base || !key || !model) return send(res, 200, { mode: 'template', text: fallback });
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You write a 3-sentence incident briefing for a rescue commander from a JSON summary of a SIMULATION. Plain words. Do not invent facts. Do not give medical advice.' }, { role: 'user', content: JSON.stringify(summary).slice(0, 4000) }] }) });
    const j = await r.json();
    return send(res, 200, { mode: 'llm', text: j.choices?.[0]?.message?.content ?? fallback });
  } catch { return send(res, 200, { mode: 'template', text: fallback }); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/alert') return alertHandler(req, res);
  if (req.method === 'POST' && url.pathname === '/api/brief') return briefHandler(req, res);
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN), llm: Boolean(process.env.LLM_API_KEY) });
  let p = url.pathname === '/' ? '/web/index.html' : url.pathname;
  p = normalize(p).replace(/^(\.\.[/\\])+/, '');
  const allowed = p.startsWith('/web/') || p.startsWith('/src/') || p.startsWith('/eval/') || p === '/README.md';
  if (!allowed) { res.writeHead(404); return res.end('not found'); }
  try { const data = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log(`Helix Command on http://localhost:${PORT}`));
