export const MAP_SECONDS = 20;
export const SAMPLE_GAP_MS = 250;
export const MIN_CANDIDATE_SPACING = 0.22;
export const MAX_TRACKING_STEP = 0.35;
export const HORIZONTAL_SURFACE_THRESHOLD = 0.62;
export const DETECT_MAX_DISTANCE_M = 5;
export const DETECT_MAX_ANGLE_DEG = 12;
export const NINJA_CAMOUFLAGE_OPACITY = 0.13;
export const NINJA_HORIZONTAL_OFFSET_M = 0.02;
export const NINJA_VERTICAL_OFFSET_M = 0.12;

// Scanned glTF model the game hides. Relative so GitHub Pages subpaths resolve.
// The built-in ninja is drawn instead when the file is missing or fails to load.
export const HIDDEN_MODEL_URL = './hcp.glb';
// Body shrunk from 30x30x50cm to a 20cm-wide footprint that matches one
// traversal cell exactly. Height keeps the model's proportions: 50 * (20/30)
// = 33.3cm, rounded UP to the next whole centimetre.
export const HIDDEN_MODEL_HEIGHT_M = 0.34;

// Depth point-cloud reconstruction (?depth=cloud mode).
export const DEPTH_CLOUD_SAMPLE_GAP_MS = 200; // read depth at most this often
export const DEPTH_CLOUD_GRID_COLS = 40; // samples taken across the depth frame
export const DEPTH_CLOUD_GRID_ROWS = 30;
export const DEPTH_CLOUD_VOXEL_M = 0.05; // dedup resolution (5cm)
export const DEPTH_CLOUD_MAX_POINTS = 60000; // hard cap on accumulated points
export const DEPTH_CLOUD_MAX_RANGE_M = 6; // ignore samples farther than this

// Dynamic depth-only mesh (?occlusion=cpu mode).
export const CPU_OCCLUSION_GRID_COLS = 80;
export const CPU_OCCLUSION_GRID_ROWS = 60;
export const CPU_OCCLUSION_SAMPLE_GAP_MS = 66;
export const CPU_OCCLUSION_MAX_RANGE_M = 6;
export const CPU_OCCLUSION_DEPTH_BIAS_M = 0.05;
export const CPU_OCCLUSION_MAX_DEPTH_JUMP_M = 0.20;
export const CPU_OCCLUSION_STALE_MS = 250;

// Voxel reconstruction / operator view.
export const VOXEL_SIZE_M = 0.05;
export const VOXEL_SOLID_MIN_HITS = 3;
// Raised from 20000 for the pre-built map flow: an untimed walk around a room
// measured ~62k voxels at 5cm, and a full map that silently stops growing is
// worse than the extra ~1MB the larger buffers cost.
export const VOXEL_MAX_SOLID = 80000;
export const VOXEL_MAX_PENDING = 40000;
export const TRAIL_MIN_STEP_M = 0.15;
export const TRAIL_MAX_POINTS = 300;
export const OPERATOR_STATUS_GAP_MS = 200;
export const OPERATOR_RENDER_GAP_MS = 100;

// Keyframe voxel diagnostic (?voxel=debug mode). Unlike the cloud path above,
// capture is gated on camera motion rather than a wall clock, and every filter
// threshold below is a starting value the on-device sliders can re-tune without
// a rescan.
// The diagnostic scan runs until the panel's stop button, for practical
// purposes: a room takes minutes to cover, and rebuild latency is acceptable
// there because the mode exists to inspect the map, not to play on it.
export const VOXEL_SCAN_SECONDS = 600;
export const VOXEL_KEYFRAME_MIN_TRANSLATION_M = 0.20;
export const VOXEL_KEYFRAME_MIN_ROTATION_DEG = 15;
// Raw keyframes cost ~77KB each (160x120 float32), so 400 is ~31MB in memory
// and ~40MB as exported JSON — the export size is what bounds this, not RAM.
export const VOXEL_KEYFRAME_MAX = 400;
export const VOXEL_KEYFRAME_MIN_GAP_MS = 250; // frame-budget guard, not a pose gate
export const VOXEL_KEYFRAME_MAX_SAMPLES = 40000; // 160x120 native fits at stride 1
export const VOXEL_DEBUG_MAX_CELLS = 200000;
export const VOXEL_DEBUG_MAX_INSTANCES = 120000; // a silent cap would corrupt the diagnosis
export const VOXEL_OVERLAY_MAX_INSTANCES = 6000;
export const VOXEL_OVERLAY_RADIUS_M = 4.0;
export const VOXEL_OVERLAY_REBUILD_STEP_M = 0.3;
export const VOXEL_REBUILD_DEBOUNCE_MS = 150;
// Chase mode (?mode=chase). Hachuping runs a legal route over the scanned
// space and the player has to hold SCAN while staying close to catch it.
export const CHASE_CELL_SIZE_M = 0.20;      // top-down grid resolution
export const CHASE_SLAB_HEIGHT_M = 0.10;    // vertical resolution per cell
export const CHASE_GRID_MIN_Y = -3.0;       // 'local' origin sits ~1.4m above the floor
export const CHASE_GRID_SLABS = 64;
export const CHASE_BODY_HEIGHT_M = 0.34;    // headroom = the body height above
export const CHASE_MAX_STEP_UP_M = 0.15;    // above this it is a jump
// 0.45 lets it hop a chair seat but not leap floor-to-desk in one go. The
// first play test used 0.7, which chained floor-chair-desk into an aerial
// highway: Hachuping crossed the whole room without ever touching the floor.
export const CHASE_MAX_JUMP_UP_M = 0.45;   // above this it cannot go at all
export const CHASE_MAX_DROP_M = 1.2;
// A ceiling looks exactly like a tabletop to the grid, so cap how high a
// surface may be above the detected floor before it stops counting.
export const CHASE_MAX_STAND_ABOVE_FLOOR_M = 1.3;
export const CHASE_MIN_WALKABLE_CELLS = 120; // refuse to start on a bare map
export const CHASE_RETARGET_MS = 3000;
export const CHASE_STUCK_MS = 4000;
export const CHASE_RECENT_WINDOW_MS = 15000; // how long a visited cell stays penalised
export const CHASE_GRID_MAX_TILES = 6000;
export const CHASE_PATH_MAX_POINTS = 256;
export const CHASE_GRID_REBUILD_GAP_MS = 250;

// Static voxel occluder (?occluder=voxel). Built once from the scan and left
// alone, unlike the per-frame depth meshes above.
export const VOXEL_OCCLUDER_MIN_OBSERVATIONS = 3;
// Depth slack lives in the rasteriser rather than in world space: a fixed
// world offset is only correct from one direction, polygonOffset is correct
// from every angle and costs nothing.
export const VOXEL_OCCLUDER_POLYGON_OFFSET_FACTOR = 1;
export const VOXEL_OCCLUDER_POLYGON_OFFSET_UNITS = 1;
// Terrain is built from confirmed cells only: a voxel seen once is as likely
// to be depth noise as a surface, and standing Hachuping on noise is worse
// than leaving a gap in the map.
export const VOXEL_TRAVERSAL_MIN_OBSERVATIONS = 3;

// Keyframe terrain — opt-in game space map (?terrain=keyframe).
// Same gate and filters as the diagnostic, but it runs for the whole session
// with no keyframe cap and folds each keyframe into the grid the moment it
// lands, keeping only the voxels. Memory therefore scales with room size, not
// with time walked.
export const VOXEL_TERRAIN_MIN_OBSERVATIONS = 3;
// Wider than the diagnostic's 250ms: a keyframe costs a full-resolution depth
// read plus filter and unproject, and mid-chase the camera never stops moving.
export const VOXEL_TERRAIN_MIN_GAP_MS = 400;
export const VOXEL_TERRAIN_MAX_CELLS = 200000;
// When the cell cap is reached, cells seen only once are evicted first: they
// are overwhelmingly depth noise, and the alternative is a map that stops
// growing the moment the player enters a new room.
export const VOXEL_TERRAIN_EVICT_BATCH = 20000;
export const VOXEL_TERRAIN_MAX_SOLID = 60000; // operator-view instance cap

// Scan backup to the dev server (serve.py, POST /upload). The game map is
// re-sent on this interval and once more at session end, so a tab that dies
// mid-run still leaves a file at most this stale in results/. The diagnostic
// scan (tens of MB) is sent only at session end and on demand.
export const SCAN_BACKUP_INTERVAL_MS = 30000;
