/**
 * 统一日志工具
 *
 * 提供带时间戳、模块标签、日志级别的结构化日志输出。
 * 通过环境变量 LOG_LEVEL 控制日志级别（默认 debug）。
 *
 * 用法：
 *   import { createLogger } from './utils/logger.js';
 *   const log = createLogger('ModuleName');
 *   log.info('something happened', { key: 'value' });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

function getCurrentLevel(): LogLevel {
    const env = (process.env.LOG_LEVEL ?? 'debug').toLowerCase();
    if (env in LOG_LEVEL_PRIORITY) {
        return env as LogLevel;
    }
    return 'debug';
}

function timestamp(): string {
    return new Date().toISOString();
}

function formatExtra(args: unknown[]): string {
    if (args.length === 0) return '';
    return (
        ' ' +
        args
            .map((a) => {
                if (a instanceof Error) {
                    return `${a.message}\n${a.stack ?? ''}`;
                }
                if (typeof a === 'object' && a !== null) {
                    try {
                        return JSON.stringify(a, null, 2);
                    } catch {
                        return String(a);
                    }
                }
                return String(a);
            })
            .join(' ')
    );
}

export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}

export function createLogger(module: string): Logger {
    const minLevel = LOG_LEVEL_PRIORITY[getCurrentLevel()];

    function shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] >= minLevel;
    }

    function log(level: LogLevel, message: string, args: unknown[]): void {
        if (!shouldLog(level)) return;

        const prefix = `${timestamp()} [${level.toUpperCase().padEnd(5)}] [${module}]`;
        const extra = formatExtra(args);
        const line = `${prefix} ${message}${extra}`;

        switch (level) {
            case 'debug':
                console.debug(line);
                break;
            case 'info':
                console.info(line);
                break;
            case 'warn':
                console.warn(line);
                break;
            case 'error':
                console.error(line);
                break;
        }
    }

    return {
        debug: (message: string, ...args: unknown[]) => log('debug', message, args),
        info: (message: string, ...args: unknown[]) => log('info', message, args),
        warn: (message: string, ...args: unknown[]) => log('warn', message, args),
        error: (message: string, ...args: unknown[]) => log('error', message, args),
    };
}
