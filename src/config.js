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
export const HIDDEN_MODEL_HEIGHT_M = 0.5;

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
export const VOXEL_MAX_SOLID = 20000;
export const VOXEL_MAX_PENDING = 40000;
export const TRAIL_MIN_STEP_M = 0.15;
export const TRAIL_MAX_POINTS = 300;
export const OPERATOR_STATUS_GAP_MS = 200;
export const OPERATOR_RENDER_GAP_MS = 100;

// Keyframe voxel diagnostic (?voxel=debug mode). Unlike the cloud path above,
// capture is gated on camera motion rather than a wall clock, and every filter
// threshold below is a starting value the on-device sliders can re-tune without
// a rescan.
export const VOXEL_SCAN_SECONDS = 20;
export const VOXEL_KEYFRAME_MIN_TRANSLATION_M = 0.20;
export const VOXEL_KEYFRAME_MIN_ROTATION_DEG = 15;
// Raised from 15 after on-device scans capped out at 6.6s and 9.5s of the 20s
// window. More keyframes buy both room coverage and viewpoint overlap, which is
// what lifts cells out of the single-observation bucket.
export const VOXEL_KEYFRAME_MAX = 40;
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
export const CHASE_BODY_HEIGHT_M = 0.5;     // headroom Hachuping needs
export const CHASE_MAX_STEP_UP_M = 0.15;    // above this it is a jump
export const CHASE_MAX_JUMP_UP_M = 0.7;     // above this it cannot go at all
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
