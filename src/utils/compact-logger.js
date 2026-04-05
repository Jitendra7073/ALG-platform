// src/utils/compact-logger.js
const LOG_LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', SUCCESS: 'SUCCESS', POLL: 'POLL' };

function log(level, component, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${timestamp}] ${level} | ${component} | ${message}${dataStr}`);
}

module.exports = {
  info: (c, m, d) => log('INFO', c, m, d),
  warn: (c, m, d) => log('WARN', c, m, d),
  error: (c, m, d) => log('ERROR', c, m, d),
  success: (c, m, d) => log('SUCCESS', c, m, d),
  // Compact polling log - single line with key=value pairs
  poll: (worker, stats) => {
    const s = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[POLL] ${worker} | ${s}`);
  }
};
