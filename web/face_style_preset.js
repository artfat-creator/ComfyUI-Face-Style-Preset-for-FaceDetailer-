/**
 * ComfyUI Face Style Preset — Frontend extension
 *
 * Two responsibilities:
 *   1. Preset auto-fill: when the `preset` widget changes, populate
 *      positive_text / negative_text / guide_size / denoise / feather /
 *      bbox_padding widgets from the preset JSON.
 *   2. Dynamic LoRA stack UI: render a list of LoRA rows with add/remove
 *      buttons and serialize state to a hidden `lora_stack_json` widget so
 *      the Python backend can apply them.
 */

import { app } from "../../scripts/app.js";

const PRESETS_URL = "/face_style_preset/presets";
const LORAS_URL = "/face_style_preset/loras";
const NODE_CLASS = "FaceStylePreset";
const EXTENSION_NAME = "comfyui-face-preset.FaceStylePresetExt";

const SAFE_DEFAULTS = {
    positive_text: "",
    negative_text: "",
    guide_size: 384.0,
    denoise: 0.40,
    feather: 20,
    bbox_padding: 32,
};

let PRESETS = {};
let LORAS = ["None"];

async function loadPresets() {
    try {
        const response = await fetch(PRESETS_URL);
        if (!response.ok) {
            console.error(`[FaceStylePreset] presets fetch returned ${response.status}`);
            return;
        }
        PRESETS = await response.json();
        console.log(`[FaceStylePreset] loaded ${Object.keys(PRESETS).length} presets`);
    } catch (e) {
        console.error("[FaceStylePreset] failed to load presets:", e);
    }
}

async function loadLoras() {
    try {
        const response = await fetch(LORAS_URL);
        if (!response.ok) {
            console.error(`[FaceStylePreset] loras fetch returned ${response.status}`);
            return;
        }
        const data = await response.json();
        if (Array.isArray(data)) {
            LORAS = ["None", ...data];
            console.log(`[FaceStylePreset] loaded ${data.length} LoRA files`);
        }
    } catch (e) {
        console.error("[FaceStylePreset] failed to load LoRA list:", e);
    }
}

function setWidgetValue(node, name, value) {
    const widget = node.widgets?.find((w) => w.name === name);
    if (!widget) return;
    widget.value = value;
    if (typeof widget.callback === "function") {
        try {
            widget.callback(value);
        } catch (e) {
            // some widget callbacks expect different signatures; ignore
        }
    }
}

function applyPreset(node, presetName) {
    if (presetName === "User_Manual") return;

    if (presetName === "None") {
        for (const [k, v] of Object.entries(SAFE_DEFAULTS)) {
            setWidgetValue(node, k, v);
        }
        node.setDirtyCanvas(true, true);
        return;
    }

    const data = PRESETS[presetName];
    if (!data) {
        console.warn(`[FaceStylePreset] preset not found: ${presetName}`);
        return;
    }

    setWidgetValue(node, "positive_text", data.positive ?? "");
    setWidgetValue(node, "negative_text", data.negative ?? "");
    setWidgetValue(node, "guide_size", data.guide_size ?? SAFE_DEFAULTS.guide_size);
    setWidgetValue(node, "denoise", data.denoise ?? SAFE_DEFAULTS.denoise);
    setWidgetValue(node, "feather", data.feather ?? SAFE_DEFAULTS.feather);
    setWidgetValue(node, "bbox_padding", data.bbox_padding ?? SAFE_DEFAULTS.bbox_padding);

    node.setDirtyCanvas(true, true);
}

function hookPresetWidget(node) {
    const presetWidget = node.widgets?.find((w) => w.name === "preset");
    if (!presetWidget) return;
    const original = presetWidget.callback;
    presetWidget.callback = function (value) {
        applyPreset(node, value);
        if (typeof original === "function") {
            return original.call(this, value);
        }
    };
}

// ────────────────────────────────────────────────────────────
// LoRA stack UI
// ────────────────────────────────────────────────────────────

function readLoraStack(node) {
    const widget = node.widgets?.find((w) => w.name === "lora_stack_json");
    if (!widget) return [];
    try {
        const parsed = JSON.parse(widget.value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeLoraStack(node, stack) {
    const widget = node.widgets?.find((w) => w.name === "lora_stack_json");
    if (!widget) return;
    widget.value = JSON.stringify(stack);
}

function clearChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function createLoraStackUI(node) {
    const container = document.createElement("div");
    container.className = "face-preset-lora-stack";
    Object.assign(container.style, {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "6px",
        margin: "4px 0 0 0",
        background: "rgba(0,0,0,0.15)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "6px",
        boxSizing: "border-box",
        fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: "12px",
        color: "#ddd",
    });

    const header = document.createElement("div");
    header.textContent = "LoRA Stack";
    Object.assign(header.style, {
        fontWeight: "600",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        color: "#888",
        marginBottom: "2px",
        userSelect: "none",
    });
    container.appendChild(header);

    const rowsContainer = document.createElement("div");
    rowsContainer.className = "face-preset-lora-rows";
    Object.assign(rowsContainer.style, {
        display: "flex",
        flexDirection: "column",
        gap: "3px",
    });
    container.appendChild(rowsContainer);

    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add LoRA";
    Object.assign(addBtn.style, {
        padding: "6px",
        marginTop: "4px",
        background: "#2a2a2a",
        color: "#bbb",
        border: "1px dashed #555",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "12px",
        fontFamily: "inherit",
    });
    addBtn.addEventListener("mouseenter", () => (addBtn.style.background = "#333"));
    addBtn.addEventListener("mouseleave", () => (addBtn.style.background = "#2a2a2a"));
    addBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const stack = readLoraStack(node);
        stack.push({ enabled: true, name: "", strength: 1.0 });
        writeLoraStack(node, stack);
        renderLoraRows(node, rowsContainer);
    });
    container.appendChild(addBtn);

    return { container, rowsContainer };
}

// Single shared <datalist> for ALL LoRA inputs in the document.
// Cheaper than one per row, updates dynamically when LORAS changes.
const SHARED_DATALIST_ID = "face-preset-lora-datalist";

function ensureSharedDatalist() {
    let dl = document.getElementById(SHARED_DATALIST_ID);
    if (!dl) {
        dl = document.createElement("datalist");
        dl.id = SHARED_DATALIST_ID;
        document.body.appendChild(dl);
    }
    clearChildren(dl);
    for (const loraName of LORAS) {
        const opt = document.createElement("option");
        opt.value = loraName;
        dl.appendChild(opt);
    }
}

function renderLoraRows(node, rowsContainer) {
    ensureSharedDatalist();

    const stack = readLoraStack(node);
    clearChildren(rowsContainer);

    stack.forEach((entry, index) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "3px 4px",
            background: "#222",
            border: "1px solid #333",
            borderRadius: "4px",
        });

        // Toggle
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = !!entry.enabled;
        toggle.title = "Enable / disable this LoRA";
        Object.assign(toggle.style, {
            cursor: "pointer",
            margin: "0",
            flexShrink: "0",
        });
        toggle.addEventListener("change", () => {
            const s = readLoraStack(node);
            if (s[index]) {
                s[index].enabled = toggle.checked;
                writeLoraStack(node, s);
            }
        });
        toggle.addEventListener("mousedown", (e) => e.stopPropagation());
        row.appendChild(toggle);

        // LoRA name — text input with native datalist for filterable autocomplete.
        // Type to filter, click to pick from full list, free-form text accepted.
        const select = document.createElement("input");
        select.type = "text";
        select.setAttribute("list", SHARED_DATALIST_ID);
        select.value = entry.name ?? "";
        select.title = "Type to filter LoRA list; pick from suggestions or type a name";
        select.placeholder = "Filter LoRAs…";
        Object.assign(select.style, {
            flex: "1",
            minWidth: "0",
            padding: "2px 4px",
            background: "#1a1a1a",
            color: "#ddd",
            border: "1px solid #444",
            borderRadius: "3px",
            fontSize: "11px",
            fontFamily: "inherit",
            cursor: "text",
        });
        // Mark missing files visually.
        const refreshMissing = () => {
            const val = select.value;
            const isMissing = val && val !== "None" && !LORAS.includes(val);
            select.style.borderColor = isMissing ? "#aa6644" : "#444";
            select.title = isMissing
                ? "Warning: this LoRA file is not in your loras folder"
                : "Type to filter LoRA list; pick from suggestions or type a name";
        };
        refreshMissing();

        const commit = () => {
            const s = readLoraStack(node);
            if (s[index]) {
                s[index].name = select.value;
                writeLoraStack(node, s);
            }
            refreshMissing();
        };
        select.addEventListener("change", commit);
        select.addEventListener("input", commit);
        select.addEventListener("mousedown", (e) => e.stopPropagation());
        select.addEventListener("keydown", (e) => e.stopPropagation());
        row.appendChild(select);

        // Strength input
        const strengthInput = document.createElement("input");
        strengthInput.type = "number";
        strengthInput.value = entry.strength ?? 1.0;
        strengthInput.step = "0.05";
        strengthInput.min = "-10";
        strengthInput.max = "10";
        Object.assign(strengthInput.style, {
            width: "56px",
            padding: "2px 4px",
            background: "#1a1a1a",
            color: "#ddd",
            border: "1px solid #444",
            borderRadius: "3px",
            fontSize: "11px",
            fontFamily: "inherit",
            textAlign: "right",
            flexShrink: "0",
        });
        strengthInput.addEventListener("change", () => {
            const s = readLoraStack(node);
            if (s[index]) {
                const v = parseFloat(strengthInput.value);
                s[index].strength = Number.isFinite(v) ? v : 0.0;
                writeLoraStack(node, s);
            }
        });
        strengthInput.addEventListener("mousedown", (e) => e.stopPropagation());
        row.appendChild(strengthInput);

        // Remove button
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.title = "Remove this LoRA";
        Object.assign(removeBtn.style, {
            width: "22px",
            height: "22px",
            padding: "0",
            background: "#3a1f1f",
            color: "#d88",
            border: "1px solid #5a2a2a",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: "12px",
            lineHeight: "1",
            fontFamily: "inherit",
            flexShrink: "0",
        });
        removeBtn.addEventListener("mouseenter", () => (removeBtn.style.background = "#5a2a2a"));
        removeBtn.addEventListener("mouseleave", () => (removeBtn.style.background = "#3a1f1f"));
        removeBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const s = readLoraStack(node);
            s.splice(index, 1);
            writeLoraStack(node, s);
            renderLoraRows(node, rowsContainer);
        });
        removeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        row.appendChild(removeBtn);

        rowsContainer.appendChild(row);
    });

    if (stack.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "No LoRAs. Click + Add LoRA below.";
        Object.assign(empty.style, {
            color: "#666",
            fontStyle: "italic",
            padding: "6px",
            textAlign: "center",
            fontSize: "11px",
        });
        rowsContainer.appendChild(empty);
    }
}

function hideJsonWidget(node) {
    const w = node.widgets?.find((wd) => wd.name === "lora_stack_json");
    if (!w) return;

    // Make the widget invisible. Multiple fallbacks because different ComfyUI
    // frontend versions render widgets differently:
    //   - "converted-widget" type tells the canvas drawing loop to skip it
    //   - hidden=true is a LiteGraph-level flag
    //   - computeSize=[0,-4] collapses any reserved layout space
    //   - draw=noop overrides the inline canvas draw fn if it still runs
    //   - element/inputEl display:none hides any HTML elements
    w.type = "converted-widget";
    w.hidden = true;
    w.computeSize = () => [0, -4];
    w.serializeValue = async () => w.value;

    const originalDraw = w.draw;
    w.draw = function () {
        // intentional no-op so nothing renders even if the canvas tries
    };
    // Keep originalDraw reference so dev tools can inspect; not strictly used
    w._originalDraw = originalDraw;

    if (w.element) w.element.style.display = "none";
    if (w.inputEl) w.inputEl.style.display = "none";
    if (w.textarea) w.textarea.style.display = "none";

    // Force a node-size recalc so the empty slot collapses immediately
    if (typeof node.computeSize === "function") {
        const newSize = node.computeSize();
        node.size = [node.size[0], newSize[1]];
    }
    node.setDirtyCanvas?.(true, true);
}

function attachLoraStackUI(node) {
    if (node._faceStyleLoraUI) return;
    const { container, rowsContainer } = createLoraStackUI(node);
    renderLoraRows(node, rowsContainer);

    const widget = node.addDOMWidget("face_style_lora_ui", "div", container, {
        serialize: false,
        hideOnZoom: false,
    });

    node._faceStyleLoraUI = { container, rowsContainer, widget };

    // Re-render when workflow is loaded (lora_stack_json populated from save).
    const origOnConfigure = node.onConfigure;
    node.onConfigure = function (info) {
        const ret = origOnConfigure ? origOnConfigure.apply(this, arguments) : undefined;
        try {
            renderLoraRows(node, rowsContainer);
        } catch (e) {
            console.error("[FaceStylePreset] re-render after configure failed:", e);
        }
        return ret;
    };
}

app.registerExtension({
    name: EXTENSION_NAME,

    async setup() {
        await Promise.all([loadPresets(), loadLoras()]);
    },

    async nodeCreated(node) {
        if (node.comfyClass !== NODE_CLASS) return;
        hookPresetWidget(node);
        hideJsonWidget(node);
        setTimeout(() => attachLoraStackUI(node), 0);
    },
});
