# Anchored Shared CPU Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 WebXR AR 세션에서 Ninja를 XRAnchor로 고정하고, 한 번 읽은 CPU depth를 동적 오클루전과 누적 복셀 지도에 공유한다.

**Architecture:** 표면 배치 계산과 표시 문자열은 순수 모듈로 분리해 Node에서 검증한다. `NinjaGame`은 활성 XRFrame에서 anchor 생명주기를 관리하고, `CpuDepthFrameSource`는 같은 XRFrame의 viewer pose와 depth를 캐시해 두 소비자에게 제공한다. `main.js`는 기본 GPU, 통합 CPU, cloud 진단 모드의 조립만 담당한다.

**Tech Stack:** JavaScript ES modules, WebXR Anchors/Depth Sensing, Three.js 0.180, Node.js `node:test`, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-08-25-anchor-shared-cpu-depth-design.md`

## Global Constraints

- `cj_develop` 브랜치에서만 작업하고 `main`을 checkout, merge, push하지 않는다.
- `img/`는 사용자 자료이므로 수정, stage, commit하지 않는다.
- `?occlusion=cpu`는 약 15 Hz 80×60 오클루전과 약 5 Hz 40×30 복셀 누적을 함께 실행한다.
- 기본 URL의 GPU 모드를 유지하고 `?depth=cloud`는 공간 복원 진단 모드로 유지한다.
- CPU 오클루전 depth bias는 `0.05 m`, stale 제한은 `250 ms`를 유지한다.
- 같은 XRFrame/view의 `getDepthInformation(view)`는 한 번만 호출한다.
- 앱 종료 후 복원용 Persistent/Cloud Anchor는 구현하지 않는다.
- 새 동작과 버그 수정은 실패 테스트를 먼저 확인한 뒤 구현한다.
- 실기기 결과는 배포 후 사용자 확인 항목으로 구분한다.

---

### Task 1: 표면 normal 기반 Ninja 배치

**Files:**
- Create: `src/surface-placement.js`
- Create: `tests/surface-placement.test.mjs`
- Modify: `src/config.js`
- Modify: `src/ninja-game.js`

**Interfaces:**
- Consumes: 후보 `{ matrix: number[16], pos: number[3] }`, viewer position `number[3]`
- Produces: `surfaceNormalFromMatrix(matrix)`, `orientNormalTowardViewer(normal, surfacePosition, viewerPosition)`, `placeNinjaOnSurface(candidate, viewerPosition, options?) → { position, normal, horizontal, offset }`

- [ ] **Step 1: normal, 방향 반전, offset의 실패 테스트 작성**

```js
test('extracts and normalizes the local Y axis from a column-major surface matrix', () => {
  assert.deepEqual(surfaceNormalFromMatrix([
    1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]), [0, 1, 0]);
});

test('flips a wall normal toward the viewer and offsets the ninja by 12cm', () => {
  const result = placeNinjaOnSurface({
    pos: [0, 1, -2],
    matrix: [0, 0, 1, 0, 0, 0, -1, 0, -1, 0, 0, 0, 0, 1, -2, 1],
  }, [0, 1, 0]);
  assert.deepEqual(result.normal, [0, 0, 1]);
  assert.deepEqual(result.position, [0, 1, -1.88]);
  assert.equal(result.horizontal, false);
});

test('keeps a ninja upright and offsets a horizontal surface by 2cm', () => {
  const result = placeNinjaOnSurface({
    pos: [1, 0, -2],
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, -2, 1],
  }, [0, 1.6, 0]);
  assert.deepEqual(result.position, [1, 0.02, -2]);
  assert.equal(result.horizontal, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/surface-placement.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` for `src/surface-placement.js`.

- [ ] **Step 3: 최소 배치 로직과 상수 구현**

```js
export const NINJA_HORIZONTAL_OFFSET_M = 0.02;
export const NINJA_VERTICAL_OFFSET_M = 0.12;

export function surfaceNormalFromMatrix(matrix) {
  return normalize([matrix[4], matrix[5], matrix[6]]);
}

export function placeNinjaOnSurface(candidate, viewerPosition, {
  horizontalThreshold = HORIZONTAL_SURFACE_THRESHOLD,
  horizontalOffset = NINJA_HORIZONTAL_OFFSET_M,
  verticalOffset = NINJA_VERTICAL_OFFSET_M,
} = {}) {
  const normal = orientNormalTowardViewer(
    surfaceNormalFromMatrix(candidate.matrix), candidate.pos, viewerPosition,
  );
  const horizontal = Math.abs(normal[1]) >= horizontalThreshold;
  const offset = horizontal ? horizontalOffset : verticalOffset;
  return {
    position: candidate.pos.map((value, index) => value + normal[index] * offset),
    normal,
    horizontal,
    offset,
  };
}
```

`NinjaGame.hideNewTarget()`는 `placeNinjaOnSurface(chosen, viewerPose.position)`의 `position`을 object와 target 양쪽에 그대로 복사하고 `object.quaternion.identity()`를 유지한다.

- [ ] **Step 4: 신규 테스트와 기존 Ninja 테스트 통과 확인**

Run: `node --test tests/surface-placement.test.mjs tests/ninja-game.test.mjs`

Expected: 모두 PASS.

- [ ] **Step 5: 변경 파일만 커밋**

```bash
git add src/config.js src/surface-placement.js src/ninja-game.js tests/surface-placement.test.mjs tests/ninja-game.test.mjs
git commit -m "feat: place ninja away from detected surfaces"
```

### Task 2: XRAnchor 생성, 추적, fallback 생명주기

**Files:**
- Modify: `src/ninja-game.js`
- Modify: `tests/ninja-game.test.mjs`

**Interfaces:**
- Consumes: `update(time, frame, surface)`의 활성 `XRFrame`, `getLocalSpace()`, 생성자 주입 `makeRigidTransform(position)`
- Produces: target의 `anchorState: 'anchor-pending'|'anchor'|'anchor-lost'|'local'`, `getAnchorState() → string`

- [ ] **Step 1: anchor 성공·fallback·일시 손실 실패 테스트 작성**

테스트 harness의 Ninja object에 `matrixAutoUpdate`, `matrix.fromArray()`, `matrixWorldNeedsUpdate`를 추가하고 `getSession`, `getLocalSpace`, `getViewerPose`를 주입 가능하게 만든다.

```js
test('creates an anchor from the final local pose on the next active frame', async () => {
  const created = { anchorSpace: {} };
  const frame = {
    createAnchor(transform, space) {
      assert.deepEqual([transform.position.x, transform.position.y, transform.position.z], [0, 0.02, -2]);
      assert.equal(space, localSpace);
      return Promise.resolve(created);
    },
    getPose() { return { transform: { matrix: ANCHOR_MATRIX } }; },
  };
  hideTarget(game, mapper);
  game.update(1001, frame, null);
  await Promise.resolve();
  game.update(1002, frame, null);
  assert.equal(game.getAnchorState(), 'anchor');
  assert.deepEqual(game.getTargetPosition(), [1, 2, 3]);
});

test('falls back to local when createAnchor is unavailable or rejects', async () => {
  hideTarget(game, mapper);
  game.update(1001, {}, null);
  assert.equal(game.getAnchorState(), 'local');

  hideTarget(game, mapper);
  game.update(1002, { createAnchor: () => Promise.reject(new Error('unsupported')) }, null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(game.getAnchorState(), 'local');
});

test('keeps the last anchor pose during temporary tracking loss and recovers', async () => {
  const frame = makeAnchorFrame([ANCHOR_POSE, null, RECOVERED_POSE]);
  await createTargetAnchor(game, mapper, frame);
  game.update(1002, frame, null);
  assert.equal(game.getAnchorState(), 'anchor-lost');
  assert.deepEqual(game.getTargetPosition(), [1, 2, 3]);
  game.update(1003, frame, null);
  assert.equal(game.getAnchorState(), 'anchor');
  assert.deepEqual(game.getTargetPosition(), [4, 5, 6]);
});
```

```js
test('deletes an anchor that resolves after the target was replaced', async () => {
  const deferred = Promise.withResolvers();
  const staleAnchor = { deleted: false, delete() { this.deleted = true; } };
  hideTarget(game, mapper);
  game.update(1001, { createAnchor: () => deferred.promise }, null);
  game.clearTarget();
  deferred.resolve(staleAnchor);
  await deferred.promise;
  await Promise.resolve();
  assert.equal(staleAnchor.deleted, true);
});

test('deletes the current anchor when the session ends', async () => {
  const anchor = await createTargetAnchor(game, mapper, frame);
  game.endSession();
  assert.equal(anchor.deleted, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/ninja-game.test.mjs`

Expected: `getAnchorState is not a function` 또는 anchor가 생성되지 않아 FAIL.

- [ ] **Step 3: 최소 anchor 상태머신 구현**

```js
beginAnchorCreation(frame) {
  const target = this.target;
  const localSpace = this.getLocalSpace();
  if (!target || target.anchorState !== 'anchor-pending' || target.anchorPromise) return;
  if (!localSpace || typeof frame?.createAnchor !== 'function') {
    target.anchorState = 'local';
    return;
  }
  const [x, y, z] = target.position;
  const token = target.token;
  target.anchorPromise = frame.createAnchor(this.makeRigidTransform({ x, y, z }), localSpace)
    .then((anchor) => {
      if (this.target !== target || this.target.token !== token) {
        anchor.delete?.();
        return;
      }
      target.anchor = anchor;
      target.anchorState = 'anchor';
      target.object.matrixAutoUpdate = false;
    })
    .catch(() => {
      if (this.target === target) target.anchorState = 'local';
    });
}
```

`updateTargetAnchor(frame)`는 pending 생성 후 anchor pose를 읽는다. pose가 없으면 마지막 위치를 유지하고 `anchor-lost`, 있으면 행렬과 translation을 object/target에 함께 반영하고 `anchor`로 복구한다. `clearTarget()`은 token을 무효화하고 anchor를 삭제한다.

- [ ] **Step 4: anchor 회귀 테스트 통과 확인**

Run: `node --test tests/ninja-game.test.mjs`

Expected: 성공, 미지원, reject, stale Promise, 일시 손실, 복구, 정리 테스트 모두 PASS.

- [ ] **Step 5: 변경 파일만 커밋**

```bash
git add src/ninja-game.js tests/ninja-game.test.mjs
git commit -m "feat: anchor ninja during active XR frames"
```

### Task 3: XRFrame 단위 CPU depth 공유

**Files:**
- Create: `src/cpu-depth-frame-source.js`
- Create: `tests/cpu-depth-frame-source.test.mjs`

**Interfaces:**
- Consumes: `read(frame, referenceSpace)`
- Produces: `{ frame, viewerPose, views: [{ view, depthInformation }], usage, format }`; 실패 시 `viewerPose: null`, `views: []`

- [ ] **Step 1: 같은 frame 캐시와 오류 격리 실패 테스트 작성**

```js
test('reads each view depth once when two consumers share an XRFrame', () => {
  let poseCalls = 0;
  let depthCalls = 0;
  const view = { eye: 'none' };
  const frame = {
    getViewerPose() { poseCalls += 1; return { views: [view] }; },
    getDepthInformation() { depthCalls += 1; return { width: 4, height: 4 }; },
  };
  const source = new CpuDepthFrameSource({ getSession: () => session });
  const first = source.read(frame, {});
  const second = source.read(frame, {});
  assert.equal(first, second);
  assert.equal(poseCalls, 1);
  assert.equal(depthCalls, 1);
});

test('reads a fresh snapshot for a new XRFrame', () => {
  source.read(firstFrame, space);
  source.read(secondFrame, space);
  assert.equal(depthCalls, 2);
});

test('isolates depth exceptions and returns the successful views', () => {
  const snapshot = source.read(frameWithOneFailingView, space);
  assert.equal(snapshot.views.length, 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/cpu-depth-frame-source.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 frame source 구현**

```js
export class CpuDepthFrameSource {
  constructor({ getSession = () => null } = {}) {
    this.getSession = getSession;
    this.cachedFrame = null;
    this.snapshot = null;
  }

  read(frame, referenceSpace) {
    if (frame === this.cachedFrame) return this.snapshot;
    const session = this.getSession();
    const snapshot = {
      frame,
      viewerPose: null,
      views: [],
      usage: session?.depthUsage ?? null,
      format: session?.depthDataFormat ?? null,
    };
    this.cachedFrame = frame;
    this.snapshot = snapshot;
    if (!frame || !referenceSpace || typeof frame.getDepthInformation !== 'function') return snapshot;
    try { snapshot.viewerPose = frame.getViewerPose(referenceSpace); } catch { return snapshot; }
    for (const view of snapshot.viewerPose?.views ?? []) {
      try {
        const depthInformation = frame.getDepthInformation(view);
        if (depthInformation) snapshot.views.push({ view, depthInformation });
      } catch { /* keep other views usable */ }
    }
    return snapshot;
  }

  reset() { this.cachedFrame = null; this.snapshot = null; }
}
```

- [ ] **Step 4: source 테스트 통과 확인**

Run: `node --test tests/cpu-depth-frame-source.test.mjs`

Expected: 모두 PASS.

- [ ] **Step 5: 변경 파일만 커밋**

```bash
git add src/cpu-depth-frame-source.js tests/cpu-depth-frame-source.test.mjs
git commit -m "feat: share CPU depth snapshots per XR frame"
```

### Task 4: 오클루전과 복셀 소비자를 공유 source로 전환

**Files:**
- Create: `src/depth-update-policy.js`
- Modify: `src/cpu-depth-occluder.js`
- Modify: `src/depth-cloud.js`
- Create: `tests/depth-update-policy.test.mjs`

**Interfaces:**
- Consumes: 생성자 `{ scene, depthSource }`, `depthSource.read(frame, referenceSpace)` snapshot
- Produces: 기존 `update(frame, referenceSpace, time)`, `getTriangleCount()`, `getCount()`, `reset()` API 유지; 순수 함수 `isDepthUpdateDue(last, now, gap)`, `isDepthStale(lastDepth, now, stale)`, `shouldUpdatePointGeometry(renderPoints)`

- [ ] **Step 1: 공유 호출, 독립 throttle, 숨은 geometry의 실패 테스트 작성**

```js
test('each depth consumer can keep an independent update interval', () => {
  assert.equal(isDepthUpdateDue(0, 65, 66), false);
  assert.equal(isDepthUpdateDue(0, 66, 66), true);
  assert.equal(isDepthUpdateDue(0, 199, 200), false);
  assert.equal(isDepthUpdateDue(0, 200, 200), true);
});

test('marks an occlusion mesh stale only after the configured age', () => {
  assert.equal(isDepthStale(100, 350, 250), false);
  assert.equal(isDepthStale(100, 351, 250), true);
});

test('updates raw point geometry only when point rendering is enabled', () => {
  assert.equal(shouldUpdatePointGeometry(false), false);
  assert.equal(shouldUpdatePointGeometry(true), true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/depth-update-policy.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` for `src/depth-update-policy.js`.

- [ ] **Step 3: 두 소비자를 snapshot 기반으로 최소 변경**

```js
const snapshot = this.depthSource.read(frame, referenceSpace);
for (const { view, depthInformation } of snapshot.views) {
  this.sampleView(depthInformation, view);
  // 기존 reusable TypedArray와 BufferAttribute를 그대로 갱신
}
```

두 클래스가 source를 받지 않은 기존 호출에도 동작하도록 기본 `CpuDepthFrameSource`를 내부 생성하되, `main.js`에서는 반드시 같은 instance를 주입한다. `DepthCloud.update()`의 geometry attribute, draw range, bounding sphere 갱신은 `renderPoints === true`일 때만 수행한다. `reset()`은 소비자 상태만 초기화하고 공유 source reset은 조립부가 세션 단위로 한 번 수행한다.

- [ ] **Step 4: 소비자 테스트와 기존 depth 수학 테스트 통과 확인**

Run: `node --test tests/depth-update-policy.test.mjs tests/depth-cloud.test.mjs tests/cpu-occlusion-math.test.mjs`

Expected: 모두 PASS.

- [ ] **Step 5: 변경 파일만 커밋**

```bash
git add src/depth-update-policy.js src/cpu-depth-occluder.js src/depth-cloud.js tests/depth-update-policy.test.mjs
git commit -m "refactor: share depth feed across CPU consumers"
```

### Task 5: CPU 통합 모드, HUD, 운영자 상태 연결

**Files:**
- Modify: `src/app-mode.js`
- Modify: `src/main.js`
- Modify: `src/ui.js`
- Modify: `index.html`
- Modify: `tests/app-mode.test.mjs`
- Modify: `tests/ui.test.mjs`
- Modify: `tests/static-site.test.mjs`

**Interfaces:**
- Consumes: `APP_MODE`, `game.getAnchorState()`, `voxelMap.getSolidCount()`, 공유 `CpuDepthFrameSource`
- Produces: `usesSpaceMapping(mode)`, `formatAnchorStatus(state)`, 통합 `formatMetrics({ voxelCount, anchorState, ... })`, `ui.setOperatorStatus(text)`

- [ ] **Step 1: 모드와 표시의 실패 테스트 작성**

```js
test('CPU occlusion is also a space mapping mode while GPU is not', () => {
  assert.equal(usesSpaceMapping(APP_MODES.CPU_OCCLUSION), true);
  assert.equal(usesSpaceMapping(APP_MODES.CLOUD), true);
  assert.equal(usesSpaceMapping(APP_MODES.GPU_OCCLUSION), false);
});

test('CPU HUD includes triangles, voxels, depth diagnostics, and anchor state', () => {
  const text = formatMetrics({ ...BASE_METRICS,
    occlusionMode: 'cpu', occlusionTriangles: 9322, voxelCount: 321,
    depthUsage: 'cpu-optimized', depthDataFormat: 'float32', anchorState: 'anchor',
  });
  assert.match(text, /가림 CPU · 삼각형 9322 · 복셀 321/);
  assert.match(text, /depth usage cpu-optimized/);
  assert.match(text, /depth format float32/);
  assert.match(text, /고정 anchor/);
});

test('formats pending, lost, local, and empty anchor states', () => {
  assert.equal(formatAnchorStatus('anchor-pending'), '고정 anchor 준비');
  assert.equal(formatAnchorStatus('anchor-lost'), '고정 anchor (추적 일시 손실)');
  assert.equal(formatAnchorStatus('local'), '고정 local');
  assert.equal(formatAnchorStatus(null), '고정 -');
});
```

DOM test는 `#operatorStatus`가 존재하고 `setOperatorStatus()`가 textContent를 바꾸는 실제 결과를 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/app-mode.test.mjs tests/ui.test.mjs tests/static-site.test.mjs`

Expected: 새 export와 DOM element가 없어 FAIL.

- [ ] **Step 3: 통합 조립과 UI 최소 구현**

```js
export function usesSpaceMapping(mode) {
  return mode === APP_MODES.CPU_OCCLUSION || mode === APP_MODES.CLOUD;
}

export function formatAnchorStatus(state) {
  return ({
    'anchor-pending': '고정 anchor 준비',
    anchor: '고정 anchor',
    'anchor-lost': '고정 anchor (추적 일시 손실)',
    local: '고정 local',
  })[state] ?? '고정 -';
}
```

`main.js`는 CPU 또는 cloud일 때 `VoxelMap`, `PlayerTrail`, `DepthCloud({ renderPoints:false, depthSource })`, `OperatorView`를 만든다. CPU일 때만 같은 source를 받은 `CpuDepthOccluder`도 만든다. render loop 순서는 `xrSession.update(frame)`로 viewer pose를 얻고, `game.update()`로 anchor를 갱신하고, 각 depth 소비자를 갱신한 후 통계와 화면을 렌더한다. 운영자 overlay가 닫혀도 `DepthCloud.update`, `PlayerTrail.record`, `game.update`는 계속 호출한다.

`index.html`의 operator overlay에 다음 상태 영역을 추가한다.

```html
<div id="operatorStatus" class="card" style="z-index:21;">고정 -</div>
```

HUD에는 `voxelMap?.getSolidCount() ?? 0`과 `game.getAnchorState()`를 넘긴다. 운영자 상태에는 같은 anchor 문자열, voxel 수, Ninja·player 좌표를 표시한다.

- [ ] **Step 4: 통합 관련 테스트와 전체 테스트 통과 확인**

Run: `node --test tests/*.test.mjs`

Expected: 전체 PASS. 실제 테스트 개수를 출력에서 기록한다.

- [ ] **Step 5: 변경 파일만 커밋**

```bash
git add src/app-mode.js src/main.js src/ui.js index.html tests/app-mode.test.mjs tests/ui.test.mjs tests/static-site.test.mjs
git commit -m "feat: combine CPU occlusion with operator mapping"
```

### Task 6: README, 전체 검증, cj_develop 배포

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-25-anchor-shared-cpu-depth.md`

**Interfaces:**
- Consumes: 실제 구현 파일명, 실제 자동 테스트 통과 개수, 실제 URL 모드 동작
- Produces: 발표 자료로 옮길 수 있는 한국어 기술 설명과 정확한 실기기 체크리스트

- [ ] **Step 1: README를 실제 결과에 맞게 갱신**

다음 내용을 별도 소제목과 표로 설명한다.

- 복셀 지도만으로 Ninja가 고정되지 않는 이유
- local-space와 XRAnchor의 차이 및 `고정 anchor`/`고정 local` 의미
- 한 CPU depth snapshot을 오클루전 15 Hz와 지도 5 Hz에서 공유하는 구조
- 최신 depth 기반 실시간 가림과 과거 관측을 누적하는 지도의 차이
- Persistent/Cloud Anchor가 앱 종료 후 복원에 필요한 이유
- 기본 GPU, `?occlusion=cpu`, `?depth=cloud` 호환 표
- Galaxy S26 Ultra 실기기 검증 순서와 아직 확인되지 않은 제한
- 실제 코드 구조와 전체 테스트 개수

- [ ] **Step 2: 모든 JavaScript 구문 검사**

Run:

```powershell
$files = rg --files -g '*.js' -g '*.mjs'
foreach ($file in $files) { node --check $file }
```

Expected: exit code `0`, syntax error 없음.

- [ ] **Step 3: 전체 자동 테스트 재실행**

Run: `node --test tests/*.test.mjs`

Expected: 모든 테스트 PASS, fail `0`. 출력의 실제 test 개수가 README와 일치해야 한다.

- [ ] **Step 4: 변경 범위와 사용자 사진 제외 검증**

Run:

```powershell
git branch --show-current
git status --short
git diff --check
git diff --name-only
git diff --cached --name-only
```

Expected: branch는 `cj_develop`; `img/` 파일은 수정·staged 목록에 없음; `main` 변경 없음.

- [ ] **Step 5: README와 계획 체크 상태 커밋**

```bash
git add README.md docs/superpowers/plans/2026-08-25-anchor-shared-cpu-depth.md
git commit -m "docs: explain anchored CPU depth pipeline"
```

- [ ] **Step 6: `origin/cj_develop` push**

Run: `git push origin cj_develop`

Expected: 새 HEAD가 `origin/cj_develop`에 반영됨. `main`에는 push하지 않는다.

- [ ] **Step 7: GitHub Pages build 확인**

GitHub Actions/Pages의 최신 workflow run이 pushed commit SHA를 대상으로 `completed/success`인지 확인한다. workflow가 Pages를 다른 branch에서만 배포한다면 변경하지 말고 그 제약을 보고한다.

- [ ] **Step 8: 실기기 미검증 항목을 명확히 인계**

최종 보고에는 자동 검증 결과와 Galaxy S26 Ultra에서 사용자가 확인할 7개 완료 조건을 분리한다. 실기기에서 직접 실행하지 않은 anchor 안정성이나 손 가림 품질은 완료로 표시하지 않는다.
