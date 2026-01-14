export interface LogEntry {
    timestamp: string;
    source: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
}

const MAX_LOGS = 500;
const logs: LogEntry[] = [];

/**
 * Add a new log entry to the in-memory store
 */
export function log(source: string, message: string, level: LogEntry['level'] = 'info'): void {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        source,
        level,
        message: message.trim(),
    };

    // Also log to console for terminal visibility
    const coloredLevel = level.toUpperCase();
    console.log(`[${entry.timestamp}] [${source}] [${coloredLevel}] ${message}`);

    logs.push(entry);

    // Keep logs under the limit
    if (logs.length > MAX_LOGS) {
        logs.shift();
    }
}

/**
 * Get all logs
 */
export function getLogs(): LogEntry[] {
    return [...logs];
}

/**
 * Clear all logs (e.g., between rounds)
 */
export function clearLogs(): void {
    logs.length = 0;
}
