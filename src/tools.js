import { z } from "zod";
import {
  WYNF_TARGET_PLATFORMS,
  WYNF_SECURITY_TIERS,
  WYNF_NODES,
} from "./providers/wynfuscator.js";
import { resolveSource, normalizeFileName, writeOutput, formatBytes } from "./util.js";
import { getStubs } from "./stubs.js";
import { logger } from "./logger.js";

const MB = 1024 * 1024;
const WYNF_MAX_BYTES = 10 * MB;
const LURAPH_MAX_BYTES = 50 * MB;

function ok(text) {
  return { content: [{ type: "text", text }] };
}

function fail(err) {
  logger.error(`Tool error: ${err?.stack || err?.message || String(err)}`);
  const message = err?.message || String(err);
  return { content: [{ type: "text", text: `❌ ${message}` }], isError: true };
}

const sharedInputShape = {
  code: z
    .string()
    .optional()
    .describe("Inline Lua/Luau source to obfuscate. Provide this OR `filePath`, not both."),
  filePath: z
    .string()
    .optional()
    .describe("Absolute or relative path to a .lua file to read and obfuscate."),
  fileName: z
    .string()
    .optional()
    .describe('Name to associate with the script (e.g. "main.lua"). Defaults to the input file name or "script.lua".'),
  outputPath: z
    .string()
    .optional()
    .describe("If set, the obfuscated result is written to this path instead of being returned inline (recommended for large outputs)."),
};

export function registerTools(server, { wynfuscator, luraph }) {
  server.registerTool(
    "wynfuscator_obfuscate",
    {
      title: "Obfuscate Lua with wYnFuscator",
      description:
        "Obfuscate a Lua/Luau script using the wYnFuscator API (submit -> poll -> download). " +
        "Best for Roblox/Luau scripts. Returns the obfuscated code (or writes it to `outputPath`). " +
        "Requires WYNFUSCATOR_API_KEY (Pro/Enterprise plan).",
      inputSchema: {
        ...sharedInputShape,
        targetPlatform: z
          .enum(WYNF_TARGET_PLATFORMS)
          .optional()
          .describe("Target Lua runtime. Default: ROBLOX."),
        securityTier: z
          .enum(WYNF_SECURITY_TIERS)
          .optional()
          .describe("Protection level. Default: STANDARD. MAX trades performance for security."),
        node: z
          .enum(WYNF_NODES)
          .optional()
          .describe("Obfuscator release: STABLE (default) or BETA."),
        enhancedCompression: z
          .boolean()
          .optional()
          .describe("Enable Enhanced VM Compression to reduce output size (Pro/Enterprise; needs load/loadstring on target)."),
        autoApplyMacros: z
          .boolean()
          .optional()
          .describe("Auto-inject WYNF_JIT_MAX wrappers on hot functions."),
        optimizeSource: z
          .boolean()
          .optional()
          .describe("Apply source-level optimizations before obfuscation."),
        enableLineInfo: z
          .boolean()
          .optional()
          .describe("Remap runtime errors to original source lines (slight overhead)."),
        performanceMode: z
          .boolean()
          .optional()
          .describe("Prioritize runtime speed over some protections (BETA node only)."),
        deleteAfterDownload: z
          .boolean()
          .optional()
          .describe("Delete the job from wYnFuscator storage after downloading the result."),
      },
    },
    async (args) => {
      try {
        const { source, inferredName } = await resolveSource(args);
        const byteLen = Buffer.byteLength(source, "utf8");
        if (byteLen > WYNF_MAX_BYTES) {
          throw new Error(
            `Script is ${formatBytes(byteLen)}, which exceeds the wYnFuscator limit (max 10MB).`,
          );
        }
        const fileName = normalizeFileName(args.fileName || inferredName);

        const { code, job } = await wynfuscator.obfuscate(source, fileName, {
          targetPlatform: args.targetPlatform,
          securityTier: args.securityTier,
          node: args.node,
          enhancedCompression: args.enhancedCompression,
          autoApplyMacros: args.autoApplyMacros,
          optimizeSource: args.optimizeSource,
          enableLineInfo: args.enableLineInfo,
          performanceMode: args.performanceMode,
        });

        if (args.deleteAfterDownload) {
          try {
            await wynfuscator.deleteJob(job.id);
          } catch (delErr) {
            logger.warn(`wYnFuscator: failed to delete job ${job.id}: ${delErr.message}`);
          }
        }

        const summaryLines = [
          "✅ wYnFuscator obfuscation complete.",
          `• Job: ${job.id}`,
          `• Security tier: ${job.securityTier || args.securityTier || "STANDARD"}`,
          `• Input size: ${formatBytes(job.inputSize ?? byteLen)}`,
          `• Output size: ${formatBytes(job.outputSize ?? Buffer.byteLength(code, "utf8"))}`,
        ];
        if (Number.isFinite(job.processingTimeMs)) {
          summaryLines.push(`• Processing time: ${job.processingTimeMs} ms`);
        }

        return await finalizeOutput({ args, code, summaryLines });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wynfuscator_job_status",
    {
      title: "Check a wYnFuscator job",
      description:
        "Get the status and metadata of an existing wYnFuscator obfuscation job by id. Requires WYNFUSCATOR_API_KEY.",
      inputSchema: {
        jobId: z.string().describe("The wYnFuscator job id."),
      },
    },
    async (args) => {
      try {
        const job = await wynfuscator.getJob(args.jobId);
        return ok(JSON.stringify(job, null, 2));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wynfuscator_download",
    {
      title: "Download a wYnFuscator result",
      description:
        "Download the obfuscated output of a completed wYnFuscator job by id (results retained 14 days). " +
        "Returns the code inline or writes it to `outputPath`. Requires WYNFUSCATOR_API_KEY.",
      inputSchema: {
        jobId: z.string().describe("The wYnFuscator job id."),
        outputPath: z
          .string()
          .optional()
          .describe("If set, write the result here instead of returning it inline."),
      },
    },
    async (args) => {
      try {
        const code = await wynfuscator.download(args.jobId);
        const summaryLines = [
          "✅ Downloaded wYnFuscator result.",
          `• Job: ${args.jobId}`,
          `• Output size: ${formatBytes(Buffer.byteLength(code, "utf8"))}`,
        ];
        return await finalizeOutput({ args, code, summaryLines });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wynfuscator_delete_job",
    {
      title: "Delete a wYnFuscator job",
      description:
        "Permanently delete a wYnFuscator job and its output to free storage quota. Requires WYNFUSCATOR_API_KEY.",
      inputSchema: {
        jobId: z.string().describe("The wYnFuscator job id."),
      },
    },
    async (args) => {
      try {
        const result = await wynfuscator.deleteJob(args.jobId);
        return ok(
          `✅ Deleted job ${result.jobId || args.jobId}. Freed ${formatBytes(result.storageFreed ?? 0)}.`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "luraph_obfuscate",
    {
      title: "Obfuscate Lua with Luraph",
      description:
        "Obfuscate a Lua/Luau script using the Luraph API (auto-selects a node, submits, waits, downloads). " +
        "Supports Roblox, FiveM, and standard Lua 5.1-5.4 / LuaJIT. Use `luraph_list_nodes` first to discover " +
        "node-specific option IDs and choices. Requires LURAPH_API_KEY. Results expire after 24h.",
      inputSchema: {
        ...sharedInputShape,
        node: z
          .string()
          .optional()
          .describe("Node ID to obfuscate on (from luraph_list_nodes). Defaults to the server-recommended node."),
        options: z
          .record(z.string(), z.union([z.string(), z.boolean()]))
          .optional()
          .describe(
            'Map of Luraph option IDs to values, e.g. {"TARGET_VERSION":"Luau","INTENSE_VM":true}. ' +
              "Unspecified options are auto-filled with sensible defaults. Use luraph_list_nodes to see valid IDs/choices.",
          ),
        useTokens: z
          .boolean()
          .optional()
          .describe("Force token usage regardless of your active subscription."),
        enforceSettings: z
          .boolean()
          .optional()
          .describe("Require all node options to be present (API default: true). The client auto-fills missing ones either way."),
      },
    },
    async (args) => {
      try {
        const { source, inferredName } = await resolveSource(args);
        const byteLen = Buffer.byteLength(source, "utf8");
        const encodedLen = Math.ceil(byteLen / 3) * 4;
        if (encodedLen > LURAPH_MAX_BYTES) {
          throw new Error(
            `Script is ${formatBytes(byteLen)} (~${formatBytes(encodedLen)} base64-encoded), ` +
              `which exceeds the Luraph limit (max 50MB encoded).`,
          );
        }
        const fileName = normalizeFileName(args.fileName || inferredName);

        const result = await luraph.obfuscate(source, fileName, {
          node: args.node,
          options: args.options,
          useTokens: args.useTokens,
          enforceSettings: args.enforceSettings,
        });

        const summaryLines = [
          "✅ Luraph obfuscation complete.",
          `• Job: ${result.jobId}`,
          `• Node: ${result.node}`,
          `• Input size: ${formatBytes(byteLen)}`,
          `• Output size: ${formatBytes(Buffer.byteLength(result.code, "utf8"))}`,
          "• Note: Luraph download links expire 24h after obfuscation.",
        ];
        if (result.autoDefaulted?.length) {
          summaryLines.push(
            `⚠ Required options auto-defaulted (set them explicitly for best results): ${result.autoDefaulted.join(", ")}`,
          );
        }
        if (result.warnings?.length) {
          summaryLines.push(`⚠ Luraph warnings: ${result.warnings.join(" | ")}`);
        }

        return await finalizeOutput({ args, code: result.code, summaryLines });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "luraph_list_nodes",
    {
      title: "List Luraph nodes & options",
      description:
        "List available Luraph obfuscation nodes, the recommended node, and each node's configurable options " +
        "(IDs, types, choices, required flags). Use the returned option IDs/choices with luraph_obfuscate. Requires LURAPH_API_KEY.",
      inputSchema: {
        raw: z
          .boolean()
          .optional()
          .describe("If true, also include the full raw JSON response from the API."),
      },
    },
    async (args) => {
      try {
        const data = await luraph.getNodes();
        const lines = [`Recommended node: ${data.recommendedId || "(none)"}`, ""];

        for (const [nodeId, node] of Object.entries(data.nodes || {})) {
          lines.push(`■ ${nodeId}  (Luraph v${node.version ?? "?"}, CPU ${node.cpuUsage ?? "?"}%)`);
          const opts = Object.entries(node.options || {});
          if (!opts.length) lines.push("    (no configurable options)");
          for (const [optId, def] of opts) {
            const bits = [def.type];
            if (def.required) bits.push("required");
            if (def.tier) bits.push(def.tier);
            if (Array.isArray(def.choices) && def.choices.length) {
              bits.push(`choices: [${def.choices.join(", ")}]`);
            }
            lines.push(`    - ${optId} (${bits.join(", ")})${def.name ? ` — ${def.name}` : ""}`);
          }
          lines.push("");
        }

        if (args.raw) {
          lines.push("Raw response:", "```json", JSON.stringify(data, null, 2), "```");
        }

        return ok(lines.join("\n"));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "lua_dev_stubs",
    {
      title: "Get macro dev stubs",
      description:
        "Return passthrough development stubs for wYnFuscator (WYNF_*) and/or Luraph (LPH_*) macros so a script " +
        "using those macros runs unobfuscated without errors. Stubs are stripped/replaced during real obfuscation. " +
        "No API key required.",
      inputSchema: {
        provider: z
          .enum(["wynfuscator", "luraph", "both"])
          .optional()
          .describe("Which provider's macro stubs to return. Default: both."),
      },
    },
    async (args) => {
      try {
        const provider = args.provider || "both";
        const stubs = getStubs(provider);
        return ok(
          `Paste this at the top of your script (it is removed/replaced when obfuscated):\n\n\`\`\`lua\n${stubs}\n\`\`\``,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}

async function finalizeOutput({ args, code, summaryLines }) {
  if (args.outputPath) {
    const abs = await writeOutput(args.outputPath, code);
    summaryLines.push(`• Saved obfuscated output to: ${abs}`);
    return ok(summaryLines.join("\n"));
  }
  return {
    content: [
      { type: "text", text: summaryLines.join("\n") },
      { type: "text", text: code },
    ],
  };
}
