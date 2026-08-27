import test from 'node:test';
import assert from 'node:assert/strict';

import { createUI } from '../src/ui.js';

function makeDocument() {
  const elements = new Map();
  return {
    elements,
    querySelector(selector) {
      if (!elements.has(selector)) {
        elements.set(selector, {
          style: {},
          textContent: '',
          disabled: false,
          classList: { toggle() {} },
          addEventListener() {},
        });
      }
      return elements.get(selector);
    },
  };
}

test('catch celebration UI shows and hides the logo overlay', () => {
  const documentRoot = makeDocument();
  const ui = createUI(documentRoot);

  ui.setCatchCelebrationVisible(true);
  assert.equal(
    documentRoot.elements.get('#catchCelebrationOverlay').style.display,
    'flex',
  );

  ui.setCatchCelebrationVisible(false);
  assert.equal(
    documentRoot.elements.get('#catchCelebrationOverlay').style.display,
    'none',
  );
});