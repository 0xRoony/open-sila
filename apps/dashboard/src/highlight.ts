export type TokenType = "comment" | "string" | "number" | "keyword" | "literal" | "function" | "property" | "type" | "punctuation" | "key" | "heading" | "plain";

export interface Token {
  type: TokenType;
  text: string;
}

const JS_KEYWORDS = new Set(
  "import export from default const let var function return if else for of in while do break continue switch case new await async try catch finally throw class extends typeof instanceof delete void yield static get set as".split(
    " ",
  ),
);
const LITERALS = new Set(["true", "false", "null", "undefined", "this", "NaN", "Infinity"]);
const PRISMA_KEYWORDS = new Set(["model", "generator", "datasource", "enum"]);
const DOCKER_KEYWORDS = new Set(["FROM", "RUN", "WORKDIR", "COPY", "ENV", "EXPOSE", "VOLUME", "CMD", "HEALTHCHECK", "ARG", "ENTRYPOINT"]);

const SCRIPT =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*(?:\.\d+)?\b)|(@{1,2}[A-Za-z_]+|\b[A-Za-z_$][\w$]*\b)|([{}()[\];,.:=<>+\-*/!?&|%]+)/g;

function language(path: string): "js" | "json" | "prisma" | "docker" | "env" | "toml" | "markdown" | "text" {
  if (/\.(m?js|ts)$/.test(path)) return "js";
  if (/\.json$/.test(path)) return "json";
  if (/\.prisma$/.test(path)) return "prisma";
  if (/Dockerfile$/.test(path)) return "docker";
  if (/\.env/.test(path)) return "env";
  if (/\.toml$/.test(path)) return "toml";
  if (/\.md$/.test(path)) return "markdown";
  return "text";
}

function script(source: string, kind: "js" | "json" | "prisma" | "docker" | "toml"): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of source.matchAll(SCRIPT)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: "plain", text: source.slice(last, index) });
    const [text, comment, string, number, word] = match;
    const after = source.slice(index + text.length);
    let type: TokenType = "punctuation";
    if (comment) type = kind === "js" && text.startsWith("#") ? "plain" : "comment";
    else if (string) type = kind === "json" && /^\s*:/.test(after) ? "key" : "string";
    else if (number) type = "number";
    else if (word) {
      if (LITERALS.has(word)) type = "literal";
      else if (kind === "js" && JS_KEYWORDS.has(word)) type = "keyword";
      else if (kind === "prisma" && (PRISMA_KEYWORDS.has(word) || word.startsWith("@"))) type = "keyword";
      else if (kind === "docker" && DOCKER_KEYWORDS.has(word)) type = "keyword";
      else if (kind === "toml" && /^\s*=/.test(after)) type = "key";
      else if (/^\s*\(/.test(after)) type = "function";
      else if (source[index - 1] === ".") type = "property";
      else if (/^[A-Z]/.test(word)) type = "type";
      else type = "plain";
    }
    tokens.push({ type, text });
    last = index + text.length;
  }
  if (last < source.length) tokens.push({ type: "plain", text: source.slice(last) });
  return tokens;
}

function lines(source: string, read: (line: string) => Token[]): Token[] {
  return source.split("\n").flatMap((line, index) => [...(index > 0 ? [{ type: "plain" as const, text: "\n" }] : []), ...read(line)]);
}

export function highlight(path: string, source: string): Token[] {
  const kind = language(path);
  switch (kind) {
    case "js":
    case "json":
    case "prisma":
    case "docker":
    case "toml":
      return script(source, kind);
    case "env":
      return lines(source, (line) => {
        if (line.startsWith("#")) return [{ type: "comment", text: line }];
        const at = line.indexOf("=");
        if (at < 0) return [{ type: "plain", text: line }];
        return [
          { type: "key", text: line.slice(0, at) },
          { type: "punctuation", text: "=" },
          { type: "string", text: line.slice(at + 1) },
        ];
      });
    case "markdown":
      return lines(source, (line) => {
        if (/^#{1,6}\s/.test(line)) return [{ type: "heading", text: line }];
        if (/^```/.test(line)) return [{ type: "comment", text: line }];
        return line.split(/(`[^`]+`)/).map((part) => ({ type: part.startsWith("`") ? ("string" as const) : ("plain" as const), text: part }));
      });
    default:
      return [{ type: "plain", text: source }];
  }
}
