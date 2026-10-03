import json
import re
from datetime import datetime
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

# ============================================================================
# CONFIG & INITIALIZATION
# ============================================================================

st.set_page_config(page_title="Sandbox Game", page_icon="🎮", layout="wide", initial_sidebar_state="collapsed")

APP_DIR = Path(__file__).parent
SAVES_DIR = APP_DIR / "saved_worlds"

# The whole game (3D world, physics, humans, HUD) runs in this custom component.
# Python only handles saving, loading and asking Claude.
sandbox_world = components.declare_component("sandbox_world", path=str(APP_DIR / "components" / "sandbox_world"))

# Make the game fill the entire browser window
FULLSCREEN_CSS = """
<style>
header, footer, #MainMenu,
[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"], [data-testid="stStatusWidget"] {
    display: none !important;
}
html, body, .stApp { overflow: hidden !important; }
.block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; max-width: 100% !important; }
iframe[title*="sandbox_world"], [data-testid="stCustomComponentV1"] {
    position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
    border: 0 !important; z-index: 999990;
}
/* Don't fade the game out while Streamlit reruns after a save/load */
[data-stale="true"], [data-testid="stElementContainer"] { opacity: 1 !important; transition: none !important; }
</style>
"""

st.session_state.setdefault("handled_request", None)
st.session_state.setdefault("response", None)

# ============================================================================
# SAVE / LOAD
# ============================================================================

def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "map"

def list_saves():
    """All saved worlds, newest first"""
    saves = []
    if SAVES_DIR.exists():
        for f in SAVES_DIR.glob("*.json"):
            try:
                with open(f, "r") as fh:
                    data = json.load(fh)
                saves.append({
                    "file": f.name,
                    "map": data["map"],
                    "save_no": data["save_no"],
                    "timestamp": data["timestamp"],
                    "theme": data["world"].get("theme", "grasslands"),
                })
            except (OSError, ValueError, KeyError):
                continue
    return sorted(saves, key=lambda s: s["timestamp"], reverse=True)

def save_world(map_name, world):
    """Save the world as the next save number for this map"""
    SAVES_DIR.mkdir(exist_ok=True)
    save_no = max([s["save_no"] for s in list_saves() if s["map"] == map_name], default=0) + 1
    timestamp = datetime.now().isoformat(timespec="seconds")
    path = SAVES_DIR / f"{slugify(map_name)}_save{save_no}.json"
    with open(path, "w") as f:
        json.dump({"map": map_name, "save_no": save_no, "timestamp": timestamp, "world": world}, f)
    return {"save_no": save_no, "timestamp": timestamp}

def load_world(file_name):
    path = SAVES_DIR / Path(file_name).name  # never leave the saves folder
    with open(path, "r") as f:
        data = json.load(f)
    return {"map": data["map"], "save_no": data["save_no"], "timestamp": data["timestamp"], "world": data["world"]}

# ============================================================================
# CLAUDE
# ============================================================================

def ask_claude_for_plan(summary, materials, structures):
    """Ask Claude what the humans should build next"""
    from ai_helper import ask_ai  # loads ANTHROPIC_API_KEY from .env

    prompt = (
        "You direct tiny humans in a 3D block sandbox game. "
        f"World state: {json.dumps(summary)}. "
        f"Choose what they should build next. Materials: {', '.join(materials)}. "
        f"Structures: {', '.join(structures)}. "
        "Reply with exactly one line in the form: material,structure,short reason (max 8 words)"
    )
    text = ask_ai(prompt, max_tokens=60).strip().lower()
    material = next((m for m in materials if m in text), materials[0])
    structure = next((s for s in structures if s in text), structures[0])
    parts = [p.strip() for p in text.splitlines()[0].split(",")]
    reason = ", ".join(parts[2:]) if len(parts) > 2 else ""
    return {"material": material, "structure": structure, "reason": reason[:80]}

# ============================================================================
# REQUESTS FROM THE GAME
# ============================================================================

def handle_request(req):
    """Handle a save/load/ai request once. Returns True if it was new."""
    if not req or req.get("id") == st.session_state.handled_request:
        return False
    st.session_state.handled_request = req["id"]
    action = req.get("action")
    response = {"id": req["id"], "action": action}
    try:
        if action == "save":
            response.update(save_world(req["map_name"], req["world"]))
        elif action == "load":
            response.update(load_world(req["file"]))
        elif action == "ai":
            response["plan"] = ask_claude_for_plan(req["summary"], req["materials"], req["structures"])
        else:
            response["error"] = f"Unknown action: {action}"
    except Exception as e:
        response["error"] = str(e)
    st.session_state.response = response
    return True

# ============================================================================
# MAIN APP
# ============================================================================

st.markdown(FULLSCREEN_CSS, unsafe_allow_html=True)

# Handle the game's latest request before rendering so the reply goes out in this run
handle_request(st.session_state.get("world"))

request = sandbox_world(saves=list_saves(), response=st.session_state.response, key="world", default=None)

if handle_request(request):
    st.rerun()
