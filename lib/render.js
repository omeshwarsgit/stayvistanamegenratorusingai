/**
 * render.js — last-resort strategy: render the listing in a real browser engine.
 *
 * Some OTAs ship an empty shell and build the page client-side. Executing the
 * page's own app is the only way to read content that is otherwise public, so
 * this drives locally installed Chrome (or Edge) headlessly over the DevTools
 * protocol. Zero dependencies: Node's global WebSocket speaks CDP directly.
 *
 * The boundary this module will not cross: if the rendered page turns out to be
 * a bot-protection challenge, a CAPTCHA or a login wall, it stops and reports
 * `blocked`. It never waits for a challenge to clear, solves one, or replays
 * session cookies — a gated listing stays gated, and the user is offered the
 * manual paste path instead.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isStubResponse } from './parsers/adapters.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CHROME_CANDIDATES = [
  process.env.OTA_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/** Markers that mean "this is a gate, not the listing". */
const GATE_MARKERS = [
  /are you a (?:robot|human)/i,
  /verify (?:you are|that you are) (?:a )?human/i,
  /unusual traffic/i,
  /access (?:to this page has been )?denied/i,
  /enable javascript and cookies to continue/i,
  /px-captcha|_Incapsula_|cf-browser-verification|cf_chl_opt|awsWafCookieDomainList|aws-waf-token|datadome/i,
  /just a moment\s*(?:\.\.\.|…)/i,
  /\bcaptcha\b/i,
  /sign in to (?:continue|view)/i,
  /log in to (?:continue|view)/i,
];

const LAUNCH_TIMEOUT_MS = 20_000;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;
const IDLE_SHUTDOWN_MS = 60_000;

let browser = null;
let idleTimer = null;
let queue = Promise.resolve();

export function renderStatus() {
  const binary = findBrowser();
  return {
    available: Boolean(binary) && process.env.OTA_RENDER !== '0',
    binary: binary ? path.basename(binary) : null,
    disabled: process.env.OTA_RENDER === '0',
  };
}

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* unreadable path */
    }
  }
  return null;
}

/**
 * Renders one URL and returns its DOM after the client-side app has run.
 * Serialised: one page at a time, so a shared laptop is never asked to hold
 * several Chrome tabs open at once.
 */
export function renderPage(url, options = {}) {
  const run = () => renderOnce(url, options);
  queue = queue.then(run, run);
  return queue;
}

async function renderOnce(url, { settleMs = SETTLE_MS } = {}) {
  const status = renderStatus();
  if (!status.available) {
    return { ok: false, reason: status.disabled ? 'render-disabled' : 'no-browser', message: status.disabled ? 'Browser rendering is switched off (OTA_RENDER=0).' : 'No local Chrome or Edge installation was found to render with.' };
  }

  let session;
  try {
    session = await getSession();
  } catch (err) {
    return { ok: false, reason: 'render-launch-failed', message: `Could not start the local browser (${err.message}).` };
  }

  let target;
  try {
    target = await session.openTarget();
    const navigation = await target.navigate(url, NAV_TIMEOUT_MS);
    if (!navigation.ok) {
      return { ok: false, reason: 'render-navigation-failed', message: navigation.message };
    }

    await sleep(settleMs);
    const html = await target.evaluate('document.documentElement.outerHTML');
    const text = await target.evaluate('(document.body && document.body.innerText || "").slice(0, 4000)');
    const finalUrl = await target.evaluate('location.href');

    const probe = `${String(text || '')}\n${String(html || '').slice(0, 20000)}`;
    if (GATE_MARKERS.some((re) => re.test(probe))) {
      return {
        ok: false,
        reason: 'blocked',
        message: 'The rendered page was a bot-protection or sign-in gate, not the listing. Nothing was bypassed.',
      };
    }
    // A real browser can be served the same empty placeholder as a script.
    if (isStubResponse(text, null) || isStubResponse(stripTags(html), null)) {
      return {
        ok: false,
        reason: 'stub',
        message: 'The OTA served the same short placeholder to a real browser, so the listing is not in the response at all.',
      };
    }
    if (!html || html.length < 500) {
      return { ok: false, reason: 'render-empty', message: 'The browser loaded the URL but the page had no content.' };
    }

    return {
      ok: true,
      html,
      finalUrl: typeof finalUrl === 'string' ? finalUrl : url,
      textLength: String(text || '').length,
      bytes: html.length,
    };
  } catch (err) {
    return { ok: false, reason: 'render-error', message: `Rendering failed (${err.message}).` };
  } finally {
    if (target) await target.close().catch(() => {});
    scheduleIdleShutdown();
  }
}

/* ------------------------------------------------------------ CDP session */

async function getSession() {
  if (browser && browser.alive) {
    clearTimeout(idleTimer);
    return browser;
  }
  browser = await launch();
  return browser;
}

async function launch() {
  const binary = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-render-'));
  const child = spawn(binary, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    '--window-size=1366,900',
    `--user-agent=${UA}`,
    '--lang=en-IN',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  const port = await waitForPort(path.join(profile, 'DevToolsActivePort'), child);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = await openSocket(version.webSocketDebuggerUrl);

  const session = {
    alive: true,
    child,
    profile,
    socket,
    nextId: 0,
    pending: new Map(),
    listeners: new Set(),
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        session.nextId += 1;
        const id = session.nextId;
        session.pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        setTimeout(() => {
          if (session.pending.delete(id)) reject(new Error(`${method} timed out`));
        }, NAV_TIMEOUT_MS);
      });
    },
    async openTarget() {
      const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
      await session.send('Page.enable', {}, sessionId);
      await session.send('Runtime.enable', {}, sessionId);
      return makeTarget(session, targetId, sessionId);
    },
    close() {
      session.alive = false;
      try { socket.close(); } catch { /* already closed */ }
      try { child.kill(); } catch { /* already gone */ }
      setTimeout(() => {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* profile locked */ }
      }, 500);
    },
  };

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.id && session.pending.has(message.id)) {
      const { resolve, reject } = session.pending.get(message.id);
      session.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || 'CDP error'));
      else resolve(message.result);
      return;
    }
    for (const listener of session.listeners) listener(message);
  };
  socket.onclose = () => { session.alive = false; };
  child.on('exit', () => { session.alive = false; });

  return session;
}

function makeTarget(session, targetId, sessionId) {
  return {
    async navigate(url, timeoutMs) {
      const events = [];
      const listener = (message) => {
        if (message.sessionId !== sessionId) return;
        if (message.method === 'Page.loadEventFired') events.push('load');
        if (message.method === 'Page.navigatedWithinDocument') events.push('load');
      };
      session.listeners.add(listener);
      try {
        const result = await session.send('Page.navigate', { url }, sessionId);
        if (result && result.errorText) {
          return { ok: false, message: `The browser could not load the page (${result.errorText}).` };
        }
        const deadline = Date.now() + timeoutMs;
        while (!events.length && Date.now() < deadline) await sleep(150);
        return { ok: true, loaded: events.length > 0 };
      } finally {
        session.listeners.delete(listener);
      }
    },
    async evaluate(expression) {
      const { result } = await session.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: false,
      }, sessionId);
      return result ? result.value : null;
    },
    close() {
      return session.send('Target.closeTarget', { targetId });
    },
  };
}

function waitForPort(portFile, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    let exited = false;
    child.once('exit', () => { exited = true; });
    const tick = () => {
      if (exited) return reject(new Error('the browser exited before it was ready'));
      try {
        const first = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (first) return resolve(first);
      } catch {
        /* not written yet */
      }
      if (Date.now() > deadline) return reject(new Error('the browser did not expose a debugging port in time'));
      return setTimeout(tick, 200);
    };
    tick();
  });
}

function openSocket(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const timer = setTimeout(() => reject(new Error('debugger connection timed out')), LAUNCH_TIMEOUT_MS);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(socket);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('could not connect to the browser debugger'));
    };
  });
}

function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (browser) {
      browser.close();
      browser = null;
    }
  }, IDLE_SHUTDOWN_MS);
  if (idleTimer.unref) idleTimer.unref();
}

/** Called on process shutdown so no headless Chrome is left running. */
export function shutdownRenderer() {
  clearTimeout(idleTimer);
  if (browser) {
    browser.close();
    browser = null;
  }
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
