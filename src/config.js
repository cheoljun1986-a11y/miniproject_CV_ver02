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

// Camera-recognized rock-paper-scissors duel.
export const RPS_COUNTDOWN_MS = 3000;
export const RPS_READ_TIMEOUT_MS = 3500;
export const RPS_RESULT_MS = 1400;
export const HAND_INFERENCE_GAP_MS = 80;
export const HAND_DETECTION_CONFIDENCE = 0.5;
export const HAND_MIN_CONFIDENCE = 0.55;
export const HAND_REQUIRED_MATCHES = 3;
export const HAND_SAMPLE_WINDOW = 5;
export const HAND_SAMPLE_MAX_AGE_MS = 900;

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
