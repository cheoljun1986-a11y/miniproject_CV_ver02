export const APP_MODES = Object.freeze({
  GPU_OCCLUSION: 'gpu-occlusion',
  CLOUD: 'cloud',
  CPU_OCCLUSION: 'cpu-occlusion',
});

export function resolveAppMode(search = '') {
  const params = new URLSearchParams(search);
  if (params.get('occlusion') === 'cpu') return APP_MODES.CPU_OCCLUSION;
  if (params.get('depth') === 'cloud') return APP_MODES.CLOUD;
  return APP_MODES.GPU_OCCLUSION;
}

export function depthUsageForMode(mode) {
  return mode === APP_MODES.GPU_OCCLUSION ? 'gpu-optimized' : 'cpu-optimized';
}
