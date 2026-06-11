import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ObfuscationError } from "./errors.js";

export async function resolveSource({ code, filePath }) {
  const hasCode = typeof code === "string" && code.length > 0;
  const hasPath = typeof filePath === "string" && filePath.length > 0;

  if (hasCode && hasPath) {
    throw new ObfuscationError("Provide either `code` or `filePath`, not both.");
  }
  if (!hasCode && !hasPath) {
    throw new ObfuscationError(
      "No input provided. Pass `code` (inline Lua) or `filePath` (path to a .lua file).",
    );
  }

  if (hasCode) {
    return { source: code, inferredName: "script.lua" };
  }

  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new ObfuscationError(`Could not read file at "${filePath}": ${err.message}`, {
      cause: err,
    });
  }
  return { source: raw, inferredName: path.basename(filePath) || "script.lua" };
}

export function normalizeFileName(name, fallback = "script.lua") {
  let n = (name || fallback).trim();
  if (!n) n = fallback;
  n = path.basename(n);
  if (!/\.lua$/i.test(n)) n += ".lua";
  if (n.length > 255) {
    const ext = ".lua";
    n = n.slice(0, 255 - ext.length) + ext;
  }
  return n;
}

export async function writeOutput(outputPath, text) {
  const abs = path.resolve(outputPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, "utf8");
  return abs;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
