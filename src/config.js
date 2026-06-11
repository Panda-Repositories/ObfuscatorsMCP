import "dotenv/config";

function str(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function csv(name) {
  return str(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

const transportFlag = process.argv.includes("--http") ? "http" : null;

export const config = {
  wynfuscator: {
    apiKey: str("WYNFUSCATOR_API_KEY"),
    baseUrl: normalizeBaseUrl(str("WYNFUSCATOR_BASE_URL", "https://wynfuscate.com/api/v1")),
  },
  luraph: {
    apiKey: str("LURAPH_API_KEY"),
    baseUrl: normalizeBaseUrl(str("LURAPH_BASE_URL", "https://api.lura.ph/v1")),
  },
  transport: (transportFlag || str("MCP_TRANSPORT", "stdio")).toLowerCase(),
  http: {
    host: str("MCP_HTTP_HOST", "127.0.0.1"),
    port: int("MCP_HTTP_PORT", 3000),
    authToken: str("MCP_HTTP_AUTH_TOKEN"),
    allowedHosts: csv("MCP_HTTP_ALLOWED_HOSTS"),
  },
  timeouts: {
    httpMs: int("HTTP_TIMEOUT_MS", 60_000),
    obfuscationMs: int("OBFUSCATION_TIMEOUT_MS", 300_000),
  },
};

export const SERVER_INFO = {
  name: "lua-obfuscator-mcp",
  version: "1.0.0",
};
