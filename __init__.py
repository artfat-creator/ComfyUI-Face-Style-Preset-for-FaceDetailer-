"""ComfyUI Face Style Preset — registration entry point."""

import os
import json

from .face_style_preset import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

# Register server routes so the JS frontend can fetch preset data and the
# list of LoRA files known to ComfyUI.
try:
    from aiohttp import web
    from server import PromptServer
    import folder_paths

    _PRESETS_FILE = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "face_presets.json",
    )

    @PromptServer.instance.routes.get("/face_style_preset/presets")
    async def _get_presets(request):
        try:
            with open(_PRESETS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return web.json_response(data)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    @PromptServer.instance.routes.get("/face_style_preset/loras")
    async def _get_loras(request):
        try:
            loras = folder_paths.get_filename_list("loras")
            return web.json_response(loras)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

except Exception as _err:
    print(f"[FaceStylePreset] could not register HTTP routes: {_err}")


__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
