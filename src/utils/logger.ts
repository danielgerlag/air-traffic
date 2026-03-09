import winston from 'winston';

let loggerInstance: winston.Logger | undefined;

export function createLogger(level: string = 'info', machineName: string = 'unknown'): winston.Logger {
  loggerInstance = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const stackStr = stack ? `\n${stack}` : '';
        return `${timestamp} [${machineName}] ${level.toUpperCase()}: ${message}${metaStr}${stackStr}`;
      }),
    ),
    transports: [
      new winston.transports.Console(),
    ],
  });

  return loggerInstance;
}

export function getLogger(): winston.Logger {
  if (!loggerInstance) {
    return createLogger();
  }
  return loggerInstance;
}
