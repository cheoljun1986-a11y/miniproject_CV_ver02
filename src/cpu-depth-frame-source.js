export class CpuDepthFrameSource {
  constructor({ getSession = () => null } = {}) {
    this.getSession = getSession;
    this.hasCachedFrame = false;
    this.cachedFrame = null;
    this.snapshot = null;
  }

  read(frame, referenceSpace) {
    if (this.hasCachedFrame && frame === this.cachedFrame) return this.snapshot;

    let usage = null;
    let format = null;
    try {
      const session = this.getSession();
      usage = session?.depthUsage ?? null;
      format = session?.depthDataFormat ?? null;
    } catch {
      // Optional depth-sensing getters can throw when the feature was denied.
    }
    const snapshot = {
      frame,
      viewerPose: null,
      views: [],
      usage,
      format,
    };
    this.hasCachedFrame = true;
    this.cachedFrame = frame;
    this.snapshot = snapshot;

    if (!frame || !referenceSpace || typeof frame.getDepthInformation !== 'function') {
      return snapshot;
    }

    try {
      snapshot.viewerPose = frame.getViewerPose(referenceSpace);
    } catch {
      return snapshot;
    }
    for (const view of snapshot.viewerPose?.views ?? []) {
      try {
        const depthInformation = frame.getDepthInformation(view);
        if (depthInformation) snapshot.views.push({ view, depthInformation });
      } catch {
        // A runtime can expose depth for one view but reject another.
      }
    }
    return snapshot;
  }

  reset() {
    this.hasCachedFrame = false;
    this.cachedFrame = null;
    this.snapshot = null;
  }
}
