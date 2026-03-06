import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Request, Response } from "express";
import { z } from "zod";
import { getRegisteredTools } from "./tools/registry";

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "agent-toolbelt",
    version: "1.0.0",
  });

  for (const tool of getRegisteredTools()) {
    // MCP tool names use underscores; slugs use hyphens
    const mcpName = tool.name.replace(/-/g, "_");

    // Extract the Zod shape from ZodObject for MCP registration
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shape: any =
      tool.inputSchema instanceof z.ZodObject
        ? (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape
        : {};

    server.registerTool(
      mcpName,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: shape,
      },
      async (input: any) => {
        try {
          const result = await tool.handler(input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `Error: ${err.message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

// Stateless handler: fresh server + transport per request
export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
