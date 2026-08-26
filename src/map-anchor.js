// One anchor, pinned at the origin, that the whole map rides on.
//
// The map (voxels → traversal grid → Hachuping) is stored in coordinates
// relative to where the phone was when the session started. That origin is a
// GUESS the tracker keeps revising: walk down a featureless corridor and back,
// and ARCore snaps its position estimate — but our stored map coordinates do
// not move with it, so the map ends up sideways in the room.
//
// An XRAnchor is a nail driven into the real world: the platform re-reports
// WHERE that nail is, in current coordinates, every frame. We drive one nail
// at the origin when map building starts and store everything relative to it.
// When drift correction moves the world, the anchor's reported pose carries
// the whole map along — one transform, not 80k voxel updates.
//
//   toAnchor(p)  world (localSpace, this frame)  →  map coordinates
//   toWorld(p)   map coordinates                 →  world, for rendering
//
// While the pose is identity (no anchor yet, or anchors unsupported) both are
// the identity function, so callers can use them unconditionally.

function rotate([qx, qy, qz, qw], [x, y, z]) {
  // Standard quaternion rotation q * v * q'.
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

export class MapAnchor {
  constructor() {
    this.reset();
  }

  reset() {
    this.anchor = null;
    this.pending = false;
    this.creating = false;
    this.state = 'idle';
    this.position = [0, 0, 0];
    this.orientation = [0, 0, 0, 1];
  }

  // Ask for the nail to be driven on the next frame that can do it.
  beginTracking() {
    this.pending = true;
    if (!this.anchor) this.state = 'pending';
  }

  // Call once per frame. Creates the anchor when first possible, then keeps
  // the latest pose. Losing tracking keeps the LAST KNOWN pose: a stale
  // transform beats snapping the map back to identity for a few frames.
  update(frame, localSpace, makeRigidTransform = (p) => new XRRigidTransform(p)) {
    if (this.pending && !this.anchor && !this.creating) {
      if (!localSpace || typeof frame?.createAnchor !== 'function') {
        this.pending = false;
        this.state = 'local'; // anchors unsupported — identity forever
      } else {
        let result = null;
        try {
          result = frame.createAnchor(makeRigidTransform({ x: 0, y: 0, z: 0 }), localSpace);
        } catch {
          this.pending = false;
          this.state = 'local';
        }
        if (result) {
          this.creating = true;
          Promise.resolve(result)
            .then((anchor) => {
              this.anchor = anchor;
              this.creating = false;
              this.pending = false;
              this.state = 'anchor';
            })
            .catch(() => {
              this.creating = false;
              this.pending = false;
              this.state = 'local';
            });
        }
      }
    }

    if (!this.anchor || !localSpace || typeof frame?.getPose !== 'function') {
      return this.state;
    }
    let pose = null;
    try {
      pose = frame.getPose(this.anchor.anchorSpace, localSpace);
    } catch {
      pose = null;
    }
    if (!pose) {
      if (this.state === 'anchor') this.state = 'anchor-lost';
      return this.state;
    }
    const { position: p, orientation: o } = pose.transform;
    this.position = [p.x, p.y, p.z];
    this.orientation = [o.x, o.y, o.z, o.w];
    this.state = 'anchor';
    return this.state;
  }

  toWorld([x, y, z]) {
    const r = rotate(this.orientation, [x, y, z]);
    return [
      r[0] + this.position[0],
      r[1] + this.position[1],
      r[2] + this.position[2],
    ];
  }

  toAnchor([x, y, z]) {
    const [qx, qy, qz, qw] = this.orientation;
    return rotate([-qx, -qy, -qz, qw], [
      x - this.position[0],
      y - this.position[1],
      z - this.position[2],
    ]);
  }

  // How much the anchor frame is rotated about the vertical axis — added to
  // Hachuping's heading so the model faces its direction of travel even after
  // a drift correction that included rotation.
  yaw() {
    const dir = rotate(this.orientation, [0, 0, 1]);
    return Math.atan2(dir[0], dir[2]);
  }

  getState() {
    return this.state;
  }
}
