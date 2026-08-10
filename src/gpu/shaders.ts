/**
 * Shader sources.
 *
 * Both backends run the same algorithm: a full-screen triangle whose fragment
 * shader either (a) evaluates Philox at the pixel's index, or (b) reads the
 * pixel out of an uploaded address texture. Everything is a pure function of
 * the pixel index, so there is no per-frame CPU work at all.
 */

export const WGSL = /* wgsl */ `
struct Uniforms {
  // xy = image size in pixels, zw = viewport size in pixels
  imageSize   : vec2<f32>,
  viewSize    : vec2<f32>,
  // xy = pan offset in image pixels, z = zoom, w = unused
  view        : vec4<f32>,
  seed        : vec4<u32>,
  // x = maxChannel, y = mode (0 = seeded, 1 = address texture), zw = yaw/pitch
  params      : vec4<f32>,
  // x = first patched pixel, y = how many are patched (0 = none)
  tailInfo    : vec4<u32>,
  // The tail of the address after an offset. Everything before it is still a
  // pure function of the pixel index, which is what lets an address be walked
  // without ever building one.
  tailPatch   : array<vec4<u32>, 128>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var addrTex : texture_2d<u32>;

const M0 : u32 = 0xd2511f53u;
const M1 : u32 = 0xcd9e8d57u;
const W0 : u32 = 0x9e3779b9u;
const W1 : u32 = 0xbb67ae85u;

fn mulhilo(a : u32, b : u32) -> vec2<u32> {
  let ah = a >> 16u;
  let al = a & 0xffffu;
  let bh = b >> 16u;
  let bl = b & 0xffffu;

  let albl = al * bl;
  let ahbl = ah * bl;
  let albh = al * bh;
  let ahbh = ah * bh;

  // mid = ahbl + albh + (albl >> 16), tracked across 32-bit overflow
  var carry : u32 = 0u;
  let m1 = ahbl + albh;
  if (m1 < ahbl) { carry = carry + 0x10000u; }
  let m2 = m1 + (albl >> 16u);
  if (m2 < m1) { carry = carry + 0x10000u; }

  let hi = ahbh + (m2 >> 16u) + carry;
  let lo = (m2 << 16u) | (albl & 0xffffu);
  return vec2<u32>(hi, lo);
}

fn philox(c0 : u32, c1 : u32, c2 : u32, c3 : u32, k0 : u32, k1 : u32) -> vec4<u32> {
  var x0 = c0; var x1 = c1; var x2 = c2; var x3 = c3;
  var key0 = k0; var key1 = k1;
  for (var r : i32 = 0; r < 10; r = r + 1) {
    let p0 = mulhilo(M0, x0);
    let p1 = mulhilo(M1, x2);
    let n0 = p1.x ^ x1 ^ key0;
    let n1 = p1.y;
    let n2 = p0.x ^ x3 ^ key1;
    let n3 = p0.y;
    x0 = n0; x1 = n1; x2 = n2; x3 = n3;
    if (r < 9) {
      key0 = key0 + W0;
      key1 = key1 + W1;
    }
  }
  return vec4<u32>(x0, x1, x2, x3);
}

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> VSOut {
  // one oversized triangle covering the viewport
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  var out : VSOut;
  let xy = p[vi];
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return out;
}

fn fetch(px : vec2<i32>, mode : f32, maxChannel : f32) -> vec3<f32> {
  let index = u32(px.y) * u32(u.imageSize.x) + u32(px.x);

  // The offset's tail, above the branch: it overrides whichever base is in
  // play, so a generated address and a loaded one step by the same mechanism.
  if (u.tailInfo.y > 0u && index >= u.tailInfo.x) {
    let p = u.tailPatch[index - u.tailInfo.x];
    return vec3<f32>(f32(p.x), f32(p.y), f32(p.z)) / maxChannel;
  }

  if (mode < 0.5) {
    let words = philox(index, 0u, u.seed.z, u.seed.w, u.seed.x, u.seed.y);
    let mask = u32(maxChannel);
    return vec3<f32>(
      f32(words.x & mask),
      f32(words.y & mask),
      f32(words.z & mask)
    ) / maxChannel;
  }
  let texel = textureLoad(addrTex, px, 0);
  return vec3<f32>(f32(texel.x), f32(texel.y), f32(texel.z)) / maxChannel;
}

// Equirectangular texel fetch. Longitude wraps arithmetically because
// textureLoad ignores sampler addressing — without this a black hairline runs
// down lon = ±pi, invisible against noise and glaring in a real 360 viewer.
fn fetchSphere(xi : i32, yi : i32, mode : f32, maxChannel : f32) -> vec3<f32> {
  let w = i32(u.imageSize.x);
  let h = i32(u.imageSize.y);
  let x = ((xi % w) + w) % w;
  let y = clamp(yi, 0, h - 1);
  return fetch(vec2<i32>(x, y), mode, maxChannel);
}

// The direction a screen position looks in. Transcribed from src/core/sphere.ts;
// probeSphere() checks the two against each other at startup.
fn lookDirection(ndc : vec2<f32>, aspect : f32) -> vec3<f32> {
  let fov = u.view.w;
  let yaw = u.params.z;
  let pitch = u.params.w;

  let tanHalf = tan(fov * 0.5);
  let d = normalize(vec3<f32>(ndc.x * aspect * tanHalf, ndc.y * tanHalf, 1.0));

  let cp = cos(pitch);
  let sp = sin(pitch);
  let y1 = d.y * cp + d.z * sp;
  let z1 = -d.y * sp + d.z * cp;

  let cy = cos(yaw);
  let sy = sin(yaw);
  return vec3<f32>(d.x * cy + z1 * sy, y1, -d.x * sy + z1 * cy);
}

fn renderSphere(uv : vec2<f32>, mode : f32, maxChannel : f32) -> vec3<f32> {
  let aspect = u.viewSize.x / u.viewSize.y;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let dir = lookDirection(ndc, aspect);

  let lon = atan2(dir.x, dir.z);
  let lat = asin(clamp(dir.y, -1.0, 1.0));

  let fx = (lon + 3.14159265358979) / 6.28318530717959 * u.imageSize.x;
  let fy = (1.57079632679490 - lat) / 3.14159265358979 * u.imageSize.y;

  // A screen pixel subtends fov/viewH radians. In latitude that is a fixed
  // number of rows; in longitude it widens as 1/cos(lat) and diverges at the
  // poles, so the two axes need separate tap counts and the wide one needs a
  // cap. Analytic rather than dpdx/dpdy, which explode across the seam.
  let radPerPixel = u.view.w / u.viewSize.y;
  let rows = radPerPixel / 3.14159265358979 * u.imageSize.y;
  let cosLat = max(cos(lat), 1.0e-4);
  let cols = radPerPixel / cosLat / 6.28318530717959 * u.imageSize.x;

  let tapsY = i32(clamp(ceil(rows), 1.0, 4.0));
  let tapsX = i32(clamp(ceil(cols), 1.0, 32.0));

  let x0 = fx - cols * 0.5;
  let y0 = fy - rows * 0.5;
  let stepX = cols / f32(tapsX);
  let stepY = rows / f32(tapsY);

  var acc = vec3<f32>(0.0);
  for (var sy : i32 = 0; sy < tapsY; sy = sy + 1) {
    for (var sx : i32 = 0; sx < tapsX; sx = sx + 1) {
      let px = i32(floor(x0 + (f32(sx) + 0.5) * stepX));
      let py = i32(floor(y0 + (f32(sy) + 0.5) * stepY));
      acc = acc + fetchSphere(px, py, mode, maxChannel);
    }
  }
  return acc / f32(tapsX * tapsY);
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let maxChannel = u.params.x;
  let mode = u.params.y % 2.0;
  let zoom = u.view.z;

  if (u.params.y >= 2.0) {
    return vec4<f32>(renderSphere(in.uv, mode, maxChannel), 1.0);
  }

  // viewport uv -> image pixel, honouring zoom and pan
  let centred = (in.uv - vec2<f32>(0.5, 0.5)) * u.viewSize / zoom;
  let imgPos = centred + u.view.xy;

  // A screen pixel covers 1/zoom image pixels. Below 1:1 we box-filter that
  // footprint instead of point-sampling it — on a field of pure noise, nearest
  // sampling produces moire and a coarse, cheap look; the average produces the
  // fine luminous grain the archive should have.
  let taps = i32(clamp(ceil(1.0 / zoom), 1.0, 6.0));
  let span = 1.0 / zoom;
  let origin = imgPos - vec2<f32>(span, span) * 0.5;
  let stride = span / f32(taps);

  var acc = vec3<f32>(0.0);
  var hits = 0.0;
  for (var sy : i32 = 0; sy < taps; sy = sy + 1) {
    for (var sx : i32 = 0; sx < taps; sx = sx + 1) {
      let p = floor(origin + vec2<f32>((f32(sx) + 0.5) * stride, (f32(sy) + 0.5) * stride));
      if (p.x < 0.0 || p.y < 0.0 || p.x >= u.imageSize.x || p.y >= u.imageSize.y) {
        continue;
      }
      acc = acc + fetch(vec2<i32>(i32(p.x), i32(p.y)), mode, maxChannel);
      hits = hits + 1.0;
    }
  }
  if (hits == 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return vec4<f32>(acc / hits, 1.0);
}
`;

export const GLSL_VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(
    (gl_VertexID == 2) ? 3.0 : -1.0,
    (gl_VertexID == 0) ? -3.0 : 1.0
  );
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform vec2 uImageSize;
uniform vec2 uViewSize;
uniform vec4 uView;      // xy = pan, z = zoom
uniform uvec4 uSeed;
uniform vec4 uParams;    // x = maxChannel, y = mode
uniform uvec4 uPatchInfo; // x = first patched pixel, y = count
uniform uvec4 uPatch[128];
uniform usampler2D uAddrTex;

out vec4 fragColor;

const uint M0 = 0xd2511f53u;
const uint M1 = 0xcd9e8d57u;
const uint W0 = 0x9e3779b9u;
const uint W1 = 0xbb67ae85u;

uvec2 mulhilo(uint a, uint b) {
  uint ah = a >> 16u, al = a & 0xffffu;
  uint bh = b >> 16u, bl = b & 0xffffu;
  uint albl = al * bl;
  uint ahbl = ah * bl;
  uint albh = al * bh;
  uint ahbh = ah * bh;

  uint carry = 0u;
  uint m1 = ahbl + albh;
  if (m1 < ahbl) carry += 0x10000u;
  uint m2 = m1 + (albl >> 16u);
  if (m2 < m1) carry += 0x10000u;

  uint hi = ahbh + (m2 >> 16u) + carry;
  uint lo = (m2 << 16u) | (albl & 0xffffu);
  return uvec2(hi, lo);
}

uvec4 philox(uint c0, uint c1, uint c2, uint c3, uint k0, uint k1) {
  uint x0 = c0, x1 = c1, x2 = c2, x3 = c3;
  uint key0 = k0, key1 = k1;
  for (int r = 0; r < 10; r++) {
    uvec2 p0 = mulhilo(M0, x0);
    uvec2 p1 = mulhilo(M1, x2);
    uint n0 = p1.x ^ x1 ^ key0;
    uint n1 = p1.y;
    uint n2 = p0.x ^ x3 ^ key1;
    uint n3 = p0.y;
    x0 = n0; x1 = n1; x2 = n2; x3 = n3;
    if (r < 9) { key0 += W0; key1 += W1; }
  }
  return uvec4(x0, x1, x2, x3);
}

vec3 fetch(ivec2 px, float mode, float maxChannel) {
  uint index = uint(px.y) * uint(uImageSize.x) + uint(px.x);

  // See the WGSL source: the tail overrides whichever base is in play.
  if (uPatchInfo.y > 0u && index >= uPatchInfo.x) {
    uvec4 p = uPatch[int(index - uPatchInfo.x)];
    return vec3(float(p.x), float(p.y), float(p.z)) / maxChannel;
  }

  if (mode < 0.5) {
    uvec4 w = philox(index, 0u, uSeed.z, uSeed.w, uSeed.x, uSeed.y);
    uint mask = uint(maxChannel);
    return vec3(float(w.x & mask), float(w.y & mask), float(w.z & mask)) / maxChannel;
  }
  uvec4 texel = texelFetch(uAddrTex, px, 0);
  return vec3(float(texel.x), float(texel.y), float(texel.z)) / maxChannel;
}

// See the WGSL source for the reasoning; this is the same code.
vec3 fetchSphere(int xi, int yi, float mode, float maxChannel) {
  int w = int(uImageSize.x);
  int h = int(uImageSize.y);
  int x = ((xi % w) + w) % w;
  int y = clamp(yi, 0, h - 1);
  return fetch(ivec2(x, y), mode, maxChannel);
}

vec3 lookDirection(vec2 ndc, float aspect) {
  float fov = uView.w;
  float yaw = uParams.z;
  float pitch = uParams.w;

  float tanHalf = tan(fov * 0.5);
  vec3 d = normalize(vec3(ndc.x * aspect * tanHalf, ndc.y * tanHalf, 1.0));

  float cp = cos(pitch);
  float sp = sin(pitch);
  float y1 = d.y * cp + d.z * sp;
  float z1 = -d.y * sp + d.z * cp;

  float cy = cos(yaw);
  float sy = sin(yaw);
  return vec3(d.x * cy + z1 * sy, y1, -d.x * sy + z1 * cy);
}

vec3 renderSphere(vec2 uv, float mode, float maxChannel) {
  float aspect = uViewSize.x / uViewSize.y;
  vec2 ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  vec3 dir = lookDirection(ndc, aspect);

  float lon = atan(dir.x, dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));

  float fx = (lon + 3.14159265358979) / 6.28318530717959 * uImageSize.x;
  float fy = (1.57079632679490 - lat) / 3.14159265358979 * uImageSize.y;

  float radPerPixel = uView.w / uViewSize.y;
  float rows = radPerPixel / 3.14159265358979 * uImageSize.y;
  float cosLat = max(cos(lat), 1.0e-4);
  float cols = radPerPixel / cosLat / 6.28318530717959 * uImageSize.x;

  int tapsY = int(clamp(ceil(rows), 1.0, 4.0));
  int tapsX = int(clamp(ceil(cols), 1.0, 32.0));

  float x0 = fx - cols * 0.5;
  float y0 = fy - rows * 0.5;
  float stepX = cols / float(tapsX);
  float stepY = rows / float(tapsY);

  vec3 acc = vec3(0.0);
  for (int sy = 0; sy < 4; sy++) {
    if (sy >= tapsY) break;
    for (int sx = 0; sx < 32; sx++) {
      if (sx >= tapsX) break;
      int px = int(floor(x0 + (float(sx) + 0.5) * stepX));
      int py = int(floor(y0 + (float(sy) + 0.5) * stepY));
      acc += fetchSphere(px, py, mode, maxChannel);
    }
  }
  return acc / float(tapsX * tapsY);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uViewSize.x, 1.0 - gl_FragCoord.y / uViewSize.y);
  float maxChannel = uParams.x;
  float mode = mod(uParams.y, 2.0);
  float zoom = uView.z;

  if (uParams.y >= 2.0) {
    fragColor = vec4(renderSphere(uv, mode, maxChannel), 1.0);
    return;
  }

  vec2 centred = (uv - vec2(0.5)) * uViewSize / zoom;
  vec2 imgPos = centred + uView.xy;

  // See the WGSL source: box-filter the footprint when below 1:1.
  int taps = int(clamp(ceil(1.0 / zoom), 1.0, 6.0));
  float span = 1.0 / zoom;
  vec2 origin = imgPos - vec2(span) * 0.5;
  float stride = span / float(taps);

  vec3 acc = vec3(0.0);
  float hits = 0.0;
  for (int sy = 0; sy < 6; sy++) {
    if (sy >= taps) break;
    for (int sx = 0; sx < 6; sx++) {
      if (sx >= taps) break;
      vec2 p = floor(origin + vec2((float(sx) + 0.5) * stride, (float(sy) + 0.5) * stride));
      if (p.x < 0.0 || p.y < 0.0 || p.x >= uImageSize.x || p.y >= uImageSize.y) continue;
      acc += fetch(ivec2(int(p.x), int(p.y)), mode, maxChannel);
      hits += 1.0;
    }
  }
  if (hits == 0.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  fragColor = vec4(acc / hits, 1.0);
}
`;
