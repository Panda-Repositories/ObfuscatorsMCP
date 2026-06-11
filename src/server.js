import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config, SERVER_INFO } from "./config.js";
import { WynfuscatorClient } from "./providers/wynfuscator.js";
import { LuraphClient } from "./providers/luraph.js";
import { registerTools } from "./tools.js";

export function createClients() {
  const common = {
    httpTimeoutMs: config.timeouts.httpMs,
    obfuscationTimeoutMs: config.timeouts.obfuscationMs,
  };
  return {
    wynfuscator: new WynfuscatorClient({ ...config.wynfuscator, ...common }),
    luraph: new LuraphClient({ ...config.luraph, ...common }),
  };
}

export function createServer(clients = createClients()) {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Tools to obfuscate Lua/Luau scripts via the wYnFuscator and Luraph APIs. " +
      "Use `luraph_list_nodes` to discover Luraph option IDs before calling `luraph_obfuscate`. " +
      "Use `lua_dev_stubs` to get macro stubs so a script runs unobfuscated. " +
      "For large outputs, pass `outputPath` to write the result to a file instead of returning it inline.",
  });

  registerTools(server, clients);
  return server;
}
