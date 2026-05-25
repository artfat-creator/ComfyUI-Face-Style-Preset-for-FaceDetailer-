"""
ComfyUI Face Style Preset (All-in-One)

Combines:
- Style preset (12 entries) with auto-fill positive/negative + face detailer params
- Dynamic LoRA stack with on/off toggles and weight sliders (JS-driven UI)
- Internal CLIP text encoding (outputs CONDITIONING directly)

Inputs:  MODEL, CLIP, plus widgets for preset/prompts/params/loras
Outputs: MODEL (after LoRA stack), positive/negative CONDITIONING, face params
"""

import os
import json

import comfy.sd
import comfy.utils
import folder_paths


PRESETS_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "face_presets.json",
)


def load_presets():
    """Load presets from JSON. Returns empty dict on failure."""
    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[FaceStylePreset] presets file not found: {PRESETS_FILE}")
        return {}
    except json.JSONDecodeError as e:
        print(f"[FaceStylePreset] invalid JSON in {PRESETS_FILE}: {e}")
        return {}
    except Exception as e:
        print(f"[FaceStylePreset] failed to load presets: {e}")
        return {}


def encode_text(clip, text):
    """Encode text into CONDITIONING via CLIP. Empty text → empty conditioning."""
    if text is None:
        text = ""
    tokens = clip.tokenize(text)
    cond, pooled = clip.encode_from_tokens(tokens, return_pooled=True)
    return [[cond, {"pooled_output": pooled}]]


def apply_lora(model, clip, lora_name, strength):
    """Load and apply a LoRA to model+clip. Returns modified pair, or original on failure."""
    if not lora_name or lora_name == "None" or strength == 0.0:
        return model, clip
    lora_path = folder_paths.get_full_path("loras", lora_name)
    if lora_path is None:
        print(f"[FaceStylePreset] LoRA not found: {lora_name}")
        return model, clip
    try:
        lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
    except Exception as e:
        print(f"[FaceStylePreset] failed to load LoRA {lora_name}: {e}")
        return model, clip
    return comfy.sd.load_lora_for_models(model, clip, lora, strength, strength)


def parse_lora_stack(json_text):
    """Parse the JS-managed lora_stack_json string into a list of dicts.

    Expected JSON shape:
        [
            {"enabled": true, "name": "file.safetensors", "strength": 0.9},
            ...
        ]
    Returns [] on any parse failure.
    """
    if not json_text or not json_text.strip():
        return []
    try:
        data = json.loads(json_text)
    except json.JSONDecodeError as e:
        print(f"[FaceStylePreset] invalid lora_stack_json: {e}")
        return []
    if not isinstance(data, list):
        return []
    return data


class FaceStylePreset:
    """
    All-in-One face style preset node.

    Workflow:
    1. Select a preset → JS auto-fills positive/negative text + face params
    2. Edit any field manually if needed
    3. Add LoRAs via the "+ Add LoRA" button (JS-driven), toggle each on/off,
       pick name from dropdown, adjust strength
    4. Node applies LoRAs to model+clip in order, encodes prompts, outputs everything

    "User Manual" preset: JS does NOT touch widgets — pure manual control.
    "None" preset: JS clears text fields, sets safe default params.
    """

    @classmethod
    def INPUT_TYPES(cls):
        presets = load_presets()
        preset_names = list(presets.keys()) if presets else ["__NO_PRESETS__"]

        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "preset": (preset_names, {"default": preset_names[0]}),
                "guide_size": (
                    "FLOAT",
                    {"default": 384.0, "min": 64.0, "max": 2048.0, "step": 8.0},
                ),
                "denoise": (
                    "FLOAT",
                    {"default": 0.40, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "feather": (
                    "INT",
                    {"default": 20, "min": 0, "max": 64, "step": 1},
                ),
                "bbox_padding": (
                    "INT",
                    {"default": 32, "min": 0, "max": 256, "step": 1},
                ),
                "positive_enabled": ("BOOLEAN", {"default": True}),
                "positive_text": (
                    "STRING",
                    {"multiline": True, "default": ""},
                ),
                "negative_enabled": ("BOOLEAN", {"default": True}),
                "negative_text": (
                    "STRING",
                    {"multiline": True, "default": ""},
                ),
                # Hidden widget: JSON-encoded list of LoRA entries,
                # managed by the JS frontend (web/face_style_preset.js).
                "lora_stack_json": (
                    "STRING",
                    {"multiline": False, "default": "[]"},
                ),
            }
        }

    RETURN_TYPES = (
        "MODEL",
        "CONDITIONING",
        "CONDITIONING",
        "FLOAT",
        "FLOAT",
        "INT",
        "INT",
    )
    RETURN_NAMES = (
        "model",
        "positive",
        "negative",
        "guide_size",
        "denoise",
        "feather",
        "bbox_padding",
    )
    FUNCTION = "execute"
    CATEGORY = "Face Tools"

    def execute(
        self,
        model,
        clip,
        preset,
        guide_size,
        denoise,
        feather,
        bbox_padding,
        positive_enabled,
        positive_text,
        negative_enabled,
        negative_text,
        lora_stack_json="[]",
    ):
        # Apply LoRA stack (order = list order in the JSON)
        lora_stack = parse_lora_stack(lora_stack_json)
        for entry in lora_stack:
            if not isinstance(entry, dict):
                continue
            enabled = bool(entry.get("enabled", False))
            name = entry.get("name", "None")
            try:
                strength = float(entry.get("strength", 0.0))
            except (TypeError, ValueError):
                strength = 0.0
            if enabled:
                model, clip = apply_lora(model, clip, name, strength)

        # Encode positive prompt
        if positive_enabled and positive_text:
            positive_cond = encode_text(clip, positive_text)
        else:
            positive_cond = encode_text(clip, "")

        # Encode negative prompt
        if negative_enabled and negative_text:
            negative_cond = encode_text(clip, negative_text)
        else:
            negative_cond = encode_text(clip, "")

        return (
            model,
            positive_cond,
            negative_cond,
            float(guide_size),
            float(denoise),
            int(feather),
            int(bbox_padding),
        )


NODE_CLASS_MAPPINGS = {
    "FaceStylePreset": FaceStylePreset,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FaceStylePreset": "Face Style Preset",
}
