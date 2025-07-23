export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  component?: string;
  action?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  timestamp?: string;
  [key: string]: any;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context: LogContext;
  timestamp: string;
  error?: Error;
}

class Logger {
  private isDevelopment: boolean;
  private logLevel: LogLevel;
  private globalContext: LogContext;

  constructor() {
    this.isDevelopment = !window.location.hostname.includes('mentatlab.com');
    this.logLevel = this.isDevelopment ? 'debug' : 'info';
    this.globalContext = {
      sessionId: this.generateSessionId(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };
  }

  /**
   * Set global context that will be included in all log entries
   */
  setGlobalContext(context: Partial<LogContext>): void {
    this.globalContext = { ...this.globalContext, ...context };
  }

  /**
   * Debug level logging - for detailed diagnostic information
   */
  debug(message: string, context: LogContext = {}): void {
    this.log('debug', message, context);
  }

  /**
   * Info level logging - for general information
   */
  info(message: string, context: LogContext = {}): void {
    this.log('info', message, context);
  }

  /**
   * Warning level logging - for potentially harmful situations
   */
  warn(message: string, context: LogContext = {}): void {
    this.log('warn', message, context);
  }

  /**
   * Error level logging - for error events
   */
  error(message: string, error?: Error, context: LogContext = {}): void {
    this.log('error', message, { ...context, error: error?.stack });
  }

  /**
   * Log WebSocket events with specific context
   */
  websocket(action: string, context: LogContext = {}): void {
    this.info(`WebSocket ${action}`, {
      ...context,
      component: 'WebSocket',
      action,
    });
  }

  /**
   * Log API requests with specific context
   */
  api(method: string, url: string, status?: number, context: LogContext = {}): void {
    const level = status && status >= 400 ? 'error' : 'info';
    this.log(level, `API ${method} ${url}`, {
      ...context,
      component: 'API',
      method,
      url,
      status,
    });
  }

  /**
   * Log user interactions
   */
  userAction(action: string, context: LogContext = {}): void {
    this.info(`User action: ${action}`, {
      ...context,
      component: 'UserInteraction',
      action,
    });
  }

  /**
   * Log performance metrics
   */
  performance(metric: string, value: number, context: LogContext = {}): void {
    this.info(`Performance: ${metric}`, {
      ...context,
      component: 'Performance',
      metric,
      value,
      unit: 'ms',
    });
  }

  /**
   * Log security events
   */
  security(event: string, context: LogContext = {}): void {
    this.warn(`Security event: ${event}`, {
      ...context,
      component: 'Security',
      event,
    });
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry: LogEntry = {
      level,
      message,
      context: {
        ...this.globalContext,
        ...context,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    // Console output for development
    if (this.isDevelopment) {
      this.logToConsole(logEntry);
    }

    // Send to external logging service in production
    if (!this.isDevelopment) {
      this.sendToLoggingService(logEntry);
    }

    // Store in local storage for debugging (development only)
    if (this.isDevelopment) {
      this.storeLocally(logEntry);
    }
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };

    return levels[level] >= levels[this.logLevel];
  }

  /**
   * Output to browser console with proper formatting
   */
  private logToConsole(entry: LogEntry): void {
    const { level, message, context } = entry;
    const prefix = `[${entry.timestamp}] ${level.toUpperCase()}`;
    const componentPrefix = context.component ? `[${context.component}]` : '';
    const fullMessage = `${prefix} ${componentPrefix} ${message}`;

    switch (level) {
      case 'debug':
        console.debug(fullMessage, context);
        break;
      case 'info':
        console.info(fullMessage, context);
        break;
      case 'warn':
        console.warn(fullMessage, context);
        break;
      case 'error':
        console.error(fullMessage, context);
        break;
    }
  }

  /**
   * Send logs to external service (e.g., Sentry, LogRocket, etc.)
   */
  private sendToLoggingService(entry: LogEntry): void {
    // In a real application, you would send to your logging service
    // Examples:
    // - Sentry.addBreadcrumb({ message: entry.message, level: entry.level, data: entry.context });
    // - LogRocket.log(entry.level, entry.message, entry.context);
    // - fetch('/api/logs', { method: 'POST', body: JSON.stringify(entry) });

    // For now, we'll use a simple beacon API for non-blocking requests
    if ('sendBeacon' in navigator) {
      try {
        navigator.sendBeacon(
          '/api/logs',
          JSON.stringify(entry)
        );
      } catch (error) {
        // Fallback to console if beacon fails
        console.error('Failed to send log to service:', error);
      }
    }
  }

  /**
   * Store logs locally for debugging
   */
  private storeLocally(entry: LogEntry): void {
    try {
      const logs = this.getStoredLogs();
      logs.push(entry);
      
      // Keep only last 100 entries
      if (logs.length > 100) {
        logs.splice(0, logs.length - 100);
      }
      
      localStorage.setItem('mentatlab_logs', JSON.stringify(logs));
    } catch (error) {
      // Ignore localStorage errors
    }
  }

  /**
   * Get logs from local storage
   */
  getStoredLogs(): LogEntry[] {
    try {
      const stored = localStorage.getItem('mentatlab_logs');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Clear stored logs
   */
  clearStoredLogs(): void {
    try {
      localStorage.removeItem('mentatlab_logs');
    } catch (error) {
      // Ignore localStorage errors
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.setGlobalContext({ ...this.globalContext, ...context });
    return childLogger;
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience functions for common use cases
export const logError = (message: string, error?: Error, context?: LogContext) => 
  logger.error(message, error, context);

export const logWarning = (message: string, context?: LogContext) => 
  logger.warn(message, context);

export const logInfo = (message: string, context?: LogContext) => 
  logger.info(message, context);

export const logDebug = (message: string, context?: LogContext) => 
  logger.debug(message, context);

export const logUserAction = (action: string, context?: LogContext) => 
  logger.userAction(action, context);

export const logApiCall = (method: string, url: string, status?: number, context?: LogContext) => 
  logger.api(method, url, status, context);

export const logWebSocketEvent = (action: string, context?: LogContext) => 
  logger.websocket(action, context);

export const logPerformance = (metric: string, value: number, context?: LogContext) => 
  logger.performance(metric, value, context);

export const logSecurityEvent = (event: string, context?: LogContext) => 
  logger.security(event, context);

export default logger;