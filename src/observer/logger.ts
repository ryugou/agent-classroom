type Level = 'info' | 'warn' | 'error';
export const logger = {
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
};
function log(level: Level, msg: string, meta?: unknown): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta ? { meta } : {}) });
  process.stderr.write(line + '\n');
}
