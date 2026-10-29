import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const host = process.env.BACKEND_HOST || '127.0.0.1';
const port = Number(process.env.BACKEND_PORT || 3000);
const origin = process.env.FRONTEND_ORIGIN || 'http://localhost:4200';
const dataDir = resolve('backend/data');
let running = 0;
const jobs = new Map();

await mkdir(dataDir, { recursive: true });
const database = new DatabaseSync(resolve(dataDir, 'inside-verbrechen.sqlite'));
database.exec(`CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, month TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost REAL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL);`);
const usageRows = (month) => database.prepare('SELECT * FROM usage WHERE month = ? ORDER BY created_at DESC').all(month);
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
class HttpError extends Error { constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; } }
const safeEqual = (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function readBody(req) { return new Promise((resolveBody, reject) => { let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 500_000) reject(new Error('Request zu groß (max. 500 KB).')); }); req.on('end', () => { try { resolveBody(JSON.parse(data || '{}')); } catch { reject(new Error('Ungültiges JSON.')); } }); req.on('error', reject); }); }
async function callOpenAI({ model, rateKey, input, tools = [], maxOutputTokens = Number(process.env.MAX_OUTPUT_TOKENS || 6000) }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new HttpError(503, 'OPENAI_API_KEY fehlt in .env.', 'missing_api_key');
  const taskKey = rateKey;
  const inputRateText = process.env[`OPENAI_${taskKey}_INPUT_USD_PER_MILLION`];
  const outputRateText = process.env[`OPENAI_${taskKey}_OUTPUT_USD_PER_MILLION`];
  const inputRate = Number(inputRateText);
  const outputRate = Number(outputRateText);
  const maxSearchCalls = tools.length ? Number(process.env.MAX_WEB_SEARCH_CALLS_PER_JOB || 3) : 0;
  const searchRateText = process.env.WEB_SEARCH_USD_PER_1000_CALLS;
  const searchRate = searchRateText ? Number(searchRateText) : 0;
  if (!inputRateText || !outputRateText || !Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate < 0 || outputRate < 0) {
    throw new HttpError(412, `Kosten für Modellgruppe ${taskKey} unbekannt: OPENAI_${taskKey}_INPUT_USD_PER_MILLION und OPENAI_${taskKey}_OUTPUT_USD_PER_MILLION in .env eintragen.`, 'missing_model_rates');
  }
  if (tools.length && (!searchRateText || !Number.isFinite(searchRate) || searchRate < 0 || !Number.isInteger(maxSearchCalls) || maxSearchCalls < 1 || maxSearchCalls > 10)) {
    throw new HttpError(412, 'Websuchkosten oder Suchlimit fehlen. WEB_SEARCH_USD_PER_1000_CALLS und MAX_WEB_SEARCH_CALLS_PER_JOB in .env prüfen.', 'missing_search_rates');
  }
  const month = new Date().toISOString().slice(0, 7);
  const monthly = Number(database.prepare('SELECT COALESCE(SUM(cost), 0) AS total FROM usage WHERE month = ?').get(month).total);
  const budget = Number(process.env.MONTHLY_BUDGET_USD || 50);
  // Reserve at a conservative one input token per serialized character.
  const estimatedInputTokens = JSON.stringify(input).length;
  const reservation = (estimatedInputTokens * inputRate + maxOutputTokens * outputRate) / 1_000_000 + maxSearchCalls * searchRate / 1000;
  if (monthly + reservation > budget) throw new HttpError(402, `Monatsbudget würde überschritten. Verfügbar: ${(budget - monthly).toFixed(2)} USD; sichere Kostenschätzung: ${reservation.toFixed(2)} USD.`, 'budget_exceeded');
  const response = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/responses`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input, tools: tools.map(tool => tool.type === 'web_search' ? { ...tool, search_context_size: 'low' } : tool), max_output_tokens: maxOutputTokens, ...(tools.length ? { max_tool_calls: maxSearchCalls } : {}) }), signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `OpenAI API (${response.status}): ${payload.error?.message || 'Anfrage abgelehnt.'}`, 'openai_request_failed');
  const content = (payload.output || []).flatMap(item => item.content || []);
  const text = content.filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  const citations = content.flatMap(item => item.annotations || []).filter(item => item.type === 'url_citation').map(item => ({ url: item.url, title: item.title, start: item.start_index, end: item.end_index }));
  const usage = payload.usage || {};
  const searchCalls = (payload.output || []).filter(item => item.type === 'web_search_call' && item.action?.type === 'search').length;
  const tokenCost = (Number(usage.input_tokens || 0) * inputRate + Number(usage.output_tokens || 0) * outputRate) / 1_000_000;
  const webSearchCost = searchCalls * searchRate / 1000;
  const cost = tokenCost + webSearchCost;
  database.prepare('INSERT INTO usage (id,month,model,input_tokens,output_tokens,cost,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), month, model, usage.input_tokens ?? null, usage.output_tokens ?? null, cost, new Date().toISOString());
  return { text, citations, usage: { inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, webSearchCalls: searchCalls, webSearchCostUsd: webSearchCost, costUsd: cost, monthlyCostUsd: monthly + cost } };
}
async function runJob(kind, body) {
  const rateKey = kind === 'topics' ? 'FAST' : kind === 'research' ? 'RESEARCH' : kind === 'audit' ? 'REVIEW' : 'WRITING';
  const model = kind === 'topics' ? process.env.OPENAI_MODEL_FAST || 'gpt-6-luna' : kind === 'research' ? process.env.OPENAI_MODEL_RESEARCH || 'gpt-6.1-sol' : kind === 'audit' ? process.env.OPENAI_MODEL_REVIEW || 'gpt-6-luna' : process.env.OPENAI_MODEL_WRITING || 'gpt-6.1-terra';
  let prompt;
  if (kind === 'topics') prompt = `Schlage genau EINEN realen True-Crime-Fall für einen deutschsprachigen Podcast vor und recherchiere ihn im Web. Fülle title, country, period und category mit konkreten, durch die Recherche gestützten Angaben: country ist das Land des Falls, period der belegte Tatzeitraum oder das belegte Tatjahr, category die sachliche Deliktart und ggf. der Ermittlungsstatus (z. B. Mordserie, Mehrfachmord, ungeklärter Mord). Lasse diese Felder nur dann leer, wenn seriöse Quellen die Angabe tatsächlich nicht feststellen lassen; rate niemals. Fasse Quellenkonflikte oder Unsicherheit knapp in summary zusammen. summary darf nur Fallfakten und deren Unsicherheiten enthalten: keine Empfehlung/Nummer, keine Bewertungsskala, keine Gewichtungen, keine Podcast-Statistik-Analyse und keine Markdown-Tabelle. Podcaststatistiken dürfen nur als Kontext zur Themenwahl dienen; erfinde keine Themenlabels, Beobachtungszeiträume oder Erfolgsprognosen. Bevorzuge keinen bereits behandelten Fall. Antworte ausschließlich mit einem gültigen JSON-Objekt, ohne Markdown und ohne Liste, exakt in diesem Schema: {"title":"Fallname ohne Empfehlungsprefix","country":"Land","period":"belegter Zeitraum oder Jahr","category":"sachliche Deliktart","summary":"Kurze sachliche Beschreibung mit Unsicherheiten"}. Eingaben: ${JSON.stringify(body)}`;
  else if (kind === 'research') prompt = `Recherchiere den Fall anhand seriöser Quellen. Trenne bestätigte Fakten, Behauptungen, Widersprüche und offene Fragen. Behaupte nichts ohne Quelle; gib Fundstellen und URLs an. Fall: ${JSON.stringify(body)}`;
  else if (kind === 'audit') prompt = `Prüfe jede Aussage des Skripts unabhängig gegen die Quellen im Dossier. Markiere belegt, unsicher oder widersprüchlich, mit konkreter Begründung. Erzeuge keine Gewissheit. Dossier und Skript: ${JSON.stringify(body)}`;
  else prompt = `Erstelle zuerst eine Outline und ein vollständiges, natürlich gesprochenes deutsches Podcastskript aus freigegebenem Dossier, Styleprofil und gewünschter Länge. Keine erfundenen Dialoge, Gedanken oder Fakten. Unsicherheit sprachlich markieren. Gib Kapitel und Quellenmarker aus. Dossier und Vorgaben: ${JSON.stringify(body)}`;
  return callOpenAI({ model, rateKey, input: prompt, tools: kind === 'topics' || kind === 'research' ? [{ type: 'web_search' }] : [] });
}
const server = createServer(async (req, res) => {
  const requestOrigin = req.headers.origin;
  const frontend = new URL(origin);
  const requestHost = String(req.headers.host || '').toLowerCase();
  const expectedFrontendHost = `${frontend.hostname}${frontend.port ? `:${frontend.port}` : ''}`.toLowerCase();
  const localHost = ['localhost', '127.0.0.1'].includes(new URL(`http://${requestHost}`).hostname);
  if (requestOrigin && requestOrigin !== frontend.origin) return send(res, 403, { error: 'Ursprung nicht erlaubt. FRONTEND_ORIGIN muss exakt mit der App-Adresse übereinstimmen.' });
  if (!localHost || (!requestOrigin && requestHost !== expectedFrontendHost && requestHost !== `${host}:${port}`)) return send(res, 403, { error: 'Lokaler Zugriff erforderlich; Anfrage-Host passt nicht zur konfigurierten lokalen App.' });
  if (requestOrigin) { res.setHeader('Access-Control-Allow-Origin', frontend.origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Local-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const token = process.env.LOCAL_API_TOKEN;
  if (!token || !safeEqual(String(req.headers['x-local-token'] || ''), token)) return send(res, 401, { error: 'Lokales API-Token fehlt oder ist ungültig.' });
  const path = new URL(req.url, `http://${host}:${port}`).pathname;
  if (req.method === 'GET' && path === '/api/health') { const month = new Date().toISOString().slice(0, 7); const rateStatus = ['FAST','WRITING','RESEARCH','REVIEW'].map(prefix => Boolean(process.env[`OPENAI_${prefix}_INPUT_USD_PER_MILLION`] && process.env[`OPENAI_${prefix}_OUTPUT_USD_PER_MILLION`])); const searchConfigured = Boolean(process.env.WEB_SEARCH_USD_PER_1000_CALLS); return send(res, 200, { configured: Boolean(process.env.OPENAI_API_KEY), costConfigured: rateStatus.every(Boolean) && searchConfigured, configuredRateTasks: rateStatus.filter(Boolean).length, searchConfigured, models: { fast: process.env.OPENAI_MODEL_FAST || 'gpt-6-luna', writing: process.env.OPENAI_MODEL_WRITING || 'gpt-6.1-terra', research: process.env.OPENAI_MODEL_RESEARCH || 'gpt-6.1-sol', review: process.env.OPENAI_MODEL_REVIEW || 'gpt-6-luna' }, maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 1), maxWebSearchCallsPerJob: Number(process.env.MAX_WEB_SEARCH_CALLS_PER_JOB || 3), budgetUsd: Number(process.env.MONTHLY_BUDGET_USD || 50), monthlySpendUsd: Number(database.prepare('SELECT COALESCE(SUM(cost),0) AS total FROM usage WHERE month=?').get(month).total), usage: usageRows(month) }); }
  const match = path.match(/^\/api\/ai\/(topics|research|script|audit)$/);
  if (req.method === 'GET' && path === '/api/jobs') return send(res, 200, database.prepare('SELECT id,kind,status,result,error,created_at FROM jobs ORDER BY created_at DESC LIMIT 100').all());
  if (req.method !== 'POST' || !match) return send(res, 404, { error: 'Route nicht gefunden.' });
  if (running >= Number(process.env.MAX_CONCURRENT_JOBS || 1)) return send(res, 429, { error: 'Maximale Anzahl gleichzeitiger KI-Jobs erreicht.' });
  running++;
  const id = randomUUID(); const createdAt = new Date().toISOString(); jobs.set(id, { id, status: 'running', kind: match[1], startedAt: createdAt });
  database.prepare('INSERT INTO jobs (id,kind,status,created_at) VALUES (?,?,?,?)').run(id, match[1], 'running', createdAt);
  try { const body = await readBody(req); if (match[1] === 'script' && body.approved !== true) throw new Error('Skriptgenerierung nur mit ausdrücklich freigegebenem Dossier.'); const result = await runJob(match[1], body); jobs.set(id, { ...jobs.get(id), status: 'completed' }); database.prepare('UPDATE jobs SET status=?, result=? WHERE id=?').run('completed', result.text, id); send(res, 200, { jobId: id, ...result }); }
  catch (error) { jobs.set(id, { ...jobs.get(id), status: 'failed' }); database.prepare('UPDATE jobs SET status=?, error=? WHERE id=?').run('failed', error.message, id); send(res, error.status || 400, { jobId: id, code: error.code || 'request_failed', error: error.message }); }
  finally { running--; }
});
server.listen(port, host, () => console.log(`Inside Verbrechen API listening on http://${host}:${port}`));
