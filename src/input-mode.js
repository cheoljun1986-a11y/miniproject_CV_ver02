export function resolveInputMode(search = '') {
  return new URLSearchParams(search).get('input') === 'manual'
    ? 'manual'
    : 'camera';
}
