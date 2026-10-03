"""Game configuration and settings."""

import pygame
from enum import Enum

# Window
WINDOW_WIDTH = 1200
WINDOW_HEIGHT = 800
FPS = 60
TITLE = "Sandbox Game"

# Physics
GRAVITY = (0, 9.81)
FRICTION = 0.5
RESTITUTION = 0.3

# Colors
class Colors:
    WHITE = (255, 255, 255)
    BLACK = (0, 0, 0)
    GRAY = (128, 128, 128)
    DARK_GRAY = (64, 64, 64)
    LIGHT_GRAY = (200, 200, 200)

    # Block themes
    WOOD = (139, 69, 19)
    STONE = (128, 128, 128)
    GLASS = (173, 216, 230)
    METAL = (192, 192, 192)
    SAND = (238, 214, 175)

    # UI
    RED = (255, 0, 0)
    GREEN = (0, 255, 0)
    BLUE = (0, 0, 255)
    YELLOW = (255, 255, 0)

# Block sizes and physics
BLOCK_SIZE = 30
CHARACTER_RADIUS = 8

# Theme definitions
THEMES = {
    "default": {
        "name": "Default",
        "colors": {
            "block1": Colors.WOOD,
            "block2": Colors.STONE,
            "block3": Colors.SAND,
            "character": Colors.BLUE
        }
    },
    "castle": {
        "name": "Castle",
        "colors": {
            "block1": (100, 100, 100),  # Dark stone
            "block2": (120, 120, 120),  # Light stone
            "block3": (70, 70, 70),     # Dark gray
            "character": (255, 215, 0)  # Gold
        }
    },
    "industrial": {
        "name": "Industrial",
        "colors": {
            "block1": Colors.METAL,
            "block2": (100, 100, 100),
            "block3": (80, 80, 80),
            "character": Colors.YELLOW
        }
    }
}

# Character physics
CHARACTER_MASS = 1.0
CHARACTER_JUMP_FORCE = 300
CHARACTER_MOVE_FORCE = 200
CHARACTER_MAX_SPEED = 150

# Block physics
BLOCK_DENSITY = 1.0

# AI Parameters
AI_UPDATE_INTERVAL = 0.5  # seconds between AI decisions
AI_WANDER_SPEED = 100
AI_VIEW_DISTANCE = 200
AI_MAX_BLOCKS_CARRY = 1
