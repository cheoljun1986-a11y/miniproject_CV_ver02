function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || 'camera shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    precision highp float;
    out vec2 vUv;
    const vec2 points[3] = vec2[3](
      vec2(-1.0, -1.0),
      vec2(3.0, -1.0),
      vec2(-1.0, 3.0)
    );
    void main() {
      vec2 point = points[gl_VertexID];
      vUv = point * 0.5 + 0.5;
      gl_Position = vec4(point, 0.0, 1.0);
    }`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D cameraTexture;
    in vec2 vUv;
    out vec4 outColor;
    void main() {
      outColor = texture(cameraTexture, vec2(vUv.x, 1.0 - vUv.y));
    }`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) || 'camera program link failed';
    gl.deleteProgram(program);
    throw new Error(detail);
  }
  return program;
}

export function fitInferenceSize(cameraWidth, cameraHeight, maxDimension = 320) {
  const width = Number(cameraWidth);
  const height = Number(cameraHeight);
  if (!(width > 0) || !(height > 0) || !(maxDimension > 0)) {
    return { width: maxDimension, height: maxDimension };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export class CameraTextureCopier {
  constructor(gl, canvas, maxDimension = 320) {
    if (typeof gl.createVertexArray !== 'function') {
      throw new Error('WebGL2 is required for camera texture copying');
    }
    this.gl = gl;
    this.canvas = canvas;
    this.maxDimension = maxDimension;
    this.canvas.width = maxDimension;
    this.canvas.height = maxDimension;
    this.context2d = canvas.getContext('2d', { alpha: false });
    this.program = createProgram(gl);
    this.sampler = gl.getUniformLocation(this.program, 'cameraTexture');
    this.framebuffer = gl.createFramebuffer();
    this.outputTexture = gl.createTexture();
    this.pixels = new Uint8Array(maxDimension * maxDimension * 4);

    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, maxDimension, maxDimension, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture, 0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  copy(cameraTexture, camera = null) {
    const size = fitInferenceSize(
      camera?.width,
      camera?.height,
      this.maxDimension,
    );
    this.resize(size.width, size.height);
    const gl = this.gl;
    const previous = {
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport: gl.getParameter(gl.VIEWPORT),
      program: gl.getParameter(gl.CURRENT_PROGRAM),
      activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
      texture: gl.getParameter(gl.TEXTURE_BINDING_2D),
      blend: gl.isEnabled(gl.BLEND),
      depth: gl.isEnabled(gl.DEPTH_TEST),
      cull: gl.isEnabled(gl.CULL_FACE),
    };

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.uniform1i(this.sampler, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(
      0, 0, this.canvas.width, this.canvas.height,
      gl.RGBA, gl.UNSIGNED_BYTE, this.pixels,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, previous.framebuffer);
    gl.viewport(...previous.viewport);
    gl.useProgram(previous.program);
    gl.activeTexture(previous.activeTexture);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    this.restoreCapability(gl.BLEND, previous.blend);
    this.restoreCapability(gl.DEPTH_TEST, previous.depth);
    this.restoreCapability(gl.CULL_FACE, previous.cull);

    const image = this.context2d.createImageData(this.canvas.width, this.canvas.height);
    image.data.set(this.pixels);
    this.context2d.putImageData(image, 0, 0);
  }

  resize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    const gl = this.gl;
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    this.canvas.width = width;
    this.canvas.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, null,
    );
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
  }

  restoreCapability(capability, enabled) {
    if (enabled) this.gl.enable(capability);
    else this.gl.disable(capability);
  }

  dispose() {
    this.gl.deleteTexture(this.outputTexture);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteProgram(this.program);
  }
}
