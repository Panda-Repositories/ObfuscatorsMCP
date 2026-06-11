import { httpRequest, parseRetryAfter } from "../http.js";
import { describeHttpError, ObfuscationError } from "../errors.js";
import { logger } from "../logger.js";
import { sleep } from "../util.js";

const STATUS_REQUEST_TIMEOUT_MS = 65_000;

export class LuraphClient {
  constructor({ apiKey, baseUrl, httpTimeoutMs, obfuscationTimeoutMs }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.httpTimeoutMs = httpTimeoutMs;
    this.obfuscationTimeoutMs = obfuscationTimeoutMs;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  #assertConfigured() {
    if (!this.configured) {
      throw new ObfuscationError(
        "Luraph is not configured. Set LURAPH_API_KEY in your environment/.env " +
          "(Dashboard -> Account -> API Details -> Generate API Token).",
        { provider: "Luraph" },
      );
    }
  }

  #authHeaders(extra = {}) {
    return { "Luraph-API-Key": this.apiKey, ...extra };
  }

  async getNodes() {
    this.#assertConfigured();
    const response = await httpRequest(`${this.baseUrl}/obfuscate/nodes`, {
      method: "GET",
      headers: this.#authHeaders(),
      timeoutMs: this.httpTimeoutMs,
      provider: "Luraph",
    });
    if (!response.ok) throw await describeHttpError(response, "Luraph");
    return response.json();
  }

  async submit({ fileName, node, script, options, useTokens, enforceSettings }) {
    this.#assertConfigured();
    const body = {
      fileName,
      node,
      script: Buffer.from(script, "utf8").toString("base64"),
      options: options ?? {},
    };
    if (typeof useTokens === "boolean") body.useTokens = useTokens;
    if (typeof enforceSettings === "boolean") body.enforceSettings = enforceSettings;

    const response = await httpRequest(`${this.baseUrl}/obfuscate/new`, {
      method: "POST",
      headers: this.#authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      timeoutMs: this.httpTimeoutMs,
      provider: "Luraph",
      retries: 0,
    });
    if (!response.ok) throw await describeHttpError(response, "Luraph");
    const json = await response.json();
    if (Array.isArray(json?.warnings) && json.warnings.length) {
      logger.warn(`Luraph warnings: ${json.warnings.join(" | ")}`);
    }
    return json;
  }

  async download(jobId) {
    this.#assertConfigured();
    const response = await httpRequest(
      `${this.baseUrl}/obfuscate/download/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: this.#authHeaders(),
        timeoutMs: this.httpTimeoutMs,
        provider: "Luraph",
      },
    );
    if (!response.ok) throw await describeHttpError(response, "Luraph");
    return response.text();
  }

  async waitForCompletion(jobId) {
    this.#assertConfigured();
    const deadline = Date.now() + this.obfuscationTimeoutMs;
    let warnings = [];
    let backoff = 2000;
    const maxBackoff = 30_000;

    while (Date.now() < deadline) {
      const response = await httpRequest(
        `${this.baseUrl}/obfuscate/status/${encodeURIComponent(jobId)}`,
        {
          method: "GET",
          headers: this.#authHeaders(),
          timeoutMs: STATUS_REQUEST_TIMEOUT_MS,
          provider: "Luraph",
          retries: 0,
        },
      );

      if (response.ok) {
        const text = (await response.text()).trim();
        if (!text) return warnings;
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          return warnings;
        }
        if (Array.isArray(json?.warnings)) warnings = json.warnings;
        if (json?.error) {
          throw new ObfuscationError(`Luraph obfuscation failed: ${json.error}`, {
            provider: "Luraph",
          });
        }
        return warnings;
      }

      if (response.status === 403 || response.status === 404) {
        throw await describeHttpError(response, "Luraph");
      }
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await response.body?.cancel?.().catch(() => {});
      const wait = Math.min(Math.max(retryAfter ?? 0, backoff), maxBackoff);
      if (Date.now() + wait >= deadline) break;
      await sleep(wait);
      backoff = Math.min(Math.round(backoff * 1.5), maxBackoff);
    }

    throw new ObfuscationError(
      `Luraph job ${jobId} did not finish within ${Math.round(
        this.obfuscationTimeoutMs / 1000,
      )}s.`,
      { provider: "Luraph" },
    );
  }

  async obfuscate(source, fileName, userInput = {}) {
    const nodesResponse = await this.getNodes();
    const nodeId = userInput.node || nodesResponse?.recommendedId;
    if (!nodeId) {
      throw new ObfuscationError("Luraph returned no available obfuscation nodes.", {
        provider: "Luraph",
      });
    }
    const nodeDef = nodesResponse?.nodes?.[nodeId];
    if (!nodeDef) {
      const available = Object.keys(nodesResponse?.nodes || {}).join(", ") || "(none)";
      throw new ObfuscationError(
        `Luraph node "${nodeId}" is not available. Available nodes: ${available}.`,
        { provider: "Luraph" },
      );
    }

    const { options, autoDefaulted } = buildOptions(nodeDef, userInput.options || {});

    const submission = await this.submit({
      fileName,
      node: nodeId,
      script: source,
      options,
      useTokens: userInput.useTokens,
      enforceSettings: userInput.enforceSettings,
    });

    const jobId = submission?.jobId;
    if (!jobId) {
      throw new ObfuscationError("Luraph did not return a job id.", { provider: "Luraph" });
    }
    logger.info(`Luraph: submitted job ${jobId} on node ${nodeId} (${fileName})`);

    const submitWarnings = Array.isArray(submission?.warnings) ? submission.warnings : [];
    const statusWarnings = await this.waitForCompletion(jobId);
    const code = await this.download(jobId);

    const warnings = [...new Set([...submitWarnings, ...statusWarnings])];
    return { code, jobId, node: nodeId, options, warnings, autoDefaulted };
  }
}

function buildOptions(nodeDef, userOptions) {
  const merged = {};
  const autoDefaulted = [];
  const optionDefs = nodeDef.options || {};

  for (const [optId, def] of Object.entries(optionDefs)) {
    if (Object.prototype.hasOwnProperty.call(userOptions, optId)) {
      merged[optId] = userOptions[optId];
    } else {
      merged[optId] = defaultForOption(def);
      if (def.required) autoDefaulted.push(optId);
    }
  }

  for (const [optId, value] of Object.entries(userOptions)) {
    if (!Object.prototype.hasOwnProperty.call(merged, optId)) merged[optId] = value;
  }

  return { options: merged, autoDefaulted };
}

function defaultForOption(def) {
  switch (def.type) {
    case "CHECKBOX":
      return false;
    case "DROPDOWN":
      return Array.isArray(def.choices) && def.choices.length ? def.choices[0] : "";
    case "TEXT":
    default:
      return "";
  }
}
