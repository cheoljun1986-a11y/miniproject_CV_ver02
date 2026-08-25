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
export const CHASE_MIN_WALKABLE_CELLS = 120; // refuse to start on a bare map
export const CHASE_RETARGET_MS = 3000;
export const CHASE_STUCK_MS = 4000;
export const CHASE_RECENT_WINDOW_MS = 15000; // how long a visited cell stays penalised
export const CHASE_GRID_MAX_TILES = 6000;
export const CHASE_PATH_MAX_POINTS = 256;
export const CHASE_GRID_REBUILD_GAP_MS = 250;
