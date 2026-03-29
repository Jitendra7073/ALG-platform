/**
 * System Logger - Captures and stores all system logs for UI display
 *
 * Features:
 * - Captures console output with timestamps
 * - Stores logs in memory (circular buffer)
 * - Categorizes logs by type (info, success, warning, error)
 * - Provides API access to recent logs
 * - Real-time log streaming capability
 */

class SystemLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 logs
    this.listeners = []; // For real-time streaming

    // Log categories with colors and icons
    this.logTypes = {
      info: { icon: 'ℹ️', color: '#3b82f6', label: 'INFO' },
      success: { icon: '✅', color: '#22c55e', label: 'SUCCESS' },
      warning: { icon: '⚠️', color: '#f59e0b', label: 'WARNING' },
      error: { icon: '❌', color: '#ef4444', label: 'ERROR' },
      ai: { icon: '🤖', color: '#8b5cf6', label: 'AI' },
      scraper: { icon: '🔍', color: '#06b6d4', label: 'SCRAPER' },
      email: { icon: '📧', color: '#ec4899', label: 'EMAIL' },
      linkedin: { icon: '💼', color: '#0077b5', label: 'LINKEDIN' },
      retry: { icon: '🔄', color: '#f97316', label: 'RETRY' },
      system: { icon: '⚙️', color: '#6b7280', label: 'SYSTEM' }
    };
  }

  /**
   * Add a log entry
   */
  log(type, message, data = null) {
    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      type: type || 'info',
      message: message,
      data: data
    };

    // Add to logs array
    this.logs.push(logEntry);

    // Keep only maxLogs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Notify listeners
    this.notifyListeners(logEntry);

    // Also log to console (for developers) - ONLY if not being called from interceptor
    if (!this._internalLogging) {
      const typeInfo = this.logTypes[type] || this.logTypes.info;
      // Use original console methods if available (to avoid infinite loop during interception)
      if (this._originalConsole) {
        this._originalConsole.log(`${typeInfo.icon} [${typeInfo.label}] ${message}`, data || '');
      } else {
        console.log(`${typeInfo.icon} [${typeInfo.label}] ${message}`, data || '');
      }
    }
  }

  /**
   * Convenience methods for different log types
   */
  info(message, data) { this.log('info', message, data); }
  success(message, data) { this.log('success', message, data); }
  warning(message, data) { this.log('warning', message, data); }
  error(message, data) { this.log('error', message, data); }
  ai(message, data) { this.log('ai', message, data); }
  scraper(message, data) { this.log('scraper', message, data); }
  email(message, data) { this.log('email', message, data); }
  linkedin(message, data) { this.log('linkedin', message, data); }
  retry(message, data) { this.log('retry', message, data); }
  system(message, data) { this.log('system', message, data); }

  /**
   * Get recent logs
   */
  getLogs(limit = 100, typeFilter = null, searchQuery = null) {
    let filtered = this.logs;

    // Filter by type
    if (typeFilter && typeFilter !== 'all') {
      filtered = filtered.filter(log => log.type === typeFilter);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(query) ||
        (log.data && JSON.stringify(log.data).toLowerCase().includes(query))
      );
    }

    // Return most recent first
    return filtered.slice(-limit).reverse();
  }

  /**
   * Get log statistics
   */
  getStats() {
    const stats = {
      total: this.logs.length,
      byType: {}
    };

    // Initialize counts for all types
    Object.keys(this.logTypes).forEach(type => {
      stats.byType[type] = 0;
    });

    // Count logs by type
    this.logs.forEach(log => {
      if (stats.byType[log.type] !== undefined) {
        stats.byType[log.type]++;
      }
    });

    return stats;
  }

  /**
   * Get recent activity summary
   */
  getRecentActivity(minutes = 5) {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    return this.logs
      .filter(log => new Date(log.timestamp) > cutoff)
      .reverse()
      .slice(0, 20);
  }

  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
    this.log('system', 'Logs cleared');
  }

  /**
   * Add a listener for real-time updates
   */
  addListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * Remove a listener
   */
  removeListener(callback) {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }

  /**
   * Notify all listeners of new log
   */
  notifyListeners(logEntry) {
    this.listeners.forEach(callback => {
      try {
        callback(logEntry);
      } catch (error) {
        console.error('Error notifying log listener:', error);
      }
    });
  }

  /**
   * Export logs as JSON
   */
  export() {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Get log type info
   */
  getTypeInfo(type) {
    return this.logTypes[type] || this.logTypes.info;
  }

  /**
   * Intercept console methods to capture logs
   */
  interceptConsole() {
    const self = this;

    // Store original console methods in the instance for use by log() method
    this._originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console)
    };

    // Flag to prevent infinite loops
    let isIntercepting = false;

    // Override console.log
    console.log = function(...args) {
      // Prevent infinite loop
      if (isIntercepting) return;

      try {
        isIntercepting = true;
        // Call original console.log
        self._originalConsole.log.apply(console, args);

        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');

        // Detect type from message and log
        // Only log if it contains system indicators to avoid noise
        self._internalLogging = true; // Set flag to prevent console output from log()
        try {
          if (message.includes('✅') || message.includes('SUCCESS')) {
            self.log('success', message);
          } else if (message.includes('⚠️') || message.includes('WARNING')) {
            self.log('warning', message);
          } else if (message.includes('❌') || message.includes('ERROR')) {
            self.log('error', message);
          } else if (message.includes('🤖')) {
            self.log('ai', message);
          } else if (message.includes('🔄')) {
            self.log('retry', message);
          } else if (message.includes('⚙️')) {
            self.log('system', message);
          }
        } finally {
          self._internalLogging = false; // Clear flag
        }
      } finally {
        isIntercepting = false;
      }
    };

    // Override console.error
    console.error = function(...args) {
      if (isIntercepting) return;

      try {
        isIntercepting = true;
        self._originalConsole.error.apply(console, args);
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        self._internalLogging = true;
        try {
          self.log('error', message);
        } finally {
          self._internalLogging = false;
        }
      } finally {
        isIntercepting = false;
      }
    };

    // Override console.warn
    console.warn = function(...args) {
      if (isIntercepting) return;

      try {
        isIntercepting = true;
        self._originalConsole.warn.apply(console, args);
        const message = args.map(arg =>
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        self._internalLogging = true;
        try {
          self.log('warning', message);
        } finally {
          self._internalLogging = false;
        }
      } finally {
        isIntercepting = false;
      }
    };
  }

  /**
   * Get formatted logs for display
   */
  getFormattedLogs(limit = 100) {
    return this.getLogs(limit).map(log => {
      const typeInfo = this.getTypeInfo(log.type);
      return {
        ...log,
        icon: typeInfo.icon,
        color: typeInfo.color,
        label: typeInfo.label,
        formattedTime: new Date(log.timestamp).toLocaleTimeString()
      };
    });
  }
}

// Export singleton
module.exports = new SystemLogger();
