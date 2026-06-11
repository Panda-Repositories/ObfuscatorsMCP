const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const configuredLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const threshold = LEVELS[configuredLevel] ?? LEVELS.info;

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  process.stderr.write(
    `${ts} [${level.toUpperCase()}] ${args
      .map((a) => (typeof a === "string" ? a : safeStringify(a)))
      .join(" ")}\n`,
  );
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const logger = {
  debug: (...args) => emit("debug", args),
  info: (...args) => emit("info", args),
  warn: (...args) => emit("warn", args),
  error: (...args) => emit("error", args),
};
