export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

export function identifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function camel(value: string): string {
  return value.replace(/[-_\s]+(.)?/g, (_, char: string | undefined) => (char ? char.toUpperCase() : ""));
}

const PLACEHOLDER = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export function templateLiteral(text: string): string {
  if (!PLACEHOLDER.test(text)) return JSON.stringify(text);
  PLACEHOLDER.lastIndex = 0;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    out += escapeTemplate(text.slice(last, match.index));
    out += "${" + match[1] + "}";
    last = (match.index ?? 0) + match[0].length;
  }
  out += escapeTemplate(text.slice(last));
  return "`" + out + "`";
}

const INPUT_REFERENCE = /\$(\d+)/g;

export function usesInputs(text: string): boolean {
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (/\$\d+/.test(match[1])) return true;
  }
  return false;
}

export function mergeInputs(text: string, refs: string[]): string {
  if (!usesInputs(text)) return refs.length === 1 ? refs[0] : "`" + refs.map((ref) => "${" + ref + "}").join("") + "`";
  let out = "";
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    out += escapeTemplate(text.slice(last, match.index));
    const expression = match[1].replace(INPUT_REFERENCE, (_, index: string) => `(${refs[Number(index) - 1] ?? "undefined"})`);
    out += "${" + expression + "}";
    last = (match.index ?? 0) + match[0].length;
  }
  return "`" + out + escapeTemplate(text.slice(last)) + "`";
}

function escapeTemplate(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function parseColor(value: string, fallback: number): number {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return parseInt(hex, 16);
}

export function customKey(port: string): string {
  return `@${port}`;
}

export function itemPort(prefix: string, item: string): string {
  return `${prefix}${identifier(item)}`;
}

export function rows(value: string): string[][] {
  return lines(value).map((line) => line.split("|").map((part) => part.trim()));
}

export function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
