"""Physics world management using Pymunk."""

import pymunk
import pymunk.pygame_util
from game.config import GRAVITY, FRICTION, RESTITUTION


class PhysicsWorld:
    def __init__(self):
        self.space = pymunk.Space()
        self.space.gravity = GRAVITY

        # Create static ground
        ground_body = pymunk.Body(body_type=pymunk.Body.STATIC)
        ground_shape = pymunk.Segment(ground_body, (0, 700), (1200, 700), 5)
        ground_shape.friction = FRICTION
        self.space.add(ground_body, ground_shape)

        self.ground_body = ground_body
        self.ground_shape = ground_shape

    def add_body(self, mass, moment, pos):
        """Create and add a dynamic body to the world."""
        body = pymunk.Body(mass, moment)
        body.position = pos
        self.space.add(body)
        return body

    def add_static_body(self, pos):
        """Create a static body for non-moving objects."""
        body = pymunk.Body(body_type=pymunk.Body.STATIC)
        body.position = pos
        self.space.add(body)
        return body

    def add_shape(self, body, shape):
        """Add a shape to a body."""
        shape.friction = FRICTION
        shape.elasticity = RESTITUTION
        self.space.add(shape)
        return shape

    def step(self, dt):
        """Step the physics simulation."""
        self.space.step(dt)

    def get_bodies(self):
        """Get all bodies in the world."""
        return self.space.bodies

    def remove_body(self, body):
        """Remove a body and its shapes from the world."""
        self.space.remove(body)
        for shape in body.shapes:
            self.space.remove(shape)

    def query_point(self, pos, distance=100):
        """Query bodies near a point."""
        point_query = self.space.nearest_point_query(pos, distance)
        if point_query:
            return point_query.body
        return None

    def cast_ray(self, start, end):
        """Cast a ray and return the first hit."""
        query = self.space.segment_query(start, end, 0)
        if query:
            return query
        return None

    def apply_force(self, body, force):
        """Apply a force to a body."""
        body.velocity = force
