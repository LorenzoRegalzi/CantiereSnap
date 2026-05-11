type Level = 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  timestamp: string;
  level: Level;
  handler: string;
  requestId: string;
  userId?: string;
  message: string;
  data?: unknown;
}

export interface Logger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(handlerName: string, requestId: string, userId?: string): Logger {
  function write(level: Level, message: string, data?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      handler: handlerName,
      requestId,
      ...(userId ? { userId } : {}),
      message,
      ...(data !== undefined ? { data } : {}),
    };
    const line = JSON.stringify(entry) + '\n';
    if (level === 'ERROR') {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  return {
    info:  (msg, data) => write('INFO',  msg, data),
    warn:  (msg, data) => write('WARN',  msg, data),
    error: (msg, data) => write('ERROR', msg, data),
  };
}
