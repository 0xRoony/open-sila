# Contributing

Bug reports, new nodes and fixes are welcome. For larger changes, open an issue first so the approach can be agreed before you write the code.

## Setup

```bash
npm install
npm run build
npm test
```

Run `npm run dev:server` and `npm run dev:dashboard` in two terminals while working on the dashboard, and sign in through the link the server prints.

The code style is enforced by review: 2-space indentation, a line width of 140, no comments that restate the code, and names that read like the surrounding code.

## Adding a node

Nodes live in `packages/core/src/nodes`: shared nodes in `core.ts` and `extra.ts`, database nodes in `database.ts`, and platform nodes in `discord.ts` or `telegram.ts`. A node declares its ports, its fields, and one of three generators:

- `trigger(ctx)` for nodes that start a flow. Returns the handler file name, the variables the flow can use, and a `wrap(body)` function that places the flow inside the event listener.
- `emit(ctx)` for nodes on the run path. Returns JavaScript statements.
- `expression(ctx, output)` for pure value nodes. Returns a JavaScript expression for the requested output, so one node can expose several values.

Set `icon` to a [Lucide](https://lucide.dev/icons) icon name and add it to `apps/dashboard/src/icons.tsx`. A node whose ports depend on its settings, such as slash command options, declares `ports(data)` and returns the extra inputs and outputs.

```ts
export const shout = defineNode({
  type: "core.shout",
  label: "Shout",
  description: "Uppercases a text.",
  category: "data",
  platforms: ["discord", "telegram"],
  inputs: [{ id: "text", label: "Text", type: "string" }],
  outputs: [{ id: "result", label: "Result", type: "string" }],
  fields: [{ id: "text", label: "Text", kind: "text" }],
  expression: (ctx) => `String(${ctx.value("text")}).toUpperCase()`,
});
```

Useful context methods:

| Method | Returns |
| --- | --- |
| `ctx.value(id)` | The connected value, or the field value as a JavaScript literal, or the trigger variable with the same name |
| `ctx.out(id)` | The variable name for an output port |
| `ctx.branch(port)` | The code for an exec output, for nodes with more than one path |
| `ctx.declare(id)` | Makes an output available to the paths built after it, such as the item inside a loop |
| `ctx.use(name)` | Imports `name` from `discord.js` or `grammy` |
| `ctx.helper(name)` | Imports a runtime helper such as `respond` or `store` |
| `ctx.fail(message)` | Reports a compile error on this node |

Add the node to the list at the bottom of its file. Two tests then cover it automatically:

- `catalog.test.ts` compiles it in development and production mode and runs `node --check` on the output.
- `runtime.test.ts` runs its generated code against mocked discord.js and grammY clients in four scenarios and fails on any error the code throws or logs.

Add a focused test in `compiler.test.ts` when the node has behaviour worth pinning down. If the runtime test needs a sample value for a required field, add it to `SAMPLES` in `packages/core/test/fixtures.ts`.

## Pull requests

- Keep changes focused. One feature or fix per pull request.
- Run `npm run typecheck` and `npm test` before opening it.
- Add an entry under an `Unreleased` heading in [CHANGELOG.md](CHANGELOG.md) for user-facing changes.
- Describe what changed and how you tested it, including a screenshot for dashboard changes.
