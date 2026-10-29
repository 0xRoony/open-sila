import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { compileProject, listNodes, type Flow } from "../src/index.js";
import { chain, DATABASE, TRIGGERS, type Chain } from "./fixtures.js";

function checkSyntax(files: { path: string; content: string }[]): void {
  const dir = mkdtempSync(join(tmpdir(), "sila-catalog-"));
  try {
    const paths = files
      .filter((file) => file.path.endsWith(".js"))
      .map((file) => {
        const target = join(dir, file.path.replace(/\.js$/, ".mjs"));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, file.content);
        return target;
      });
    for (const path of paths) execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const platform of ["discord", "telegram"] as const) {
  test(`every ${platform} node compiles to valid JavaScript`, () => {
    const flow: Flow = { nodes: [], edges: [], database: DATABASE };
    const failures: string[] = [];

    for (const definition of listNodes(platform)) {
      let accepted: Chain | undefined;
      let lastError = "";
      for (const triggerType of definition.category === "trigger" ? [""] : TRIGGERS[platform]) {
        const candidate = chain(platform, definition, triggerType);
        const result = compileProject({ name: "catalog", platform, flow: { ...candidate, database: DATABASE } });
        if (result.ok) {
          accepted = candidate;
          break;
        }
        lastError = result.diagnostics.map((item) => item.message).join("; ");
      }
      if (!accepted) failures.push(`${definition.type}: ${lastError}`);
      else {
        flow.nodes.push(...accepted.nodes);
        flow.edges.push(...accepted.edges);
      }
    }

    assert.deepEqual(failures, []);
    for (const mode of ["production", "development"] as const) {
      const result = compileProject({ name: "catalog", platform, flow }, { mode });
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics.slice(0, 5)));
      checkSyntax(result.files);
    }
  });
}
