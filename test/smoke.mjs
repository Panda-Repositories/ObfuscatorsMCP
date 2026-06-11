import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serverEntry = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/index.js",
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, LOG_LEVEL: "error", WYNFUSCATOR_API_KEY: "", LURAPH_API_KEY: "" },
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });

let failures = 0;
const assert = (cond, msg) => {
  if (cond) {
    console.log("PASS:", msg);
  } else {
    failures++;
    console.error("FAIL:", msg);
  }
};

try {
  await client.connect(transport);
  console.log("Connected. Server:", JSON.stringify(client.getServerVersion()));

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log("Tools:", names.join(", "));

  const expected = [
    "lua_dev_stubs",
    "luraph_list_nodes",
    "luraph_obfuscate",
    "wynfuscator_delete_job",
    "wynfuscator_download",
    "wynfuscator_job_status",
    "wynfuscator_obfuscate",
  ];
  assert(names.length === expected.length, `exactly ${expected.length} tools registered`);
  for (const name of expected) assert(names.includes(name), `${name} present`);

  for (const t of tools) {
    assert(t.inputSchema && t.inputSchema.type === "object", `${t.name} has an object inputSchema`);
  }

  const noInput = await client.callTool({ name: "wynfuscator_obfuscate", arguments: {} });
  assert(noInput.isError === true, "wynfuscator_obfuscate with no input -> isError");

  const noKey = await client.callTool({
    name: "wynfuscator_obfuscate",
    arguments: { code: "print('hi')" },
  });
  assert(noKey.isError === true, "wynfuscator_obfuscate with no key -> isError");
  assert(
    /not configured|WYNFUSCATOR_API_KEY/i.test(noKey.content?.[0]?.text || ""),
    "wYnFuscator config error message is clear",
  );

  const luraphNoKey = await client.callTool({ name: "luraph_list_nodes", arguments: {} });
  assert(luraphNoKey.isError === true, "luraph_list_nodes with no key -> isError");

  const both = await client.callTool({
    name: "luraph_obfuscate",
    arguments: { code: "a", filePath: "b.lua" },
  });
  assert(both.isError === true, "luraph_obfuscate with both inputs -> isError");

  const stubsBoth = await client.callTool({ name: "lua_dev_stubs", arguments: {} });
  assert(stubsBoth.isError !== true, "lua_dev_stubs works without a key");
  const stubText = stubsBoth.content?.[0]?.text || "";
  assert(stubText.includes("WYNF_OBFUSCATED"), "stubs include wYnFuscator macros");
  assert(stubText.includes("LPH_OBFUSCATED"), "stubs include Luraph macros");

  const stubsWynf = await client.callTool({
    name: "lua_dev_stubs",
    arguments: { provider: "wynfuscator" },
  });
  const wynfOnly = stubsWynf.content?.[0]?.text || "";
  assert(
    wynfOnly.includes("WYNF_OBFUSCATED") && !wynfOnly.includes("LPH_OBFUSCATED"),
    "provider=wynfuscator returns only WYNF_* stubs",
  );
} catch (err) {
  failures++;
  console.error("FATAL:", err?.stack || err);
} finally {
  await client.close().catch(() => {});
}

console.log(failures === 0 ? "\nALL SMOKE TESTS PASSED" : `\n${failures} SMOKE TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
