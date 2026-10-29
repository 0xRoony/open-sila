import { z } from "zod";
import { databaseSchema } from "./database.js";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const flowNodeSchema = z.object({
  id,
  type: z.string().min(1).max(100),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.union([z.string().max(20_000), z.number(), z.boolean()])),
});

export const flowEdgeSchema = z.object({
  id,
  source: id,
  sourceHandle: z.string().min(1).max(64),
  target: id,
  targetHandle: z.string().min(1).max(64),
});

export const flowSchema = z.object({
  nodes: z.array(flowNodeSchema).max(2000),
  edges: z.array(flowEdgeSchema).max(5000),
  database: databaseSchema.optional(),
});

export const platformSchema = z.enum(["discord", "telegram"]);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  platform: platformSchema,
  flow: flowSchema.optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  flow: flowSchema.optional(),
});

export const PROJECT_FORMAT = "open-sila";

export const projectDocumentSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  project: z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(""),
    platform: platformSchema,
    flow: flowSchema,
  }),
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;

export function toProjectDocument(project: { name: string; description: string; platform: "discord" | "telegram"; flow: z.infer<typeof flowSchema> }): ProjectDocument {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { name: project.name, description: project.description, platform: project.platform, flow: project.flow },
  };
}

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
