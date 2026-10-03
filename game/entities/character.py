"""Humanoid character entity."""

import pymunk
import pygame
from enum import Enum
from game.config import (
    CHARACTER_RADIUS, CHARACTER_MASS, CHARACTER_JUMP_FORCE,
    CHARACTER_MOVE_FORCE, CHARACTER_MAX_SPEED, Colors
)


class CharacterState(Enum):
    IDLE = 1
    WALKING = 2
    JUMPING = 3
    FALLING = 4
    DEAD = 5


class Character:
    def __init__(self, world, pos, char_id=0, color=Colors.BLUE):
        """Create a character at the given position."""
        self.world = world
        self.id = char_id
        self.color = color
        self.pos = pos
        self.state = CharacterState.IDLE
        self.health = 100
        self.alive = True

        # Create physics body for character
        moment = pymunk.moment_for_circle(CHARACTER_MASS, 0, CHARACTER_RADIUS)
        self.body = world.add_body(CHARACTER_MASS, moment, pos)
        self.body.angular_velocity_limit = 0  # Prevent spinning

        # Create collision shape
        shape = pymunk.Circle(self.body, CHARACTER_RADIUS)
        shape.friction = 0.7
        shape.elasticity = 0.2
        world.add_shape(self.body, shape)
        self.shape = shape

        # Control state
        self.input = {"left": False, "right": False, "jump": False}
        self.grounded = False
        self.can_jump = True

        # AI state (for later)
        self.ai_enabled = False
        self.ai_timer = 0
        self.ai_state = "idle"
        self.ai_target = None

    def handle_input(self, keys):
        """Handle keyboard input."""
        if not self.alive:
            return

        self.input["left"] = keys[pygame.K_a]
        self.input["right"] = keys[pygame.K_d]
        self.input["jump"] = keys[pygame.K_SPACE]

    def update(self, dt):
        """Update character physics and state."""
        if not self.alive:
            return

        self.pos = self.body.position

        # Check if grounded (simple raycast)
        ground_check = self.world.space.segment_query(
            self.pos, (self.pos[0], self.pos[1] + CHARACTER_RADIUS + 5), 0
        )
        self.grounded = ground_check is not None

        if self.grounded:
            self.can_jump = True
            self.state = CharacterState.WALKING if any([self.input["left"], self.input["right"]]) else CharacterState.IDLE
        else:
            self.state = CharacterState.FALLING

        # Apply movement
        if self.input["left"]:
            self.body.velocity = (-CHARACTER_MAX_SPEED, self.body.velocity.y)
        elif self.input["right"]:
            self.body.velocity = (CHARACTER_MAX_SPEED, self.body.velocity.y)
        else:
            self.body.velocity = (0, self.body.velocity.y)

        # Jump
        if self.input["jump"] and self.can_jump and self.grounded:
            self.body.velocity = (self.body.velocity.x, -CHARACTER_JUMP_FORCE)
            self.can_jump = False
            self.state = CharacterState.JUMPING

        # Update AI if enabled
        if self.ai_enabled:
            self.update_ai(dt)

        # Cap velocity
        if self.body.velocity.y > 500:
            self.body.velocity = (self.body.velocity.x, 500)

    def update_ai(self, dt):
        """Update AI behavior (for Phase 3)."""
        self.ai_timer += dt
        # Placeholder for AI logic
        pass

    def draw(self, surface):
        """Draw the character."""
        if not self.alive:
            return

        x, y = int(self.pos.x), int(self.pos.y)
        pygame.draw.circle(surface, self.color, (x, y), CHARACTER_RADIUS)

        # Draw eyes
        eye_color = (255, 255, 255)
        eye_offset = 4
        if self.state == CharacterState.DEAD:
            eye_color = (0, 0, 0)
            pygame.draw.circle(surface, eye_color, (x - eye_offset, y - 2), 2)
            pygame.draw.circle(surface, eye_color, (x + eye_offset, y - 2), 2)
        else:
            pygame.draw.circle(surface, eye_color, (x - eye_offset, y - 2), 2)
            pygame.draw.circle(surface, eye_color, (x + eye_offset, y - 2), 2)

    def take_damage(self, amount):
        """Take damage and potentially die."""
        self.health -= amount
        if self.health <= 0:
            self.die()

    def die(self):
        """Kill the character."""
        self.alive = False
        self.state = CharacterState.DEAD

    def destroy(self):
        """Remove character from the physics world."""
        self.world.remove_body(self.body)
        self.alive = False

    def grab_block(self, block):
        """Grab a block (for Phase 2)."""
        pass

    def place_block(self, block_type, pos):
        """Place a block (for Phase 2)."""
        pass

    def set_ai_enabled(self, enabled):
        """Enable or disable AI control."""
        self.ai_enabled = enabled

    def get_state_info(self):
        """Get character state for debugging."""
        return {
            "id": self.id,
            "pos": self.pos,
            "state": self.state.name,
            "health": self.health,
            "grounded": self.grounded,
            "velocity": self.body.velocity
        }
