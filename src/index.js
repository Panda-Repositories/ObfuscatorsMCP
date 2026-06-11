#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";

import { config, SERVER_INFO } from "./config.js";
import { createServer, createClients } from "./server.js";
import { logger } from "./logger.js";

function logStartupBanner() {
  const providers = [];
  if (config.wynfuscator.apiKey) providers.push("wYnFuscator");
  if (config.luraph.apiKey) providers.push("Luraph");
  logger.info(
    `${SERVER_INFO.name} v${SERVER_INFO.version} starting (transport: ${config.transport})`,
  );
  if (providers.length) {
    logger.info(`Configured providers: ${providers.join(", ")}`);
  } else {
    logger.warn(
      "No provider API keys set. Tools will return a configuration error until you set " +
        "WYNFUSCATOR_API_KEY and/or LURAPH_API_KEY.",
    );
  }
}

function isLoopbackHost(host) {
  const h = String(host).toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost" || h.startsWith("127.");
}

function tokensMatch(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function runStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Listening on stdio.");

  const shutdown = async () => {
    logger.info("Shutting down...");
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function runHttp() {
  const clients = createClients();
  const app = express();
  app.use(express.json({ limit: "64mb" }));

  const requireAuth = (req, res, next) => {
    if (!config.http.authToken) return next();
    const header = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!tokensMatch(token, config.http.authToken)) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
    }
    return next();
  };

  app.get("/health", (_req, res) => res.json({ ok: true, server: SERVER_INFO }));

  const transports = new Map();

  let dnsProtection = {};
  if (config.http.allowedHosts.length) {
    dnsProtection = {
      enableDnsRebindingProtection: true,
      allowedHosts: config.http.allowedHosts,
    };
  } else if (!isLoopbackHost(config.http.host)) {
    const derived = [config.http.host, `${config.http.host}:${config.http.port}`];
    dnsProtection = { enableDnsRebindingProtection: true, allowedHosts: derived };
    logger.warn(
      `Binding to non-loopback host ${config.http.host} with no MCP_HTTP_ALLOWED_HOSTS set; ` +
        `auto-enabling DNS-rebinding protection for: ${derived.join(", ")}. ` +
        `Set MCP_HTTP_ALLOWED_HOSTS explicitly (and MCP_HTTP_AUTH_TOKEN) before exposing this server.`,
    );
  }

  app.post("/mcp", requireAuth, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport && !sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          ...dnsProtection,
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
            logger.info(`HTTP session initialized: ${sid}`);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
            logger.info(`HTTP session closed: ${transport.sessionId}`);
          }
        };
        const server = createServer(clients);
        await server.connect(transport);
      } else if (!transport) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no valid session ID, or not an initialize request.",
          },
          id: null,
        });
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error(`HTTP /mcp POST error: ${err?.stack || err?.message || err}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const handleSessionRequest = async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      return res.status(400).send("Invalid or missing session ID");
    }
    await transport.handleRequest(req, res);
  };

  app.get("/mcp", requireAuth, handleSessionRequest);
  app.delete("/mcp", requireAuth, handleSessionRequest);

  const httpServer = app.listen(config.http.port, config.http.host, () => {
    logger.info(`Listening on http://${config.http.host}:${config.http.port}/mcp`);
    if (!config.http.authToken) {
      logger.warn(
        "MCP_HTTP_AUTH_TOKEN is not set — the HTTP endpoint is unauthenticated. " +
          "Bind to loopback (127.0.0.1) or set a token before exposing it.",
      );
    }
  });

  const shutdown = async () => {
    logger.info("Shutting down HTTP server...");
    for (const transport of transports.values()) {
      await transport.close?.().catch(() => {});
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  logStartupBanner();
  if (config.transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  logger.error(`Fatal startup error: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
