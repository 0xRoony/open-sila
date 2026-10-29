import { currentDatabase, delegateName, fieldPortType, findModel, type Model } from "../database.js";
import type { EmitContext, FieldDef, FieldValue, PortDef } from "../types.js";
import { customKey } from "../util.js";
import { block, defineNode, execIn, next } from "./common.js";

const both = ["discord", "telegram"] as const;

const modelField: FieldDef = {
  id: "model",
  static: true,
  label: "Model",
  kind: "model",
  required: true,
  help: "Models are defined in the Data panel on the left.",
};

const scopeField: FieldDef = {
  id: "scope",
  label: "Apply to",
  kind: "select",
  default: "first",
  options: [
    { value: "first", label: "The first matching record" },
    { value: "all", label: "Every matching record" },
  ],
};

const whereField: FieldDef = {
  id: "where",
  label: "Extra filter",
  kind: "expression",
  placeholder: '{ score: { gte: 100 }, name: { contains: "a" } }',
  help: "Optional Prisma filter merged with the inputs above.",
};

function idPort(prefix: string): PortDef {
  return { id: `${prefix}id`, label: "id", type: currentDatabase()?.provider === "mongodb" ? "string" : "number", optional: true };
}

function modelPorts(prefix: string, withId: boolean, suffix = "") {
  return (data: Record<string, FieldValue>) => {
    const model = findModel(data.model);
    if (!model) return { inputs: [] };
    const fields = model.fields.map((field) => ({ id: `${prefix}${field.name}`, label: `${field.name}${suffix}`, type: fieldPortType(field), optional: true }));
    return { inputs: withId ? [idPort(prefix), ...fields] : fields };
  };
}

function requireModel(ctx: EmitContext): Model {
  const model = findModel(ctx.field("model"));
  if (model) return model;
  if (!currentDatabase()?.models.length) return ctx.fail("Add a database model in the Data panel first.");
  return ctx.fail(`Choose a model. "${String(ctx.field("model") ?? "")}" does not exist.`);
}

function isSet(ctx: EmitContext, port: string): boolean {
  const custom = ctx.node.data[customKey(port)];
  return ctx.connected(port) || (typeof custom === "string" && custom.trim() !== "");
}

function objectOf(ctx: EmitContext, model: Model, prefix: string, withId: boolean): string[] {
  const names = withId ? ["id", ...model.fields.map((field) => field.name)] : model.fields.map((field) => field.name);
  return names.filter((name) => isSet(ctx, `${prefix}${name}`)).map((name) => `${name}: ${ctx.value(`${prefix}${name}`)}`);
}

function whereOf(ctx: EmitContext, model: Model): string {
  const parts = objectOf(ctx, model, "w_", true);
  const extra = String(ctx.field("where") ?? "").trim() || ctx.connected("where") ? ctx.value("where") : "";
  if (extra && extra !== "undefined") parts.unshift(`...(${extra})`);
  return `{ ${parts.join(", ")} }`;
}

function table(ctx: EmitContext, model: Model): string {
  return `${ctx.helper("db")}.${delegateName(model.name)}`;
}

export const dbCreate = defineNode({
  type: "core.dbCreate",
  label: "Create record",
  description: "Adds a record to a database model. Each field of the model becomes an input.",
  category: "data",
  icon: "DatabaseZap",
  platforms: both,
  inputs: [execIn],
  outputs: [next, { id: "record", label: "Record", type: "any" }, { id: "id", label: "id", type: "any" }],
  fields: [modelField],
  ports: modelPorts("f_", false),
  emit: (ctx) => {
    const model = requireModel(ctx);
    const missing = model.fields.filter((field) => !field.optional && !field.list && !field.default && !isSet(ctx, `f_${field.name}`));
    if (missing.length > 0) ctx.fail(`Give a value to ${missing.map((field) => field.name).join(", ")}; they are required by ${model.name}.`);
    const record = ctx.out("record");
    return [
      `const ${record} = await ${table(ctx, model)}.create({ data: { ${objectOf(ctx, model, "f_", false).join(", ")} } });`,
      `const ${ctx.out("id")} = ${record}.id;`,
    ].join("\n");
  },
});

export const dbFind = defineNode({
  type: "core.dbFind",
  label: "Find records",
  description: "Gets records that match the connected inputs, sorted and limited.",
  category: "data",
  icon: "Database",
  platforms: both,
  inputs: [execIn],
  outputs: [
    next,
    { id: "records", label: "Records", type: "list" },
    { id: "first", label: "First", type: "any" },
    { id: "count", label: "Count", type: "number" },
  ],
  fields: [
    modelField,
    { id: "orderBy", static: true, label: "Sort by field", kind: "text", placeholder: "createdAt" },
    {
      id: "direction",
      label: "Order",
      kind: "select",
      default: "desc",
      options: [
        { value: "desc", label: "Highest or newest first" },
        { value: "asc", label: "Lowest or oldest first" },
      ],
    },
    { id: "limit", label: "Limit", kind: "number", default: 10, min: 1, max: 1000 },
    whereField,
  ],
  ports: modelPorts("w_", true, " ="),
  emit: (ctx) => {
    const model = requireModel(ctx);
    const records = ctx.out("records");
    const order = String(ctx.field("orderBy") ?? "").trim();
    const options = [`where: ${whereOf(ctx, model)}`, `take: Number(${ctx.value("limit")}) || 10`];
    if (order) options.push(`orderBy: { ${JSON.stringify(order)}: ${JSON.stringify(ctx.field("direction") === "asc" ? "asc" : "desc")} }`);
    return [
      `const ${records} = await ${table(ctx, model)}.findMany({ ${options.join(", ")} });`,
      `const ${ctx.out("first")} = ${records}[0] ?? null;`,
      `const ${ctx.out("count")} = ${records}.length;`,
    ].join("\n");
  },
});

export const dbFindOne = defineNode({
  type: "core.dbFindOne",
  label: "Find one record",
  description: "Gets the first record that matches the connected inputs.",
  category: "data",
  icon: "Search",
  platforms: both,
  inputs: [execIn],
  outputs: [next, { id: "record", label: "Record", type: "any" }, { id: "found", label: "Found", type: "boolean" }],
  fields: [modelField, whereField],
  ports: modelPorts("w_", true, " ="),
  emit: (ctx) => {
    const model = requireModel(ctx);
    const record = ctx.out("record");
    return [`const ${record} = await ${table(ctx, model)}.findFirst({ where: ${whereOf(ctx, model)} });`, `const ${ctx.out("found")} = ${record} !== null;`].join(
      "\n",
    );
  },
});

function updateEmit(ctx: EmitContext): string {
  const model = requireModel(ctx);
  const data = objectOf(ctx, model, "s_", false);
  if (data.length === 0) ctx.fail("Connect or give a value to at least one field to change.");
  const count = ctx.out("count");
  const record = ctx.out("record");
  if (ctx.field("scope") === "all") {
    return [
      `const ${count} = (await ${table(ctx, model)}.updateMany({ where: ${whereOf(ctx, model)}, data: { ${data.join(", ")} } })).count;`,
      `const ${record} = null;`,
    ].join("\n");
  }
  const found = ctx.out("found");
  return [
    `const ${found} = await ${table(ctx, model)}.findFirst({ where: ${whereOf(ctx, model)} });`,
    `const ${record} = ${found} ? await ${table(ctx, model)}.update({ where: { id: ${found}.id }, data: { ${data.join(", ")} } }) : null;`,
    `const ${count} = ${record} ? 1 : 0;`,
  ].join("\n");
}

export const dbUpdate = defineNode({
  type: "core.dbUpdate",
  label: "Update records",
  description: "Changes records that match the filter inputs. Inputs ending in “← new” set the new values; use { increment: 1 } to add.",
  category: "data",
  icon: "PenLine",
  platforms: both,
  inputs: [execIn],
  outputs: [next, { id: "count", label: "Updated", type: "number" }, { id: "record", label: "Record", type: "any" }],
  fields: [modelField, scopeField, whereField],
  ports: (data) => {
    const filters = modelPorts("w_", true, " =")(data).inputs;
    const values = modelPorts("s_", false, " ← new")(data).inputs;
    return { inputs: [...filters, ...values] };
  },
  emit: updateEmit,
});

export const dbUpsert = defineNode({
  type: "core.dbUpsert",
  label: "Save record",
  description: "Updates the record with a matching unique field, or creates it when none exists. Use { increment: 1 } to add; a new record starts at that amount.",
  category: "data",
  icon: "Save",
  platforms: both,
  inputs: [execIn],
  outputs: [next, { id: "record", label: "Record", type: "any" }],
  fields: [
    modelField,
    { id: "match", static: true, label: "Match on field", kind: "text", required: true, placeholder: "userId", help: "A field marked unique in the model." },
  ],
  ports: modelPorts("f_", false),
  emit: (ctx) => {
    const model = requireModel(ctx);
    const match = String(ctx.field("match") ?? "").trim();
    const field = model.fields.find((item) => item.name === match);
    if (!field) return ctx.fail(`${model.name} has no field named ${match || "(empty)"}.`);
    if (!field.unique) ctx.fail(`Mark ${model.name}.${match} as unique in the Data panel to match on it.`);
    if (!isSet(ctx, `f_${match}`)) ctx.fail(`Connect or give a value to ${match}.`);
    const data = ctx.out("data");
    return [
      `const ${data} = { ${objectOf(ctx, model, "f_", false).join(", ")} };`,
      `const ${ctx.out("record")} = await ${table(ctx, model)}.upsert({ where: { ${match}: ${data}.${match} }, create: ${ctx.helper("toCreate")}(${data}), update: ${data} });`,
    ].join("\n");
  },
});

export const dbDelete = defineNode({
  type: "core.dbDelete",
  label: "Delete records",
  description: "Deletes records that match the connected inputs.",
  category: "data",
  icon: "Trash2",
  platforms: both,
  inputs: [execIn],
  outputs: [next, { id: "count", label: "Deleted", type: "number" }],
  fields: [modelField, scopeField, whereField],
  ports: modelPorts("w_", true, " ="),
  emit: (ctx) => {
    const model = requireModel(ctx);
    const where = whereOf(ctx, model);
    if (where === "{  }") ctx.fail("Connect at least one filter so Delete records does not remove everything.");
    const count = ctx.out("count");
    if (ctx.field("scope") === "all") return `const ${count} = (await ${table(ctx, model)}.deleteMany({ where: ${where} })).count;`;
    const found = ctx.out("found");
    return block(
      `const ${found} = await ${table(ctx, model)}.findFirst({ where: ${where} });\nif (${found}) {`,
      `await ${table(ctx, model)}.delete({ where: { id: ${found}.id } });`,
      `}\nconst ${count} = ${found} ? 1 : 0;`,
    );
  },
});

export const dbCount = defineNode({
  type: "core.dbCount",
  label: "Count records",
  description: "Counts records that match the connected inputs.",
  category: "data",
  icon: "Calculator",
  platforms: both,
  inputs: [execIn],
  outputs: [next, { id: "count", label: "Count", type: "number" }],
  fields: [modelField, whereField],
  ports: modelPorts("w_", true, " ="),
  emit: (ctx) => {
    const model = requireModel(ctx);
    return `const ${ctx.out("count")} = await ${table(ctx, model)}.count({ where: ${whereOf(ctx, model)} });`;
  },
});

export const databaseNodes = [dbCreate, dbFind, dbFindOne, dbUpdate, dbUpsert, dbDelete, dbCount];
