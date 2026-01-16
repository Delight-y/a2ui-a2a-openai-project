/**
 * a2ui_init.js (ESM)
 * Strict v0.8-like initializer:
 * - output: [{ path: "/base", contents: [{key, valueString|valueNumber|valueBool|valueJson}] }]
 *
 * Assumptions (match your front-end renderer):
 * - TextField: payload.text.path is bind path (string)
 * - Select: payload.options.path (array), payload.selectedIndex.path (number)
 * - Image: payload.src.path (string)
 * - Card: payload.body.path (string)
 * - Text: payload.text.path (string, optional)
 */

function normalizeComponent(c) {
  const comp = c?.component || {};
  const type = Object.keys(comp)[0];
  return { id: c?.id, type, payload: comp[type] || {} };
}

function splitPath(full) {
  const parts = String(full || "")
    .split("/")
    .filter(Boolean);
  if (!parts.length) return null;
  const key = parts[parts.length - 1];
  const base = "/" + parts.slice(0, -1).join("/");
  return { base: base === "" ? "/" : base, key };
}

function rankKind(kind) {
  // prefer "stronger" init types if conflict on same key
  // jsonArray > number > bool > string
  return { string: 1, bool: 2, number: 3, jsonArray: 4 }[kind] || 0;
}

function inferInitFromComponent(type, payload) {
  const out = [];

  if (type === "TextField") {
    if (payload?.text?.path)
      out.push({ path: payload.text.path, kind: "string" });
  }

  if (type === "Select") {
    if (payload?.options?.path)
      out.push({ path: payload.options.path, kind: "jsonArray" });
    if (payload?.selectedIndex?.path)
      out.push({ path: payload.selectedIndex.path, kind: "number" });
  }

  if (type === "Image") {
    if (payload?.src?.path)
      out.push({ path: payload.src.path, kind: "string" });
  }

  if (type === "Card") {
    if (payload?.body?.path)
      out.push({ path: payload.body.path, kind: "string" });
  }

  if (type === "Text") {
    if (payload?.text?.path)
      out.push({ path: payload.text.path, kind: "string" });
  }

  return out;
}

/**
 * Extract init items from catalog components.
 * @param {Array} components catalog.components
 * @returns {Array<{base:string, key:string, kind:"string"|"number"|"bool"|"jsonArray"}>}
 */
export function extractInitFromCatalog(components) {
  const list = Array.isArray(components) ? components : [];
  const best = new Map(); // `${base}::${key}` -> {base,key,kind}

  for (const c of list) {
    const { type, payload } = normalizeComponent(c);
    if (!type) continue;

    const items = inferInitFromComponent(type, payload);
    for (const it of items) {
      if (typeof it.path !== "string" || !it.path.startsWith("/")) continue;
      const sp = splitPath(it.path);
      if (!sp) continue;

      const k = `${sp.base}::${sp.key}`;
      const cur = best.get(k);
      if (!cur || rankKind(it.kind) > rankKind(cur.kind)) {
        best.set(k, { base: sp.base, key: sp.key, kind: it.kind });
      }
    }
  }

  return Array.from(best.values());
}

/**
 * Build v0.8-like init updates from extracted items.
 *
 * @param {Array<{base:string, key:string, kind:string}>} items
 * @param {Object} [opts]
 * @param {Record<string, any>} [opts.overrides] map: fullPath("/a/b") -> defaultValue
 *   - string -> valueString
 *   - number -> valueNumber
 *   - boolean -> valueBool
 *   - array/object -> valueJson
 *
 * @returns {Array<{path:string, contents:Array}>}
 */
export function buildInitUpdates(items, opts = {}) {
  const overrides =
    opts?.overrides && typeof opts.overrides === "object" ? opts.overrides : {};

  const grouped = new Map(); // base -> contents[]
  const ensure = (base) => {
    if (!grouped.has(base)) grouped.set(base, []);
    return grouped.get(base);
  };

  for (const it of Array.isArray(items) ? items : []) {
    const base = it.base || "/";
    const key = it.key;
    if (!key) continue;

    const fullPath = (base.endsWith("/") ? base : base + "/") + key;

    let entry;
    if (Object.prototype.hasOwnProperty.call(overrides, fullPath)) {
      const v = overrides[fullPath];
      if (v == null) entry = { key, valueString: "" };
      else if (typeof v === "string") entry = { key, valueString: v };
      else if (typeof v === "number") entry = { key, valueNumber: v };
      else if (typeof v === "boolean") entry = { key, valueBool: v };
      else entry = { key, valueJson: v };
    } else {
      // default by kind
      if (it.kind === "jsonArray") entry = { key, valueJson: [] };
      else if (it.kind === "number") entry = { key, valueNumber: -1 };
      else if (it.kind === "bool") entry = { key, valueBool: false };
      else entry = { key, valueString: "" };
    }

    ensure(base).push(entry);
  }

  return Array.from(grouped.entries()).map(([path, contents]) => ({
    path,
    contents,
  }));
}
