// The smallest document the voxel debug panel can be built against. Enough to
// assert on button labels and click handlers; nothing here pretends to lay out
// or render.

class StubNode {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.attributes = {};
    this.handlers = new Map();
    this.textContent = '';
  }

  setAttribute(name, value) { this.attributes[name] = value; }

  appendChild(child) { this.children.push(child); return child; }

  append(...nodes) { this.children.push(...nodes); }

  remove() { this.removed = true; }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }

  // Test driver: fire whatever is registered for this event.
  emit(type, event = {}) {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }

  click() { this.emit('click'); }

  // Depth-first walk, so a test can find a button by its label.
  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }

  findByText(text) {
    for (const node of this.walk()) {
      if (typeof node.textContent === 'string' && node.textContent.startsWith(text)) return node;
    }
    return null;
  }
}

export function makeDocument() {
  return {
    createElement: (tag) => new StubNode(tag),
  };
}

// Installs the stub as the global `document` and returns a detached root plus
// a restore function.
export function installDocument() {
  const previous = globalThis.document;
  const doc = makeDocument();
  globalThis.document = doc;
  return {
    doc,
    root: new StubNode('div'),
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}
