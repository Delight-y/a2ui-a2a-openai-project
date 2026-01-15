const surfaceId = "main";
document.getElementById("surfaceId").textContent = surfaceId;

const state = {
  componentMap: new Map(), // id -> { id, type, payload }
  dataModel: {},
  rootId: null,
};

function setPath(obj, path, value) {
  if (!path || typeof path !== "string") return;
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return;

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    cur[k] = cur[k] ?? {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj, path) {
  if (!path || typeof path !== "string") return undefined;
  const parts = path.split("/").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * 严格 v0.8-like：
 * - 只支持 literalString 或 path 引用
 */
function resolveText(ref) {
  if (!ref) return "";
  if (typeof ref === "string") return ref;
  if (ref.literalString != null) return String(ref.literalString);
  if (ref.path) return String(getPath(state.dataModel, ref.path) ?? "");
  return "";
}

function normalizeComponent(c) {
  const comp = c?.component || {};
  const type = Object.keys(comp)[0];
  return { id: c.id, type, payload: comp[type] || {} };
}

/**
 * 严格 v0.8-like dataModelUpdate：path + contents
 * contents item 支持：valueString/valueNumber/valueBool/valueJson
 */
function applyContents(basePath, contents) {
  const base =
    typeof basePath === "string" && basePath.length > 0 ? basePath : "/";

  for (const item of contents || []) {
    const fullPath = (base.endsWith("/") ? base : base + "/") + item.key;

    if (item.valueString != null)
      setPath(state.dataModel, fullPath, item.valueString);
    else if (item.valueNumber != null)
      setPath(state.dataModel, fullPath, item.valueNumber);
    else if (item.valueBool != null)
      setPath(state.dataModel, fullPath, item.valueBool);
    else if (item.valueJson != null)
      setPath(state.dataModel, fullPath, item.valueJson);
    else setPath(state.dataModel, fullPath, "");
  }
}

function formatOptionLabel(o) {
  if (!o) return "N/A";
  const airline = o.airline ?? "N/A";
  const depart = o.depart ?? "N/A";
  const arrive = o.arrive ?? "N/A";
  const price = o.price_cny != null ? `¥${o.price_cny}` : "¥-";
  return `${airline} ${depart}-${arrive} ${price}`.trim();
}

function formatOptionDetail(o) {
  if (!o) return "未选择";
  const lines = [
    `airline: ${o.airline ?? ""}`,
    `depart: ${o.depart ?? ""}`,
    `arrive: ${o.arrive ?? ""}`,
    `duration: ${o.duration ?? ""}`,
    `price_cny: ${o.price_cny ?? ""}`,
    `notes: ${o.notes ?? ""}`,
    `image_url: ${o.image_url ?? ""}`,
  ];
  return lines.join("\n");
}

function syncFlightSelection(items, idx) {
  const chosen = idx >= 0 && idx < items.length ? items[idx] : null;
  setPath(
    state.dataModel,
    "/flights/selected_detail_text",
    formatOptionDetail(chosen)
  );
  setPath(
    state.dataModel,
    "/flights/selected_detail_image",
    chosen?.image_url || ""
  );
}

function buildElement(nodeId) {
  const def = state.componentMap.get(nodeId);
  if (!def) {
    const el = document.createElement("div");
    el.textContent = `[Unknown component: ${nodeId}]`;
    return el;
  }

  const { type, payload = {} } = def;

  if (type === "Column") {
    const el = document.createElement("div");
    el.className = "col";
    const list = payload?.children?.explicitList || [];
    for (const childId of list) el.appendChild(buildElement(childId));
    return el;
  }

  if (type === "Text") {
    const tag = payload.usageHint === "h2" ? "h2" : "div";
    const el = document.createElement(tag);
    el.textContent = resolveText(payload.text);
    return el;
  }

  if (type === "TextField") {
    const wrap = document.createElement("div");

    const label = document.createElement("div");
    label.className = "muted";
    label.textContent = resolveText(payload.label) || "Input";

    const input = document.createElement("input");
    const bindPath = payload.text?.path;

    input.value = String(getPath(state.dataModel, bindPath) ?? "");
    input.addEventListener("input", () => {
      if (bindPath) setPath(state.dataModel, bindPath, input.value);
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  if (type === "Button") {
    const btn = document.createElement("button");
    btn.textContent = "Button";

    // v0.8-like：Button.child 引用一个 Text 组件
    if (payload.child) {
      const childDef = state.componentMap.get(payload.child);
      if (childDef?.type === "Text") {
        btn.textContent = resolveText(childDef.payload?.text) || "Button";
      }
    }

    btn.addEventListener("click", async () => {
      const context = {};
      for (const item of payload?.action?.context || []) {
        const k = item.key;
        const p = item.value?.path;
        context[k] = p ? getPath(state.dataModel, p) : undefined;
      }

      await postUserAction({
        name: payload?.action?.name || "action",
        surfaceId,
        context,
      });
    });

    return btn;
  }

  // ✅ Select：严格按后端 schema：items + selectedIndex
  if (type === "Select") {
    const wrap = document.createElement("div");

    const label = document.createElement("div");
    label.className = "muted";
    label.textContent = resolveText(payload.label) || "Select";

    const select = document.createElement("select");

    const itemsPath = payload.options?.path; // ✅ 修复：items，不是 options
    const selectedIndexPath = payload.selectedIndex?.path;

    const items = Array.isArray(getPath(state.dataModel, itemsPath))
      ? getPath(state.dataModel, itemsPath)
      : [];

    const selectedIndexRaw = getPath(state.dataModel, selectedIndexPath);
    const selectedIndex =
      typeof selectedIndexRaw === "number" ? selectedIndexRaw : -1;

    select.innerHTML = "";

    if (!items.length) {
      const opt = document.createElement("option");
      opt.value = "-1";
      opt.textContent = "（暂无航班）";
      select.appendChild(opt);
      select.disabled = true;

      // 同步详情清空
      syncFlightSelection([], -1);
    } else {
      select.disabled = false;

      items.forEach((item, index) => {
        const opt = document.createElement("option");
        opt.value = String(index);
        opt.textContent = formatOptionLabel(item); // ✅ 用短 label
        select.appendChild(opt);
      });

      const safeIndex =
        selectedIndex >= 0 && selectedIndex < items.length ? selectedIndex : 0;

      // 写回 selectedIndex
      if (selectedIndexPath)
        setPath(state.dataModel, selectedIndexPath, safeIndex);

      select.value = String(safeIndex);

      // ✅ 无论有没有 selectedIndexPath，都同步 detail text/image
      syncFlightSelection(items, safeIndex);
    }

    select.addEventListener("change", () => {
      const idx = Number(select.value);
      if (!Number.isFinite(idx)) return;

      if (selectedIndexPath) setPath(state.dataModel, selectedIndexPath, idx);

      const curItems = Array.isArray(getPath(state.dataModel, itemsPath))
        ? getPath(state.dataModel, itemsPath)
        : [];

      syncFlightSelection(curItems, idx);
      render();
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
    return wrap;
  }

  if (type === "Image") {
    const wrap = document.createElement("div");

    const img = document.createElement("img");
    const src = resolveText(payload.src) || "";
    const alt = resolveText(payload.alt) || "";

    img.src = String(src);
    img.alt = String(alt);

    // ✅ 只在有效时设置宽高
    if (Number.isFinite(Number(payload.width)))
      img.width = Number(payload.width);
    if (Number.isFinite(Number(payload.height)))
      img.height = Number(payload.height);

    // 可选：没图时隐藏破图标
    if (!src) img.style.display = "none";

    wrap.appendChild(img);
    return wrap;
  }

  if (type === "Card") {
    const card = document.createElement("div");
    card.className = "card";

    const h3 = document.createElement("h3");
    h3.textContent = resolveText(payload.title) || "Card";

    const body = document.createElement("pre");
    body.textContent = resolveText(payload.body);

    card.appendChild(h3);
    card.appendChild(body);
    return card;
  }

  const el = document.createElement("div");
  el.textContent = `[Unsupported type: ${type}]`;
  return el;
}

function render() {
  if (!state.rootId) return;
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(buildElement(state.rootId));
}

async function postUserAction(userAction) {
  const r = await fetch("/ui/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userAction }),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error("userAction failed:", t);
  }
}

// ===== SSE 接收：严格 v0.8-like =====
const es = new EventSource(
  `/ui/stream?surfaceId=${encodeURIComponent(surfaceId)}`
);

es.onmessage = (evt) => {
  let msg;
  try {
    msg = JSON.parse(evt.data);
  } catch {
    return;
  }

  if (msg.surfaceUpdate) {
    const comps = msg.surfaceUpdate.components || [];
    for (const c of comps) {
      const normalized = normalizeComponent(c);
      if (normalized?.id && normalized?.type) {
        state.componentMap.set(normalized.id, normalized);
      }
    }
  }

  if (msg.dataModelUpdate) {
    const basePath = msg.dataModelUpdate.path;
    const contents = msg.dataModelUpdate.contents;
    if (typeof basePath === "string" && Array.isArray(contents)) {
      applyContents(basePath, contents);
    } else {
      console.warn("Ignored non-v0.8 dataModelUpdate:", msg.dataModelUpdate);
    }
  }

  if (msg.beginRendering) {
    const root = msg.beginRendering.root;
    if (typeof root === "string" && root) {
      state.rootId = root;
      render();
      return;
    }
    console.warn("Ignored non-v0.8 beginRendering:", msg.beginRendering);
  }

  if (msg.surfaceUpdate || msg.dataModelUpdate) render();
};

es.onerror = (e) => {
  console.error("SSE error", e);
};
