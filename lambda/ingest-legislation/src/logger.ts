export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  context?: string;
  minimumLevel?: LogLevel;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

function shouldLog(level: LogLevel, minimum: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minimum];
}

export class Logger {
  private readonly context?: string;
  private readonly minimumLevel: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.context = options.context;
    this.minimumLevel = options.minimumLevel ?? "info";
  }

  private emit(entry: LogEntry) {
    const { level, message, context, timestamp, metadata } = entry;
    const base = {
      level,
      timestamp,
      context,
      message,
      ...((metadata && Object.keys(metadata).length > 0) ? { metadata } : {}),
    };

    switch (level) {
      case "debug":
        console.debug(base);
        break;
      case "info":
        console.info(base);
        break;
      case "warn":
        console.warn(base);
        break;
      case "error":
      default:
        console.error(base);
        break;
    }
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>) {
    if (!shouldLog(level, this.minimumLevel)) {
      return;
    }

    this.emit({
      level,
      message,
      context: this.context,
      timestamp: new Date().toISOString(),
      metadata,
    });
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    this.log("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.log("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.log("error", message, metadata);
  }

  child(context: string): Logger {
    return new Logger({
      context: this.context ? `${this.context}:${context}` : context,
      minimumLevel: this.minimumLevel,
    });
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
