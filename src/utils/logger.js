/**
 * Compact Logger - Single-line structured logging for production
 *
 * Format: [TAG] message | key=value key=value
 */

// Deduplication state
const state = {
  lastValue: {},
  pollCount: {}
};

const LOG_INTERVAL = 5; // Log polls every N cycles

/**
 * Format metadata object into key=value pairs
 */
function formatMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const pairs = [];
  for (const [key, value] of Object.entries(meta)) {
    const formattedValue = typeof value === 'object'
      ? JSON.stringify(value).slice(0, 50)
      : value;
    pairs.push(`${key}=${formattedValue}`);
  }
  return pairs.join(' ');
}

/**
 * Core log function - outputs single line
 */
function log(tag, message, meta = {}) {
  const metaStr = formatMeta(meta);
  const metaPart = metaStr ? ` | ${metaStr}` : '';
  console.log(`[${tag}] ${message}${metaPart}`);
}

/**
 * Check if value changed (for deduplication)
 */
function hasChanged(key, value) {
  const keyStr = `${key}:${JSON.stringify(value)}`;
  const last = state.lastValue[key];
  state.lastValue[key] = keyStr;
  return last !== keyStr;
}

/**
 * Poll logging (deduplicated - only logs every N cycles or on change)
 */
function poll(tag, meta = {}) {
  const key = `poll:${tag}`;
  state.pollCount[key] = (state.pollCount[key] || 0) + 1;

  if (hasChanged(key, meta) || state.pollCount[key] >= LOG_INTERVAL) {
    state.pollCount[key] = 0;
    log('POLL', tag, meta);
  }
}

// Export functions
module.exports = {
  // Basic
  log,
  info: (tag, msg, meta) => log(tag, msg, meta),
  warn: (tag, msg, meta) => log('WARN', msg, { tag, ...meta }),
  error: (tag, msg, meta) => log('ERROR', msg, { tag, ...meta }),

  // Specialized
  poll,

  // Common tags
  init: (msg, meta) => log('INIT', msg, meta),
  db: (msg, meta) => log('DB', msg, meta),
  system: (msg, meta) => log('SYSTEM', msg, meta),
  worker: (name, action, meta) => log('WORKER', `${name} ${action}`, meta),
  ai: (msg, meta) => log('AI', msg, meta),
  email: (msg, meta) => log('EMAIL', msg, meta),
};
