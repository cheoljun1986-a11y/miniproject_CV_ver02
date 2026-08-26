const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const A = require('./fig-anchor');
const B = require('./fig-commits');

const OUT = path.join(__dirname, 'preview');
fs.mkdirSync(OUT, { recursive: true });

const figs = {
  'a1-tracking': A.figTracking,
  'a2-drift': A.figDrift,
  'a3-snap': A.figSnap,
  'a4-noanchor': A.figNoAnchor,
  'a5-concept': A.figAnchorConcept,
  'a6-flow': A.figAnchorFlow,
  'a7-transform': A.figTransform,
  'b1-timeline': B.figTimeline,
  'b2-mesh': B.figOccluderMesh,
  'b3-resolution': B.figResolution,
  'b4-lag': B.figLag,
  'b5-signal': B.figWrongSignal,
  'b6-seven': B.figSevenPoint,
  'b7-opacity': B.figOpacityScale,
  'b8-wiring': B.figAnchorWiring,
  'b9-frames': B.figOperatorFrames,
};

for (const [name, fn] of Object.entries(figs)) {
  const svg = fn();
  const r = new Resvg(svg, {
    font: { fontDirs: ['C:\\Windows\\Fonts'], defaultFontFamily: 'Malgun Gothic', loadSystemFonts: true },
    fitTo: { mode: 'width', value: 1100 },
  });
  fs.writeFileSync(path.join(OUT, `${name}.png`), r.render().asPng());
  console.log('ok', name);
}
