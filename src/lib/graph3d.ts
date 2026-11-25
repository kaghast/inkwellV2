// 3D view of the graph on the same 2D canvas (no WebGL dependency): nodes
// get a depth coordinate in the force simulation, the scene is rotated by
// yaw/pitch and drawn with a simple perspective. Pure, unit-tested.

export interface Rotation {
  yaw: number; // around the vertical axis, radians
  pitch: number; // around the horizontal axis, radians
}

export interface Projected {
  x: number;
  y: number;
  /** Scale factor for sizes at this depth (1 at the rotation centre). */
  scale: number;
  /** Larger is farther from the viewer. */
  depth: number;
}

/** Distance of the camera from the rotation centre, in world units. */
export const CAMERA_DISTANCE = 700;
export const PITCH_LIMIT = 1.4;

/** Rotate (x, y, z) by yaw then pitch and project it with perspective. */
export function project(x: number, y: number, z: number, rot: Rotation, camera = CAMERA_DISTANCE): Projected {
  const cy = Math.cos(rot.yaw), sy = Math.sin(rot.yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(rot.pitch), sp = Math.sin(rot.pitch);
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  // Points behind the camera are pushed just in front of it instead of flipping
  const scale = camera / Math.max(camera * 0.15, camera + z2);
  return { x: x1 * scale, y: y2 * scale, scale, depth: z2 };
}

/** Rotation after dragging by (dx, dy) pixels; pitch is clamped so the view never flips. */
export function rotateBy(rot: Rotation, dx: number, dy: number, speed = 0.008): Rotation {
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rot.pitch + dy * speed));
  return { yaw: rot.yaw + dx * speed, pitch };
}

/** Opacity for a node at this depth: nearer is more opaque (0.35..1). */
export function depthAlpha(depth: number, spread = 400): number {
  const t = Math.max(-1, Math.min(1, depth / spread));
  return 0.675 - 0.325 * t;
}
