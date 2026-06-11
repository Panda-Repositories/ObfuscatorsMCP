import { logger } from "./logger.js";
import { ObfuscationError } from "./errors.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const asInt = Number.parseInt(headerValue, 10);
  if (Number.isFinite(asInt)) return Math.max(0, asInt * 1000);
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

export async function httpRequest(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 60_000,
    retries = 3,
    provider = "HTTP",
  } = options;

  let attempt = 0;
  let lastError;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const backoff = retryAfter ?? Math.min(1000 * 2 ** attempt, 15_000);
        logger.warn(
          `${provider}: ${response.status} from ${method} ${redact(url)}; retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`,
        );
        await response.body?.cancel?.().catch(() => {});
        await sleep(backoff);
        attempt += 1;
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      const isAbort = err?.name === "AbortError";
      const reason = isAbort ? `timed out after ${timeoutMs}ms` : err?.message || String(err);

      if (attempt < retries && !isAbort) {
        const backoff = Math.min(1000 * 2 ** attempt, 15_000);
        logger.warn(
          `${provider}: network error on ${method} ${redact(url)} (${reason}); retrying in ${backoff}ms`,
        );
        await sleep(backoff);
        attempt += 1;
        continue;
      }

      throw new ObfuscationError(
        `${provider}: request failed for ${method} ${redact(url)} (${reason})`,
        { provider, cause: err },
      );
    }
  }

  throw new ObfuscationError(
    `${provider}: request failed after ${retries + 1} attempts`,
    { provider, cause: lastError },
  );
}

function redact(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
