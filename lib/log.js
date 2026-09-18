/**
 * log.js — structured development logging for one extraction.
 *
 * Prints a compact block per analysis and returns the same information as data
 * so the API can hand it back. It logs *what happened*, never *what was sent*:
 * request headers, cookies, tokens and API keys are never passed in here, and
 * URLs are logged with their query string stripped so booking/session
 * parameters cannot leak into a log file.
 *
 * Silence it with OTA_LOG=0.
 */

const ENABLED = process.env.OTA_LOG !== '0';

const STRATEGY_LABELS = {
  fetch: 'Direct fetch',
  html: 'HTML extraction',
  json: 'JSON extraction',
  embedded: 'Embedded JSON extraction',
  ota: 'OTA-specific extraction',
  render: 'Browser rendering',
  pasted: 'Pasted details',
};

export function createTrace({ ota, url }) {
  const steps = [];
  const trace = {
    ota,
    url: safeUrl(url),
    responseType: null,
    fields: 0,
    steps,

    responseKind(contentType, status, bytes) {
      trace.responseType = contentType || 'unknown';
      trace.httpStatus = status;
      trace.bytes = bytes || 0;
      return trace;
    },

    /** @param {'success'|'failed'|'skipped'} status */
    step(strategy, status, { fields = 0, note = null } = {}) {
      steps.push({
        strategy,
        label: STRATEGY_LABELS[strategy] || strategy,
        status,
        fields,
        note: note ? String(note).slice(0, 300) : null,
      });
      return trace;
    },

    finish(fields) {
      trace.fields = fields;
      if (ENABLED) print(trace);
      return trace;
    },

    toJSON() {
      return {
        ota: trace.ota,
        responseType: trace.responseType,
        httpStatus: trace.httpStatus || null,
        bytes: trace.bytes || 0,
        fields: trace.fields,
        steps,
      };
    },
  };
  return trace;
}

function print(trace) {
  const lines = [
    '',
    `[analyze] ${trace.url}`,
    `  OTA detected: ${trace.ota}`,
    `  Response type: ${trace.responseType || 'none'}${trace.httpStatus ? ` (HTTP ${trace.httpStatus}, ${formatBytes(trace.bytes)})` : ''}`,
  ];
  for (const step of trace.steps) {
    const detail = [
      step.status.toUpperCase(),
      step.fields ? `${step.fields} fields` : null,
      step.note,
    ].filter(Boolean).join(' · ');
    lines.push(`  ${step.label}: ${detail}`);
  }
  lines.push(`  Fields extracted: ${trace.fields}`);
  console.log(lines.join('\n'));
}

/** Query strings on OTA URLs carry session and search parameters — drop them. */
function safeUrl(url) {
  if (!url) return '(pasted details)';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
