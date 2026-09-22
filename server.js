/**
 * server.js — local dashboard server. No framework, no runtime dependencies.
 *
 *   GET  /                     dashboard
 *   GET  /api/status           whether the Claude pass, rendering and capture are available
 *   POST /api/analyze          analyse one listing URL and return names
 *   POST /api/capture          receive a listing captured in the user's own browser
 *   GET  /api/capture/status   has a capture for this URL arrived yet?
 *   GET  /api/capture/snippet  the capture snippet, as a bookmarklet and as console text
 *   GET  /capture/receive      landing page the snippet uses when a site blocks its POST
 *   POST /api/open-listing     open a URL in the user's default browser
 *
 * Bound to 127.0.0.1: the capture endpoint accepts cross-origin POSTs (that is
 * the point — they come from the OTA's page), so it must not be reachable from
 * anywhere but this machine, and it only accepts this session's token.
 */

import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './lib/analyze.js';
import { llmStatus } from './lib/llm.js';
import { renderStatus, shutdownRenderer } from './lib/render.js';
import {
  saveCapture, captureStatus, captureToken, snippetSource, bookmarkletHref, receivePageHtml,
} from './lib/capture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(here, '.env'));

const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || process.env.OTA_HOST || (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1');
const PUBLIC_DIR = path.join(here, 'public');
const MAX_BODY = 200_000;
/** A captured page is bigger than an analyse request, but still bounded. */
const MAX_CAPTURE_BODY = 3_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, 200, {
        ...llmStatus(),
        render: renderStatus(),
        capture: { supported: true, token: captureToken() },
        node: process.version,
      });
    }

    /* ------------------------------------------------- browser capture ---- */

    if (url.pathname === '/api/capture') {
      // Called from the OTA's own page, so this one route is cross-origin.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });

      const body = await readJsonBody(req, MAX_CAPTURE_BODY);
      if (body.error) return sendJson(res, 400, { ok: false, error: body.error });
      const saved = saveCapture(body.data || {});
      if (!saved.ok) return sendJson(res, 400, saved);
      console.log(`[capture] received ${Math.round(saved.bytes / 1024)} KB for ${saved.key}`);
      return sendJson(res, 200, saved);
    }

    if (req.method === 'GET' && url.pathname === '/api/capture/status') {
      return sendJson(res, 200, captureStatus(url.searchParams.get('url') || ''));
    }

    if (req.method === 'GET' && url.pathname === '/api/capture/snippet') {
      const origin = `http://${req.headers.host || `127.0.0.1:${PORT}`}`;
      return sendJson(res, 200, {
        bookmarklet: bookmarkletHref(origin),
        console: snippetSource(origin),
      });
    }

    if (req.method === 'GET' && url.pathname === '/capture/receive') {
      const html = receivePageHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (url.pathname === '/api/open-listing') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });
      const body = await readJsonBody(req);
      if (body.error) return sendJson(res, 400, { ok: false, error: body.error });
      return sendJson(res, 200, openInBrowser((body.data || {}).url));
    }

    if (url.pathname === '/api/analyze') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' });
      const body = await readJsonBody(req);
      if (body.error) return sendJson(res, 400, { ok: false, error: body.error });
      const started = Date.now();
      const result = await analyze(body.data || {});
      return sendJson(res, result.ok ? 200 : 200, { ...result, elapsedMs: Date.now() - started });
    }

const MAX_UPLOAD_BODY = 50_000_000;

    /* ---------------------------------------------------- batch generator ---- */

    if (url.pathname === '/api/batch/upload-multiple') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });
      const body = await readJsonBody(req, MAX_UPLOAD_BODY);
      if (body.error) return sendJson(res, 400, { ok: false, error: body.error });
      const files = (body.data && body.data.files) || [];
      if (!Array.isArray(files) || files.length === 0) {
        return sendJson(res, 400, { ok: false, error: 'No files provided.' });
      }

      const uploadsDir = path.join(here, 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const savedPaths = [];
      for (const f of files) {
        if (!f.name || !f.data) continue;
        const safeName = path.basename(f.name);
        const targetPath = path.join(uploadsDir, safeName);
        const buffer = Buffer.from(f.data, 'base64');
        fs.writeFileSync(targetPath, buffer);
        savedPaths.push(targetPath);
      }

      if (savedPaths.length === 0) {
        return sendJson(res, 400, { ok: false, error: 'Failed to save uploaded files.' });
      }

      const execPromise = promisify(execFile);
      try {
        const scriptPath = path.join(here, 'scripts', 'file_processor.py');
        const { stdout } = await execPromise('python3', [scriptPath, ...savedPaths]);
        let parsed = null;
        const firstBrace = stdout.indexOf('{');
        const lastBrace = stdout.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsed = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
          } catch {}
        }
        if (!parsed) {
          const historyPath = path.join(here, 'data', 'runs_history.json');
          if (fs.existsSync(historyPath)) {
            const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
            parsed = history[history.length - 1];
          }
        }

        const processedFiles = (parsed && parsed.processed_files) || [];
        const downloadList = processedFiles.map((fp) => {
          const bname = typeof fp === 'string'
            ? path.basename(fp)
            : (fp.output_name || path.basename(fp.output_path || ''));
          const origName = (typeof fp === 'object' && fp.original_name) ? fp.original_name : bname;
          return {
            originalName: origName,
            fileName: bname,
            downloadUrl: `/api/batch/download-file?name=${encodeURIComponent(bname)}`,
            recordCount: fp.record_count || 0,
            overflowsFixed: fp.overflows_fixed || 0,
            linksResolved: fp.links_resolved || 0,
          };
        });

        const masterFile = parsed && parsed.master_xlsx ? path.basename(parsed.master_xlsx) : '';
        const zipFile = parsed && parsed.zip_file ? path.basename(parsed.zip_file) : '';

        return sendJson(res, 200, {
          ok: true,
          run: {
            ...parsed,
            run_id: parsed && parsed.run_id ? parsed.run_id : `UPLOAD_${parsed && parsed.timestamp ? parsed.timestamp : Date.now()}`,
          },
          downloadFiles: downloadList,
          masterDownloadUrl: masterFile ? `/api/batch/download-file?name=${encodeURIComponent(masterFile)}` : `/api/batch/download?ota=all`,
          zipDownloadUrl: zipFile ? `/api/batch/download-file?name=${encodeURIComponent(zipFile)}` : null,
        });
      } catch (err) {
        console.error('Multi-file batch error:', err);
        return sendJson(res, 500, { ok: false, error: 'Processing uploaded files failed.', detail: String(err && err.message) });
      }
    }

    if (url.pathname === '/api/batch/download-file') {
      const name = path.basename(url.searchParams.get('name') || '');
      if (!name) return sendJson(res, 400, { ok: false, error: 'Filename is required.' });
      const filePath = path.join(here, 'output', name);
      if (!fs.existsSync(filePath)) {
        return sendJson(res, 404, { ok: false, error: 'File not found.' });
      }
      const ext = path.extname(name).toLowerCase();
      const contentType = ext === '.csv'
        ? 'text/csv; charset=utf-8'
        : ext === '.zip'
          ? 'application/zip'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    if (url.pathname === '/api/batch/run') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST.' });
      const body = await readJsonBody(req);
      const scope = (body.data && body.data.scope) || 'all4';
      const execPromise = promisify(execFile);
      try {
        const scriptPath = path.join(here, 'scripts', 'file_processor.py');
        let inputArg = path.join(here, 'data', 'input_properties_all_4ota.xlsx');
        if (scope === '50') {
          inputArg = path.join(here, 'data', 'input_properties_batch_50.xlsx');
        } else if (!fs.existsSync(inputArg)) {
          await execPromise('python3', [path.join(here, 'scripts', 'create_input_batch.py'), '--scope=all4']);
        }
        const { stdout } = await execPromise('python3', [scriptPath, inputArg]);
        let parsed = null;
        const firstBrace = stdout.indexOf('{');
        const lastBrace = stdout.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsed = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
          } catch {}
        }
        if (!parsed) {
          const historyPath = path.join(here, 'data', 'runs_history.json');
          if (fs.existsSync(historyPath)) {
            const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
            parsed = history[history.length - 1];
          }
        }
        return sendJson(res, 200, { ok: true, run: parsed });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: 'Batch run failed.', detail: String(err && err.message) });
      }
    }

    if (url.pathname === '/api/batch/status') {
      const historyPath = path.join(here, 'data', 'runs_history.json');
      let history = [];
      if (fs.existsSync(historyPath)) {
        try {
          history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        } catch {}
      }
      const latest = history.length ? history[history.length - 1] : null;
      return sendJson(res, 200, { ok: true, totalRuns: history.length, latest, history });
    }

    if (url.pathname === '/api/batch/download') {
      const runId = url.searchParams.get('run_id');
      const otaParam = (url.searchParams.get('ota') || '').trim();
      
      const candidates = [];
      if (otaParam && otaParam.toLowerCase() !== 'all') {
        const otaLower = otaParam.toLowerCase();
        const otaMap = {
          airbnb: 'Airbnb',
          booking: 'Booking.com',
          'booking.com': 'Booking.com',
          makemytrip: 'MakeMyTrip',
          agoda: 'Agoda',
        };
        const platName = otaMap[otaLower] || otaParam;
        const platSlug = platName.replace(/\s+/g, '_');
        if (runId) {
          candidates.push(`OTA_Name_Suggestions_${runId}_${platSlug}.xlsx`);
        }
        candidates.push(`OTA_Name_Suggestions_Latest_${platSlug}.xlsx`);
      } else {
        if (runId) {
          candidates.push(`OTA_Name_Suggestions_${runId}.xlsx`);
          candidates.push(`OTA_Automation_Master_${runId}.xlsx`);
          candidates.push(`Automation_Sync_Master_${runId.replace(/^RUN_/, '')}.xlsx`);
        }
        candidates.push('OTA_Name_Suggestions_Latest.xlsx');
      }

      let filename = null;
      for (const cand of candidates) {
        if (fs.existsSync(path.join(here, 'output', cand))) {
          filename = cand;
          break;
        }
      }

      if (!filename) {
        return sendJson(res, 404, { ok: false, error: 'Excel file not found. Run the batch generator first.' });
      }
      const targetFile = path.join(here, 'output', filename);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      });
      return fs.createReadStream(targetFile).pipe(res);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(url.pathname, res);
    }

    return sendJson(res, 404, { error: 'Not found.' });
  } catch (err) {
    console.error('[error]', err);
    if (!res.headersSent) {
      return sendJson(res, 500, { ok: false, error: 'Something went wrong on the server.', detail: String(err && err.message) });
    }
  }
});

server.listen(PORT, HOST, () => {
  const ai = llmStatus();
  console.log(`\n  OTA Property Name Generator`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Mode: ${ai.enabled ? `Engine + Claude (${ai.model})` : 'Engine only (no ANTHROPIC_API_KEY set)'}`);
  const render = renderStatus();
  console.log(`  Rendering: ${render.available
    ? `available via ${render.binary}`
    : render.disabled ? 'disabled (OTA_RENDER=0)' : 'unavailable (no local Chrome or Edge found)'}\n`);
});

// Never leave a headless browser running behind the server.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdownRenderer();
    process.exit(0);
  });
}
process.on('exit', shutdownRenderer);

/* --------------------------------------------------------------- helpers */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, relative);
  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: 'Forbidden.' });
  }
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    return res.end(data);
  });
  return undefined;
}

/**
 * Hands a URL to the user's default browser so they can view the listing and
 * capture it. Only http(s), and only ever the URL the dashboard is analysing.
 */
function openInBrowser(target) {
  let parsed;
  try {
    parsed = new URL(String(target || ''));
  } catch {
    return { ok: false, error: 'Not a valid URL.' };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: 'Only http and https URLs can be opened.' };

  const href = parsed.toString();
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', href]]
    : process.platform === 'darwin'
      ? ['open', [href]]
      : ['xdg-open', [href]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
    return { ok: true, opened: href };
  } catch (err) {
    return { ok: false, error: `Could not open a browser (${err.message}). Open the listing yourself.` };
  }
}

function readJsonBody(req, limit = MAX_BODY) {
  return new Promise((resolve) => {
    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return resolve({ error: 'Request body too large.' });
      if (!raw) return resolve({ data: {} });
      try {
        return resolve({ data: JSON.parse(raw) });
      } catch {
        return resolve({ error: 'Request body was not valid JSON.' });
      }
    });
    req.on('error', () => resolve({ error: 'Could not read the request.' }));
  });
}

/** Minimal .env reader so the optional API key can live in a file. */
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    const value = rawValue.replace(/^["']|["']$/g, '').trim();
    if (value) process.env[key] = value;
  }
}

export default server;

