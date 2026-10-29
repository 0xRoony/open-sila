import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { defaultData, describeNode, flowSchema, getNode, listNodes, platformSchema, type FlowNode } from "@open-sila/core";
import { z } from "zod";
import { AuthError, canWrite, identify } from "./auth.js";
import { randomId } from "./crypto.js";
import type { Services } from "./services.js";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const projectId = z.string().describe("Project id from list_projects");

export function createMcpServer(services: Services, version: string, writable: boolean): McpServer {
  const server = new McpServer({ name: "open-sila", version });

  server.registerTool(
    "list_node_types",
    {
      description: "Lists the node types a flow can use, with their ports and fields.",
      inputSchema: { platform: platformSchema.optional() },
    },
    async ({ platform }) => json(listNodes(platform).map(describeNode)),
  );

  server.registerTool(
    "list_projects",
    { description: "Lists bot projects with their platform and bot state." },
    async () => json(services.listProjects()),
  );

  server.registerTool(
    "get_project",
    { description: "Returns a project including its full flow graph.", inputSchema: { projectId } },
    async ({ projectId }) => json(services.project(projectId)),
  );

  server.registerTool(
    "validate_project",
    { description: "Checks the flow and returns errors and warnings.", inputSchema: { projectId } },
    async ({ projectId }) => json(services.validate(projectId)),
  );

  server.registerTool(
    "get_generated_code",
    { description: "Compiles the project and returns the generated bot source files.", inputSchema: { projectId } },
    async ({ projectId }) => json(services.compile(projectId, "production")),
  );

  server.registerTool(
    "export_project",
    { description: "Returns the project as an Open Sila project document that import_project accepts.", inputSchema: { projectId } },
    async ({ projectId }) => json(services.exportDocument(projectId).document),
  );

  server.registerTool(
    "bot_status",
    { description: "Returns the bot state and recent log lines.", inputSchema: { projectId } },
    async ({ projectId }) => {
      const status = services.botStatus(projectId);
      return json({ ...status, logs: status.logs.slice(-50) });
    },
  );

  if (!writable) return server;

  server.registerTool(
    "create_project",
    {
      description: "Creates an empty bot project.",
      inputSchema: { name: z.string(), platform: platformSchema, description: z.string().optional() },
    },
    async (input) => json(services.createProject(input)),
  );

  server.registerTool(
    "import_project",
    {
      description: "Creates a new project from an Open Sila project document, such as one from export_project.",
      inputSchema: { document: z.record(z.string(), z.unknown()), name: z.string().optional() },
    },
    async ({ document, name }) => {
      const { project, diagnostics } = services.importDocument(document, name);
      return json({ projectId: project.id, diagnostics });
    },
  );

  server.registerTool(
    "set_flow",
    {
      description: "Replaces the whole flow graph of a project. Returns validation diagnostics.",
      inputSchema: { projectId, flow: flowSchema },
    },
    async ({ projectId, flow }) => json(services.setFlow(projectId, flow).diagnostics),
  );

  server.registerTool(
    "add_node",
    {
      description: "Adds a node to a project flow and returns its id. Field values default to the node type defaults.",
      inputSchema: {
        projectId,
        type: z.string().describe("Node type from list_node_types"),
        data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      },
    },
    async ({ projectId, type, data, x, y }) => {
      const definition = getNode(type);
      if (!definition) throw new Error(`Unknown node type ${type}. Call list_node_types first.`);
      const project = services.project(projectId);
      const node: FlowNode = {
        id: `n${randomId(8)}`,
        type,
        position: { x: x ?? project.flow.nodes.length * 260, y: y ?? 0 },
        data: { ...defaultData(definition), ...data },
      };
      services.setFlow(projectId, { ...project.flow, nodes: [...project.flow.nodes, node] });
      return json({ nodeId: node.id });
    },
  );

  server.registerTool(
    "connect_nodes",
    {
      description: "Connects an output port to an input port. Use the exec ports (next -> exec) to set the run order.",
      inputSchema: {
        projectId,
        source: z.string(),
        sourcePort: z.string(),
        target: z.string(),
        targetPort: z.string(),
      },
    },
    async ({ projectId, source, sourcePort, target, targetPort }) => {
      const project = services.project(projectId);
      const edge = { id: `e${randomId(8)}`, source, sourceHandle: sourcePort, target, targetHandle: targetPort };
      const { diagnostics } = services.setFlow(projectId, { ...project.flow, edges: [...project.flow.edges, edge] });
      return json({ edgeId: edge.id, diagnostics });
    },
  );

  server.registerTool(
    "remove_node",
    { description: "Removes a node and its connections.", inputSchema: { projectId, nodeId: z.string() } },
    async ({ projectId, nodeId }) => {
      const { flow } = services.project(projectId);
      const next = {
        nodes: flow.nodes.filter((node) => node.id !== nodeId),
        edges: flow.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      };
      return json(services.setFlow(projectId, next).diagnostics);
    },
  );

  server.registerTool(
    "set_secret",
    {
      description: "Stores a secret such as DISCORD_TOKEN or TELEGRAM_TOKEN in the encrypted database.",
      inputSchema: { projectId, name: z.string(), value: z.string() },
    },
    async ({ projectId, name, value }) => {
      services.setSecret(projectId, name, value);
      return json({ saved: name });
    },
  );

  server.registerTool(
    "start_bot",
    { description: "Builds the project and starts the bot locally.", inputSchema: { projectId } },
    async ({ projectId }) => json(await services.startBot(projectId)),
  );

  server.registerTool(
    "list_versions",
    { description: "Lists saved versions of a project's flow, newest first.", inputSchema: { projectId } },
    async ({ projectId }) => json(services.listVersions(projectId)),
  );

  server.registerTool(
    "restore_version",
    {
      description: "Replaces the project's flow with a saved version. The current flow is saved as a version first.",
      inputSchema: { projectId, versionId: z.string() },
    },
    async ({ projectId, versionId }) => json(services.restoreVersion(projectId, versionId).diagnostics),
  );

  server.registerTool(
    "run_manual",
    {
      description: "Runs a Manual run trigger in the running bot with a JSON payload, for testing a flow.",
      inputSchema: { projectId, nodeId: z.string(), payload: z.unknown().optional() },
    },
    async ({ projectId, nodeId, payload }) => json(services.runManual(projectId, nodeId, payload ?? null)),
  );

  server.registerTool(
    "stop_bot",
    { description: "Stops the running bot.", inputSchema: { projectId } },
    async ({ projectId }) => json(await services.stopBot(projectId)),
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance, services: Services, version: string): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    const principal = identify(request, services.store);
    if (principal?.kind !== "key") throw new AuthError(401, "Send an API key as a Bearer token.");
    const server = createMcpServer(services, version, canWrite(principal));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  const notAllowed = async (_request: unknown, reply: { code(status: number): unknown }) => {
    reply.code(405);
    return { error: { code: "method_not_allowed", message: "This MCP endpoint is stateless. Use POST." } };
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
