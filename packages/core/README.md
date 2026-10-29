# @open-sila/core

Flow schema, node catalog, validation and code generator for [Open Sila](https://github.com/0xRoony/open-sila). It runs in Node.js and in the browser.

```ts
import { compileProject } from "@open-sila/core";

const result = compileProject({ name: "My bot", platform: "discord", flow });
if (result.ok) for (const file of result.files) console.log(file.path);
else console.error(result.diagnostics);
```

| Export | Description |
| --- | --- |
| `compileProject(project, { mode })` | Validates a flow and generates a runnable Node.js project (`production` or `development`) |
| `validateFlow(flow, platform)` | Errors and warnings without generating code |
| `listNodes(platform)`, `getNode(type)` | The node catalog |
| `flowSchema`, `projectDocumentSchema` | Zod schemas for flows and `.sila.json` project files |

See the [architecture notes](https://github.com/0xRoony/open-sila/blob/main/docs/architecture.md) and the [contributing guide](https://github.com/0xRoony/open-sila/blob/main/CONTRIBUTING.md) for how nodes are defined.

## License

MIT
