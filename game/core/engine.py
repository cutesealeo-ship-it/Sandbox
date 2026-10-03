"""Main game engine and loop."""

import pygame
import sys
from game.config import (
    WINDOW_WIDTH, WINDOW_HEIGHT, FPS, TITLE, Colors
)
from game.core.physics import PhysicsWorld
from game.entities.character import Character


class GameEngine:
    def __init__(self):
        """Initialize the game engine."""
        pygame.init()
        self.screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
        pygame.display.set_caption(TITLE)
        self.clock = pygame.time.Clock()
        self.running = True
        self.dt = 0

        # Game state
        self.world = PhysicsWorld()
        self.characters = {}
        self.character_counter = 0
        self.paused = False
        self.time_scale = 1.0

        # Camera
        self.camera_x = 0
        self.camera_y = 0

        # UI
        self.font = pygame.font.Font(None, 36)
        self.small_font = pygame.font.Font(None, 24)

        # Spawn initial character
        self.spawn_character((600, 300))

    def spawn_character(self, pos, color=Colors.BLUE):
        """Spawn a new character."""
        char = Character(self.world, pos, self.character_counter, color)
        self.characters[self.character_counter] = char
        self.character_counter += 1
        return char

    def kill_character(self, char_id):
        """Kill and remove a character."""
        if char_id in self.characters:
            char = self.characters[char_id]
            char.destroy()
            del self.characters[char_id]

    def handle_events(self):
        """Handle input events."""
        keys = pygame.key.get_pressed()

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.running = False
            elif event.type == pygame.KEYDOWN:
                # Spacebar: jump (handled by character input)
                if event.key == pygame.K_SPACE:
                    pass
                # P: pause/unpause
                elif event.key == pygame.K_p:
                    self.paused = not self.paused
                # SPACE+Shift: spawn new character
                elif event.key == pygame.K_q:
                    self.spawn_character((300 + len(self.characters) * 50, 200))
                # K: kill random character
                elif event.key == pygame.K_k:
                    if self.characters:
                        char_id = list(self.characters.keys())[0]
                        self.kill_character(char_id)
                # R: reset game
                elif event.key == pygame.K_r:
                    self.reset_game()
                # +: increase time scale
                elif event.key == pygame.K_EQUALS or event.key == pygame.K_PLUS:
                    self.time_scale = min(3.0, self.time_scale + 0.5)
                # -: decrease time scale
                elif event.key == pygame.K_MINUS:
                    self.time_scale = max(0.5, self.time_scale - 0.5)

            elif event.type == pygame.MOUSEBUTTONDOWN:
                # Click to spawn character at mouse position
                if event.button == 1:
                    mouse_pos = pygame.mouse.get_pos()
                    self.spawn_character(mouse_pos)

        # Get the first character (player controlled)
        if self.characters:
            first_char = list(self.characters.values())[0]
            first_char.handle_input(keys)

    def update(self, dt):
        """Update game state."""
        if self.paused:
            return

        dt *= self.time_scale

        # Update physics
        self.world.step(dt)

        # Update characters
        for char in list(self.characters.values()):
            char.update(dt)

        # Update camera to follow first character
        if self.characters:
            first_char = list(self.characters.values())[0]
            self.camera_x = first_char.pos.x - WINDOW_WIDTH // 2
            self.camera_y = first_char.pos.y - WINDOW_HEIGHT // 2

    def render(self):
        """Render the game."""
        self.screen.fill(Colors.LIGHT_GRAY)

        # Draw ground
        pygame.draw.line(self.screen, Colors.DARK_GRAY, (0, 700), (1200, 700), 20)

        # Draw characters
        for char in self.characters.values():
            char.draw(self.screen)

        # Draw UI
        self.draw_ui()

        pygame.display.flip()

    def draw_ui(self):
        """Draw UI elements."""
        # FPS counter
        fps_text = self.font.render(f"FPS: {int(self.clock.get_fps())}", True, Colors.BLACK)
        self.screen.blit(fps_text, (10, 10))

        # Character count
        char_count_text = self.small_font.render(f"Characters: {len(self.characters)}", True, Colors.BLACK)
        self.screen.blit(char_count_text, (10, 50))

        # Time scale
        time_scale_text = self.small_font.render(f"Speed: {self.time_scale:.1f}x", True, Colors.BLACK)
        self.screen.blit(time_scale_text, (10, 80))

        # Paused indicator
        if self.paused:
            paused_text = self.font.render("PAUSED", True, Colors.RED)
            self.screen.blit(paused_text, (WINDOW_WIDTH - 300, 10))

        # Controls help
        help_text = [
            "A/D: Move | SPACE: Jump",
            "Click: Spawn | Q: Spawn New | K: Kill",
            "P: Pause | R: Reset | +/-: Speed"
        ]
        for i, text in enumerate(help_text):
            help_surface = self.small_font.render(text, True, Colors.BLACK)
            self.screen.blit(help_surface, (10, WINDOW_HEIGHT - 100 + i * 25))

    def reset_game(self):
        """Reset the game to initial state."""
        self.characters.clear()
        self.character_counter = 0
        self.world = PhysicsWorld()
        self.spawn_character((600, 300))
        self.paused = False
        self.time_scale = 1.0

    def run(self):
        """Main game loop."""
        while self.running:
            self.dt = self.clock.tick(FPS) / 1000.0
            self.handle_events()
            self.update(self.dt)
            self.render()

        pygame.quit()
        sys.exit()


def main():
    """Entry point for the game."""
    engine = GameEngine()
    engine.run()


if __name__ == "__main__":
    main()
