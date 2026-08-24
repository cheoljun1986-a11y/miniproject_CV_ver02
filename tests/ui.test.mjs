import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMetrics } from '../src/ui.js';

test('formatMetrics preserves the existing HUD measurements', () => {
  const output = formatMetrics({
    viewerPosition: [1.234, 2.345, -3.456],
    pathDistance: 4.56,
    maxDisplacement: 3.21,
    poolCount: 7,
    hitTestFound: true,
    phase: 'mapping',
    mappingLeft: 8.76,
    scans: 3,
    misses: 2,
    lastReturnError: { posErr: 0.123, angleErr: 4.56 },
  });

  assert.equal(
    output,
    'viewer (m)  x 1.23  y 2.35  z -3.46\n'
      + '이동경로 4.6m   최대변위 3.2m\n'
      + '표면후보 7   hit-test FOUND\n'
      + 'phase mapping (8.8s)\n'
      + 'scan 3회 / miss 2회\n'
      + '복귀오차 0.12m, 4.6°',
  );
});

