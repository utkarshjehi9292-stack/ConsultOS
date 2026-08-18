// Pull a single JSON object out of model text. Even with structured-output
// mode, a fallback path (or the grounded research model) may wrap JSON in prose
// or a ```json fence. Pure and unit-testable.

/** Extract and parse the first JSON object from `text`. Throws if none is found or it won't parse. */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : sliceFirstObject(text);
  if (candidate === null) throw new Error("No JSON object found in text.");
  return JSON.parse(candidate);
}

/** Return the substring of the first balanced top-level `{...}`, honoring strings/escapes. */
function sliceFirstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // unbalanced
}
