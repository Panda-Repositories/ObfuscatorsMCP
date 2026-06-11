# Lua Obfuscator MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes two Lua/Luau obfuscation
services — **[wYnFuscator](https://wynfuscate.com)** and **[Luraph](https://lura.ph)** — as tools
any MCP client (Claude Desktop, Claude Code, Cursor, etc.) can call.

Give it a `.lua` file or inline code and it submits the obfuscation job, waits for it to finish,
and returns the protected script.

- **Node.js** (>= 18), zero native build steps. Uses the built-in `fetch`/`FormData`.
- Built on the official `@modelcontextprotocol/sdk`.
- Secrets via `.env`. Talks to both providers over HTTPS.
- Two transports: **stdio** (default) and **Streamable HTTP**.

---

## Tools

| Tool | Provider | Description |
| --- | --- | --- |
| `wynfuscator_obfuscate` | wYnFuscator | Obfuscate a script (submit → poll → download). Optimized for Roblox/Luau. |
| `wynfuscator_job_status` | wYnFuscator | Get status/metadata of an existing job by id. |
| `wynfuscator_download` | wYnFuscator | Download a completed job's result (retained 14 days). |
| `wynfuscator_delete_job` | wYnFuscator | Delete a job and free storage. |
| `luraph_obfuscate` | Luraph | Obfuscate a script (auto-selects a node, submits, waits, downloads). Lua 5.1–5.4, LuaJIT, Luau, Roblox, FiveM. |
| `luraph_list_nodes` | Luraph | List nodes, the recommended node, and each node's configurable options. |
| `lua_dev_stubs` | both | Return passthrough macro stubs (`WYNF_*` / `LPH_*`) so a script runs unobfuscated. No API key needed. |

### Input (both obfuscate tools)

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | Inline Lua source. Provide this **or** `filePath`. |
| `filePath` | string | Path to a `.lua` file to read. |
| `fileName` | string | Name to associate with the upload. Defaults to the file name or `script.lua`. |
| `outputPath` | string | If set, writes the result to this path instead of returning it inline (recommended for large outputs). |

**`wynfuscator_obfuscate`** extras: `targetPlatform` (`AUTO`, `ROBLOX`, `ROBLOX_COMPAT`, `LUAU`,
`LUA51`–`LUA54`, `LUAJIT`), `securityTier` (`STANDARD`, `ENHANCED`, `MAX`), `node` (`STABLE`/`BETA`),
`enhancedCompression`, `autoApplyMacros`, `optimizeSource`, `enableLineInfo`, `performanceMode`,
`deleteAfterDownload`.

**`luraph_obfuscate`** extras: `node` (defaults to recommended), `options` (map of option ID → value;
discover IDs with `luraph_list_nodes`), `useTokens`, `enforceSettings`. Missing options are
auto-filled with safe defaults, so calls work out of the box — but for best results set the
`required` options explicitly.

---

## Setup

```bash
npm install
cp .env.example .env   # then edit .env and add your API key(s)
```

Get your keys:

- **wYnFuscator** — Dashboard → Settings → API Keys (requires a **Pro/Enterprise** plan). Format: `wynf_...`.
- **Luraph** — Dashboard → Account → API Details → *Generate API Token*.

You can configure just one provider; only that provider's tools will work, and the others return a
clear configuration error.

---

## Running

### stdio (default — for Claude Desktop / Claude Code)

```bash
npm start
```

#### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "lua-obfuscator": {
      "command": "node",
      "args": ["C:/Users/SkieHackerYT/Desktop/ObfuscatorMCP/src/index.js"],
      "env": {
        "WYNFUSCATOR_API_KEY": "wynf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "LURAPH_API_KEY": "your-luraph-token"
      }
    }
  }
}
```

> The `env` block here is an alternative to a `.env` file — use whichever you prefer.

### Streamable HTTP

```bash
npm run start:http
# or: MCP_TRANSPORT=http npm start
```

Endpoint: `POST/GET/DELETE http://127.0.0.1:3000/mcp` (plus `GET /health`).

Point an HTTP-capable MCP client at the `/mcp` URL. If `MCP_HTTP_AUTH_TOKEN` is set, send
`Authorization: Bearer <token>` on every request.

### Inspect / debug

```bash
npm run inspect   # opens the MCP Inspector against this server
```

### Docker (HTTP transport)

```bash
docker build -t lua-obfuscator-mcp .
docker run --rm -p 3000:3000 \
  -e WYNFUSCATOR_API_KEY=wynf_... \
  -e LURAPH_API_KEY=... \
  -e MCP_HTTP_AUTH_TOKEN=choose-a-strong-token \
  lua-obfuscator-mcp
```

The image binds `0.0.0.0` and runs the HTTP transport; DNS-rebinding protection auto-enables and you
should set `MCP_HTTP_AUTH_TOKEN` (and optionally `MCP_HTTP_ALLOWED_HOSTS`) before exposing it.

---

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `WYNFUSCATOR_API_KEY` | — | wYnFuscator API key (`wynf_...`). |
| `WYNFUSCATOR_BASE_URL` | `https://wynfuscate.com/api/v1` | Override the API base URL. |
| `LURAPH_API_KEY` | — | Luraph API token (sent as `Luraph-API-Key`). |
| `LURAPH_BASE_URL` | `https://api.lura.ph/v1` | Override the API base URL. |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind host. |
| `MCP_HTTP_PORT` | `3000` | HTTP bind port. |
| `MCP_HTTP_AUTH_TOKEN` | — | If set, require `Authorization: Bearer <token>` on `/mcp`. |
| `MCP_HTTP_ALLOWED_HOSTS` | — | Comma-separated Host allow-list (enables DNS-rebinding protection). |
| `HTTP_TIMEOUT_MS` | `60000` | Per-request timeout. |
| `OBFUSCATION_TIMEOUT_MS` | `300000` | Overall budget for one obfuscation job. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent`. |

---

## Example calls

Obfuscate inline code with wYnFuscator for Roblox at MAX security:

```json
{
  "name": "wynfuscator_obfuscate",
  "arguments": {
    "code": "print('hello')",
    "fileName": "main.lua",
    "targetPlatform": "ROBLOX",
    "securityTier": "MAX"
  }
}
```

Obfuscate a file with Luraph, writing the result to disk:

```json
{
  "name": "luraph_obfuscate",
  "arguments": {
    "filePath": "./scripts/main.lua",
    "options": { "TARGET_VERSION": "Luau", "INTENSE_VM_STRUCTURE": true },
    "outputPath": "./dist/main.obfuscated.lua"
  }
}
```

Discover Luraph option IDs first:

```json
{ "name": "luraph_list_nodes", "arguments": {} }
```

---

## Notes & limits

- **wYnFuscator**: file size max 5 MB (Pro) / 10 MB (Enterprise). Results retained 14 days. Job
  polling uses exponential backoff (2 s → 30 s, capped at 120 checks).
- **Luraph**: file size max 50 MB. Results expire **24 h** after obfuscation — download promptly or
  use `outputPath`. The `/status` endpoint long-polls (≤ 60 s) and is re-polled until completion.
- API keys are never logged. Keep `.env` out of version control (already in `.gitignore`).

## Project layout

```
src/
  index.js              entry: stdio | http transport selection
  server.js             McpServer factory + client wiring
  tools.js              MCP tool definitions (zod schemas + handlers)
  stubs.js              wYnFuscator/Luraph macro dev-stub text
  config.js             env loading/validation
  logger.js             stderr-only logger
  http.js               fetch wrapper: timeouts, 429/5xx retry w/ backoff
  errors.js             error types + HTTP error formatting
  util.js               input resolution, file IO, formatting
  providers/
    wynfuscator.js      wYnFuscator API client
    luraph.js           Luraph API client
test/
  smoke.mjs             offline MCP-handshake test
```

## License

MIT
