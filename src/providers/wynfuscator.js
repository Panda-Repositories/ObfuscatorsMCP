import { httpRequest } from "../http.js";
import { describeHttpError, ObfuscationError } from "../errors.js";
import { logger } from "../logger.js";
import { sleep } from "../util.js";

export const WYNF_TARGET_PLATFORMS = [
  "AUTO",
  "ROBLOX",
  "ROBLOX_COMPAT",
  "LUAU",
  "LUA51",
  "LUA52",
  "LUA53",
  "LUA54",
  "LUAJIT",
];
export const WYNF_SECURITY_TIERS = ["STANDARD", "ENHANCED", "MAX"];
export const WYNF_NODES = ["STABLE", "BETA"];

const MAX_POLLS = 120;

export class WynfuscatorClient {
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
        "wYnFuscator is not configured. Set WYNFUSCATOR_API_KEY in your environment/.env " +
          "(requires a Pro or Enterprise plan; key format: wynf_...).",
        { provider: "wYnFuscator" },
      );
    }
  }

  #authHeaders(extra = {}) {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }

  async submit(source, fileName, options = {}) {
    this.#assertConfigured();

    const form = new FormData();
    form.append("file", new Blob([source], { type: "text/plain" }), fileName);

    if (options.targetPlatform) form.append("targetPlatform", options.targetPlatform);
    if (options.securityTier) form.append("securityTier", options.securityTier);
    if (options.node) form.append("node", options.node);

    for (const flag of [
      "enhancedCompression",
      "autoApplyMacros",
      "optimizeSource",
      "enableLineInfo",
      "performanceMode",
    ]) {
      if (options[flag] === true) form.append(flag, "true");
    }

    const response = await httpRequest(`${this.baseUrl}/obfuscate`, {
      method: "POST",
      headers: this.#authHeaders(),
      body: form,
      timeoutMs: this.httpTimeoutMs,
      provider: "wYnFuscator",
      retries: 0,
    });

    if (!response.ok) throw await describeHttpError(response, "wYnFuscator");
    return response.json();
  }

  async getJob(jobId) {
    this.#assertConfigured();
    const response = await httpRequest(`${this.baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
      headers: this.#authHeaders(),
      timeoutMs: this.httpTimeoutMs,
      provider: "wYnFuscator",
    });
    if (!response.ok) throw await describeHttpError(response, "wYnFuscator");
    return response.json();
  }

  async download(jobId) {
    this.#assertConfigured();
    const response = await httpRequest(
      `${this.baseUrl}/jobs/${encodeURIComponent(jobId)}/download`,
      {
        method: "GET",
        headers: this.#authHeaders(),
        timeoutMs: this.httpTimeoutMs,
        provider: "wYnFuscator",
      },
    );
    if (!response.ok) throw await describeHttpError(response, "wYnFuscator");
    return response.text();
  }

  async deleteJob(jobId) {
    this.#assertConfigured();
    const response = await httpRequest(`${this.baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
      headers: this.#authHeaders(),
      timeoutMs: this.httpTimeoutMs,
      provider: "wYnFuscator",
    });
    if (!response.ok) throw await describeHttpError(response, "wYnFuscator");
    return response.json();
  }

  async obfuscate(source, fileName, options = {}) {
    const submission = await this.submit(source, fileName, options);
    const jobId = submission?.id;
    if (!jobId) {
      throw new ObfuscationError("wYnFuscator did not return a job id.", {
        provider: "wYnFuscator",
      });
    }
    logger.info(`wYnFuscator: submitted job ${jobId} (${fileName})`);

    const job = await this.#pollUntilDone(jobId);
    const code = await this.download(jobId);
    return { code, job };
  }

  async #pollUntilDone(jobId) {
    const deadline = Date.now() + this.obfuscationTimeoutMs;
    let interval = 2000;
    const maxInterval = 30_000;

    for (let polls = 0; polls < MAX_POLLS; polls += 1) {
      const job = await this.getJob(jobId);
      const status = job?.status;

      if (status === "completed") return job;
      if (status === "failed") {
        const msg = job?.error?.message || job?.error || "unknown error";
        throw new ObfuscationError(`wYnFuscator job failed: ${msg}`, {
          provider: "wYnFuscator",
          code: job?.error?.code,
        });
      }

      if (Date.now() + interval > deadline) {
        throw new ObfuscationError(
          `wYnFuscator job ${jobId} did not finish within ${Math.round(
            this.obfuscationTimeoutMs / 1000,
          )}s (last status: ${status || "unknown"}).`,
          { provider: "wYnFuscator" },
        );
      }

      await sleep(interval);
      interval = Math.min(Math.round(interval * 1.5), maxInterval);
    }

    throw new ObfuscationError(
      `wYnFuscator job ${jobId} exceeded the maximum of ${MAX_POLLS} status checks.`,
      { provider: "wYnFuscator" },
    );
  }
}
