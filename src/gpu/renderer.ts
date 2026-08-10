/**
 * Renderer.
 *
 * Two backends, one contract. WebGPU is preferred because it can configure the
 * canvas as rgba16float in Display-P3 with extended-range tone mapping, which is
 * the deepest signal a browser will actually put on a wire. WebGL2 is the
 * fallback and attempts the same through `drawingBufferStorage`, then settles
 * for 8-bit if the browser will not grant it.
 *
 * Neither backend ever sees an address in full. In seeded mode the shader
 * derives each pixel from its own index; in address mode it reads a texture the
 * caller uploaded. Drawing a 4K frame costs one triangle.
 */

import type { ArchiveFormat } from '../core/format';
import type { Seed } from '../core/philox';
import { DEFAULT_FOV } from '../core/sphere';
import { PATCH_PIXELS, type TailPatch } from '../core/offset';
import { GLSL_FRAG, GLSL_VERT, WGSL } from './shaders';

export interface ViewState {
  /** Plane geometry: pan, in image pixels, of the point under the viewport centre. */
  x: number;
  y: number;
  /** Plane geometry: screen pixels per image pixel. */
  zoom: number;
  /** Sphere geometry: where the head is turned, and how wide the view is. */
  yaw: number;
  pitch: number;
  fov: number;
}

export const FLAT_VIEW: ViewState = { x: 0, y: 0, zoom: 1, yaw: 0, pitch: 0, fov: DEFAULT_FOV };

export interface RenderInput {
  format: ArchiveFormat;
  mode: 'seed' | 'address';
  seed: Seed;
  /** Tail of the address once an offset is applied; null when sitting on the seed. */
  patch?: TailPatch | null;
}

export interface ProbeOptions {
  /** Render through the sphere projection from this heading instead of flat. */
  look?: { yaw: number; pitch: number; fov: number };
  /** Top-left image pixel to read back. Defaults to the origin. */
  at?: { x: number; y: number };
  /** Include the tail patch. Off by default so the generator is checked bare. */
  withPatch?: boolean;
}

export interface Capabilities {
  backend: 'WebGPU' | 'WebGL2';
  canvasFormat: string;
  colorSpace: string;
  hdr: boolean;
  /** Bits per channel the presentation surface itself carries. */
  outputBits: number;
  /** Largest texture axis this backend will allocate — the ceiling on address mode. */
  maxTextureDimension: number;
}

export interface Renderer {
  readonly capabilities: Capabilities;
  resize(widthPx: number, heightPx: number): void;
  /** Upload RGBA16 pixel data for address mode, or null to release it. */
  setAddressTexture(width: number, height: number, rgba16: Uint16Array | null): void;
  /**
   * Replace a horizontal band of the address texture.
   *
   * Stepping an address by one changes a single byte, and re-uploading sixty-six
   * megabytes to repaint it is what made stepping feel sluggish. This uploads
   * only the rows that moved.
   */
  updateAddressRows(y0: number, rows: number, rgba16: Uint16Array): void;
  draw(input: RenderInput, view: ViewState): void;
  /**
   * Reads PROBE x PROBE pixels back off the GPU as RGB triples, row-major, top
   * down, 8 bits per channel.
   *
   * Without `look` it renders the top-left image pixels at 1:1 in plane
   * geometry — even for a sphere format — which is what checks the generator.
   * With `look` it renders through the sphere projection instead, which is what
   * checks the projection.
   */
  probe(input: RenderInput, options?: ProbeOptions): Promise<Uint8Array>;
  dispose(): void;
}

// 64 for the original block, 16 for patchInfo, 192 for twelve patched pixels.
const UNIFORM_BYTES = 272;
export const PROBE = 8;

/**
 * Geometry rides in the mode word and the three float slots that were already
 * reserved and unused, so the uniform block keeps its size and its layout.
 *
 * `sphere` is passed explicitly rather than read off the format: the plane probe
 * has to be able to force it false while checking a sphere format, or the
 * generator self-check compares fragments against the wrong pixels and reports a
 * divergence that is not there.
 */
function fillUniforms(
  f32: Float32Array,
  u32: Uint32Array,
  input: RenderInput,
  view: ViewState,
  viewW: number,
  viewH: number,
  sphere: boolean,
): void {
  f32[0] = input.format.resolution.width;
  f32[1] = input.format.resolution.height;
  f32[2] = viewW;
  f32[3] = viewH;
  f32[4] = view.x;
  f32[5] = view.y;
  f32[6] = view.zoom;
  f32[7] = view.fov;
  u32[8] = input.seed[0];
  u32[9] = input.seed[1];
  u32[10] = input.seed[2];
  u32[11] = input.seed[3];
  f32[12] = input.format.depth.maxChannel;
  f32[13] = (sphere ? 2 : 0) + (input.mode === 'address' ? 1 : 0);
  f32[14] = view.yaw;
  f32[15] = view.pitch;

  const patch = input.patch ?? null;
  u32[16] = patch ? patch.firstPixel : 0;
  u32[17] = patch ? patch.count : 0;
  u32[18] = 0;
  u32[19] = 0;
  if (patch) u32.set(patch.values.subarray(0, PATCH_PIXELS * 4), 20);
  else u32.fill(0, 20, 20 + PATCH_PIXELS * 4);
}

const isSphere = (input: RenderInput): boolean =>
  input.format.resolution.geometry === 'sphere';

// ---------------------------------------------------------------------------
// WebGPU
// ---------------------------------------------------------------------------

async function createWebGPU(canvas: HTMLCanvasElement): Promise<Renderer | null> {
  if (!('gpu' in navigator) || !navigator.gpu) return null;

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!adapter) return null;

  // Default device limits cap textures at 8192, which would refuse an 8K
  // address texture. Ask for whatever this adapter actually supports.
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  }).catch(() => adapter.requestDevice());
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;

  // Try for the deepest surface the browser will give us, then walk down.
  const attempts: Array<{ format: GPUTextureFormat; colorSpace: PredefinedColorSpace; hdr: boolean }> = [
    { format: 'rgba16float', colorSpace: 'display-p3', hdr: true },
    { format: 'rgba16float', colorSpace: 'srgb', hdr: false },
    { format: navigator.gpu.getPreferredCanvasFormat(), colorSpace: 'display-p3', hdr: false },
    { format: navigator.gpu.getPreferredCanvasFormat(), colorSpace: 'srgb', hdr: false },
  ];

  let chosen: (typeof attempts)[number] | null = null;
  for (const attempt of attempts) {
    try {
      const config: GPUCanvasConfiguration & { toneMapping?: { mode: string } } = {
        device,
        format: attempt.format,
        colorSpace: attempt.colorSpace,
        alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      };
      if (attempt.hdr) config.toneMapping = { mode: 'extended' };
      ctx.configure(config as GPUCanvasConfiguration);
      chosen = attempt;
      break;
    } catch {
      /* try the next rung down */
    }
  }
  if (!chosen) return null;

  const module = device.createShaderModule({ code: WGSL, label: 'archive' });
  const pipeline = device.createRenderPipeline({
    label: 'archive',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: chosen.format }] },
    primitive: { topology: 'triangle-list' },
  });

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const scratch = new ArrayBuffer(UNIFORM_BYTES);
  const scratchF32 = new Float32Array(scratch);
  const scratchU32 = new Uint32Array(scratch);

  let addressTexture: GPUTexture = device.createTexture({
    size: [1, 1],
    format: 'rgba16uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let addressWidth = 0;
  let bindGroup = makeBindGroup();

  function makeBindGroup(): GPUBindGroup {
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: addressTexture.createView() },
      ],
    });
  }

  let viewW = canvas.width || 1;
  let viewH = canvas.height || 1;

  return {
    capabilities: {
      backend: 'WebGPU',
      canvasFormat: chosen.format,
      colorSpace: chosen.colorSpace,
      hdr: chosen.hdr,
      outputBits: chosen.format === 'rgba16float' ? 16 : 8,
      maxTextureDimension: device.limits.maxTextureDimension2D,
    },
    resize(w, h) {
      viewW = Math.max(1, w);
      viewH = Math.max(1, h);
      canvas.width = viewW;
      canvas.height = viewH;
    },
    setAddressTexture(width, height, rgba16) {
      addressTexture.destroy();
      addressWidth = rgba16 ? width : 0;
      if (!rgba16) {
        addressTexture = device.createTexture({
          size: [1, 1],
          format: 'rgba16uint',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      } else {
        addressTexture = device.createTexture({
          size: [width, height],
          format: 'rgba16uint',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        device.queue.writeTexture(
          { texture: addressTexture },
          rgba16 as unknown as GPUAllowSharedBufferSource,
          { bytesPerRow: width * 8, rowsPerImage: height },
          { width, height },
        );
      }
      bindGroup = makeBindGroup();
    },
    updateAddressRows(y0, rows, rgba16) {
      if (!addressWidth) return;
      device.queue.writeTexture(
        { texture: addressTexture, origin: { x: 0, y: y0, z: 0 } },
        rgba16 as unknown as GPUAllowSharedBufferSource,
        { bytesPerRow: addressWidth * 8, rowsPerImage: rows },
        { width: addressWidth, height: rows },
      );
    },
    draw(input, view) {
      fillUniforms(scratchF32, scratchU32, input, view, viewW, viewH, isSphere(input));
      device.queue.writeBuffer(uniformBuffer, 0, scratch);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
    async probe(input, options) {
      const look = options?.look;
      const at = options?.at;
      // A second pipeline, because the offscreen target's format need not match
      // the canvas's.
      const probePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
      const target = device.createTexture({
        size: [PROBE, PROBE],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      // copyTextureToBuffer requires bytesPerRow to be a multiple of 256.
      const bytesPerRow = 256;
      const readback = device.createBuffer({
        size: bytesPerRow * PROBE,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      fillUniforms(
        scratchF32,
        scratchU32,
        // By default the probe checks the bare generator, so the patch is off.
        options?.withPatch ? input : { ...input, patch: null },
        look
          ? { ...FLAT_VIEW, ...look }
          : { ...FLAT_VIEW, x: (at?.x ?? 0) + PROBE / 2, y: (at?.y ?? 0) + PROBE / 2, zoom: 1 },
        PROBE,
        PROBE,
        look !== undefined,
      );
      device.queue.writeBuffer(uniformBuffer, 0, scratch);

      const group = device.createBindGroup({
        layout: probePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: addressTexture.createView() },
        ],
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      pass.setPipeline(probePipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, {
        width: PROBE,
        height: PROBE,
      });
      device.queue.submit([encoder.finish()]);

      await readback.mapAsync(GPUMapMode.READ);
      const src = new Uint8Array(readback.getMappedRange());
      // WebGPU render targets are top-down, so readback row r is image row r.
      const out = new Uint8Array(PROBE * PROBE * 3);
      for (let y = 0; y < PROBE; y++) {
        for (let x = 0; x < PROBE; x++) {
          const s = y * bytesPerRow + x * 4;
          const d = (y * PROBE + x) * 3;
          out[d] = src[s];
          out[d + 1] = src[s + 1];
          out[d + 2] = src[s + 2];
        }
      }
      readback.unmap();
      readback.destroy();
      target.destroy();

      // Restore the canvas-sized uniforms for the next real frame.
      fillUniforms(scratchF32, scratchU32, input, FLAT_VIEW, viewW, viewH, isSphere(input));
      return out;
    },
    dispose() {
      addressTexture.destroy();
      uniformBuffer.destroy();
      device.destroy();
    },
  };
}

// ---------------------------------------------------------------------------
// WebGL2
// ---------------------------------------------------------------------------

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function createWebGL2(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', {
    // Chrome refuses drawingBufferStorage on an alpha-less drawing buffer, and
    // that call is the only way to a 16-bit surface here. The shader always
    // writes alpha 1, so an alpha channel costs nothing.
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  let outputBits = 8;
  let colorSpace = 'srgb';
  let hdr = false;

  const glAny = gl as WebGL2RenderingContext & {
    drawingBufferStorage?: (format: number, w: number, h: number) => void;
    drawingBufferColorSpace?: string;
  };

  if (gl.getExtension('EXT_color_buffer_float') && typeof glAny.drawingBufferStorage === 'function') {
    try {
      while (gl.getError() !== gl.NO_ERROR) {
        /* drain, so the check below reflects only this call */
      }
      glAny.drawingBufferStorage(gl.RGBA16F, canvas.width || 1, canvas.height || 1);
      // The call reports failure through the error queue rather than by throwing,
      // so without this the pipeline would advertise a depth it does not have.
      if (gl.getError() === gl.NO_ERROR) {
        outputBits = 16;
        hdr = true;
      }
    } catch {
      /* stay on 8-bit */
    }
  }
  try {
    if ('drawingBufferColorSpace' in glAny) {
      glAny.drawingBufferColorSpace = 'display-p3';
      colorSpace = 'display-p3';
    }
  } catch {
    /* srgb it is */
  }

  const program = gl.createProgram()!;
  const vs = compile(gl, gl.VERTEX_SHADER, GLSL_VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, GLSL_FRAG);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const uniforms = {
    imageSize: gl.getUniformLocation(program, 'uImageSize'),
    viewSize: gl.getUniformLocation(program, 'uViewSize'),
    view: gl.getUniformLocation(program, 'uView'),
    seed: gl.getUniformLocation(program, 'uSeed'),
    params: gl.getUniformLocation(program, 'uParams'),
    patchInfo: gl.getUniformLocation(program, 'uPatchInfo'),
    patch: gl.getUniformLocation(program, 'uPatch[0]'),
    addrTex: gl.getUniformLocation(program, 'uAddrTex'),
  };
  const patchScratch = new Uint32Array(PATCH_PIXELS * 4);

  const vao = gl.createVertexArray();
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(4));

  let viewW = canvas.width || 1;
  let viewH = canvas.height || 1;
  let glAddressWidth = 0;

  return {
    capabilities: {
      backend: 'WebGL2',
      canvasFormat: outputBits === 16 ? 'rgba16f' : 'rgba8unorm',
      colorSpace,
      hdr,
      outputBits,
      maxTextureDimension: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    },
    resize(w, h) {
      viewW = Math.max(1, w);
      viewH = Math.max(1, h);
      canvas.width = viewW;
      canvas.height = viewH;
      if (outputBits === 16 && typeof glAny.drawingBufferStorage === 'function') {
        try {
          glAny.drawingBufferStorage(gl.RGBA16F, viewW, viewH);
        } catch {
          /* the drawing buffer keeps its previous storage */
        }
      }
      gl.viewport(0, 0, viewW, viewH);
    },
    updateAddressRows(y0, rows, rgba16) {
      if (!glAddressWidth) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, y0, glAddressWidth, rows,
        gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, rgba16,
      );
    },
    setAddressTexture(width, height, rgba16) {
      glAddressWidth = rgba16 ? width : 0;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (!rgba16) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, 1, 1, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, new Uint16Array(4));
      } else {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16UI, width, height, 0, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, rgba16);
      }
    },
    draw(input, view) {
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.viewport(0, 0, viewW, viewH);

      gl.uniform2f(uniforms.imageSize, input.format.resolution.width, input.format.resolution.height);
      gl.uniform2f(uniforms.viewSize, viewW, viewH);
      gl.uniform4f(uniforms.view, view.x, view.y, view.zoom, view.fov);
      gl.uniform4ui(uniforms.seed, input.seed[0], input.seed[1], input.seed[2], input.seed[3]);
      gl.uniform4f(
        uniforms.params,
        input.format.depth.maxChannel,
        (isSphere(input) ? 2 : 0) + (input.mode === 'address' ? 1 : 0),
        view.yaw,
        view.pitch,
      );
      const patch = input.patch ?? null;
      gl.uniform4ui(uniforms.patchInfo, patch ? patch.firstPixel : 0, patch ? patch.count : 0, 0, 0);
      if (patch) patchScratch.set(patch.values.subarray(0, PATCH_PIXELS * 4));
      else patchScratch.fill(0);
      gl.uniform4uiv(uniforms.patch, patchScratch);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.addrTex, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    async probe(input, options) {
      const look = options?.look;
      const at = options?.at;
      const fboTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, PROBE, PROBE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
      gl.viewport(0, 0, PROBE, PROBE);

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      const v = look
        ? { ...FLAT_VIEW, ...look }
        : { ...FLAT_VIEW, x: (at?.x ?? 0) + PROBE / 2, y: (at?.y ?? 0) + PROBE / 2, zoom: 1 };
      const probePatch = options?.withPatch ? (input.patch ?? null) : null;
      gl.uniform4ui(uniforms.patchInfo, probePatch ? probePatch.firstPixel : 0, probePatch ? probePatch.count : 0, 0, 0);
      if (probePatch) patchScratch.set(probePatch.values.subarray(0, PATCH_PIXELS * 4));
      else patchScratch.fill(0);
      gl.uniform4uiv(uniforms.patch, patchScratch);
      gl.uniform2f(uniforms.imageSize, input.format.resolution.width, input.format.resolution.height);
      gl.uniform2f(uniforms.viewSize, PROBE, PROBE);
      gl.uniform4f(uniforms.view, v.x, v.y, v.zoom, v.fov);
      gl.uniform4ui(uniforms.seed, input.seed[0], input.seed[1], input.seed[2], input.seed[3]);
      gl.uniform4f(
        uniforms.params,
        input.format.depth.maxChannel,
        (look ? 2 : 0) + (input.mode === 'address' ? 1 : 0),
        v.yaw,
        v.pitch,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.addrTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const raw = new Uint8Array(PROBE * PROBE * 4);
      gl.readPixels(0, 0, PROBE, PROBE, gl.RGBA, gl.UNSIGNED_BYTE, raw);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(fboTex);
      gl.viewport(0, 0, viewW, viewH);

      // readPixels returns rows bottom-up, so readback row r is image row PROBE-1-r.
      const out = new Uint8Array(PROBE * PROBE * 3);
      for (let r = 0; r < PROBE; r++) {
        const y = PROBE - 1 - r;
        for (let x = 0; x < PROBE; x++) {
          const s = (r * PROBE + x) * 4;
          const d = (y * PROBE + x) * 3;
          out[d] = raw[s];
          out[d + 1] = raw[s + 1];
          out[d + 2] = raw[s + 2];
        }
      }
      return out;
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  // ?backend=webgl2 forces the fallback. Kept in the shipping build: it is how
  // the WebGL2 path stays tested, and it is the first thing to try when a
  // driver makes WebGPU misbehave.
  const forced = new URLSearchParams(location.search).get('backend');

  if (forced !== 'webgl2') {
    const gpu = await createWebGPU(canvas).catch(() => null);
    if (gpu) return gpu;
  }
  const gl = createWebGL2(canvas);
  if (gl) return gl;
  throw new Error('This browser provides neither WebGPU nor WebGL2.');
}
