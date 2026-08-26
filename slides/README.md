# 발표 자료 (slides/)

| 파일 | 내용 | 장수 |
|---|---|---|
| `AR-앵커-동작원리.pptx` | 지도 앵커가 무엇이고 어떻게 동작하는지. ARCore의 위치 추정 → 드리프트 → 보정 → 앵커의 역할까지 3D 그림으로 설명 | 15 |
| `도망모드-헛가림-순간이동-수정.pptx` | 2026-08-27 커밋 4개의 문제·원인·수정·원리·기대효과. 기대효과는 **미검증**으로 명시 | 20 |

두 자료 모두 **코드를 열지 않은 사람**을 대상으로 씁니다. 용어(pose, anchor, 드리프트,
좌표계 등)를 먼저 정의하고 그림으로 설명한 뒤 결론을 냅니다.

배경 서술은 `../chase-occlusion-anchor-notes.md`와 같은 내용을 다루며, 문서는 읽는 자료,
이 슬라이드는 설명하는 자료입니다.

## 다시 만들기

슬라이드는 손으로 그린 것이 아니라 스크립트가 생성합니다. 그림은 등각투영(isometric)
SVG로 그린 뒤 PNG로 래스터화해 넣습니다.

```
cd slides/generator
npm install pptxgenjs @resvg/resvg-js
node build.js ..          # 상위 폴더(slides/)에 pptx 두 개를 다시 씀
node preview.js           # 그림만 PNG로 뽑아 preview/ 에서 눈으로 확인
```

`node preview.js`를 먼저 돌려 그림을 확인하고 나서 `build.js`를 돌리는 편이 빠릅니다.

| 파일 | 역할 |
|---|---|
| `lib.js` | 등각투영, 3D 상자·방·가구·폰·하츄핑, 화살표·패널 같은 그리기 기본기 |
| `fig-anchor.js` | 앵커 자료의 그림 7장 |
| `fig-commits.js` | 커밋 자료의 그림 9장 |
| `build.js` | 그림을 PNG로 굽고 두 pptx를 조립 |
| `preview.js` | 그림만 빠르게 PNG로 확인 |

**주의: 이 폴더에는 npm 의존성이 필요합니다.** 저장소 루트는 의존성 없이
`node --test tests/*.test.mjs`만으로 도는 것이 원칙이고, 그 원칙은 그대로입니다 —
슬라이드 생성은 본 코드와 무관한 별도 도구라 이 폴더 안에서만 설치합니다.
`node_modules`와 `preview/`는 커밋하지 않습니다.

한글 렌더링은 Windows의 맑은 고딕을 사용합니다. 다른 OS에서 돌릴 때는 `build.js`와
`preview.js`의 `fontDirs` / `defaultFontFamily`를 그 환경의 한글 폰트로 바꿔야 합니다.
