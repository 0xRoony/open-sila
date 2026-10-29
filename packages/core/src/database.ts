import { z } from "zod";
import type { PortType } from "./types.js";

export const DATABASE_PROVIDERS = ["sqlite", "postgresql", "mysql", "mongodb", "sqlserver", "cockroachdb"] as const;
export const FIELD_TYPES = ["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt"] as const;

export const modelFieldSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, "Field names start with a letter and use letters, digits and _"),
  type: z.enum(FIELD_TYPES),
  optional: z.boolean().default(false),
  unique: z.boolean().default(false),
  list: z.boolean().default(false),
  default: z.string().max(200).optional(),
});

export const modelSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Za-z0-9_]{0,63}$/, "Model names start with a capital letter, like Ticket"),
  fields: z.array(modelFieldSchema).max(100),
});

export const databaseSchema = z.object({
  provider: z.enum(DATABASE_PROVIDERS),
  models: z.array(modelSchema).max(100),
});

export type ModelField = z.infer<typeof modelFieldSchema>;
export type Model = z.infer<typeof modelSchema>;
export type Database = z.infer<typeof databaseSchema>;
export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<DatabaseProvider, string> = {
  sqlite: "SQLite (a file, no server needed)",
  postgresql: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  mongodb: "MongoDB",
  sqlserver: "SQL Server",
  cockroachdb: "CockroachDB",
};

export const EXAMPLE_URLS: Record<DatabaseProvider, string> = {
  sqlite: "file:./data/bot.db",
  postgresql: "postgresql://user:password@localhost:5432/bot",
  mysql: "mysql://user:password@localhost:3306/bot",
  mongodb: "mongodb+srv://user:password@cluster.example.net/bot",
  sqlserver: "sqlserver://localhost:1433;database=bot;user=sa;password=secret;trustServerCertificate=true",
  cockroachdb: "postgresql://user:password@localhost:26257/bot",
};

let current: Database | undefined;

export function currentDatabase(): Database | undefined {
  return current;
}

export function setDatabase(database: Database | undefined): void {
  current = database;
}

export function withDatabase<T>(database: Database | undefined, run: () => T): T {
  const previous = current;
  current = database;
  try {
    return run();
  } finally {
    current = previous;
  }
}

export function findModel(name: unknown): Model | undefined {
  return current?.models.find((model) => model.name === name);
}

export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function fieldPortType(field: ModelField): PortType {
  if (field.list) return "list";
  if (field.type === "String") return "string";
  if (field.type === "Boolean") return "boolean";
  if (field.type === "Int" || field.type === "Float" || field.type === "BigInt") return "number";
  return "any";
}

function defaultValue(field: ModelField): string {
  const value = field.default?.trim();
  if (!value) return "";
  if (field.type === "DateTime") return value === "now" ? " @default(now())" : ` @default("${value}")`;
  if (field.type === "String") return ` @default(${JSON.stringify(value)})`;
  if (field.type === "Boolean") return ` @default(${value === "true"})`;
  if (field.type === "Json") return ` @default(${JSON.stringify(value)})`;
  return Number.isFinite(Number(value)) ? ` @default(${Number(value)})` : "";
}

export function databaseProblems(database: Database): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const model of database.models) {
    if (names.has(model.name)) problems.push(`The model ${model.name} is defined twice.`);
    names.add(model.name);
    const fields = new Set<string>();
    for (const field of model.fields) {
      if (["id", "createdAt", "updatedAt"].includes(field.name)) problems.push(`${model.name}.${field.name} is created automatically; remove it.`);
      if (fields.has(field.name)) problems.push(`${model.name}.${field.name} is defined twice.`);
      fields.add(field.name);
      if (field.list && (database.provider === "sqlite" || database.provider === "mysql" || database.provider === "sqlserver")) {
        problems.push(`${model.name}.${field.name}: ${PROVIDER_LABELS[database.provider]} cannot store lists. Use Json instead.`);
      }
      if (field.list && field.optional) problems.push(`${model.name}.${field.name}: a list cannot also be optional.`);
    }
  }
  return problems;
}

export function prismaSchema(database: Database): string {
  const mongo = database.provider === "mongodb";
  const models = database.models.map((model) => {
    const lines = [
      mongo ? '  id        String   @id @default(auto()) @map("_id") @db.ObjectId' : "  id        Int      @id @default(autoincrement())",
      ...model.fields.map((field) => {
        const type = `${field.type}${field.list ? "[]" : field.optional ? "?" : ""}`;
        return `  ${field.name.padEnd(9)} ${type.padEnd(8)}${field.unique ? " @unique" : ""}${defaultValue(field)}`;
      }),
      "  createdAt DateTime @default(now())",
      "  updatedAt DateTime @updatedAt",
    ];
    return `model ${model.name} {\n${lines.join("\n")}\n}`;
  });
  return [
    "generator client {",
    '  provider = "prisma-client-js"',
    '  output   = "../generated/prisma"',
    "}",
    "",
    "datasource db {",
    `  provider = "${database.provider}"`,
    '  url      = env("DATABASE_URL")',
    "}",
    "",
    models.join("\n\n"),
    "",
  ].join("\n");
}

export const DATABASE_CLIENT = `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../../generated/prisma/index.js");

export const db = new PrismaClient();
`;
