# Handoff — Universal Image Archive

You are taking over a working, deployed project. Read this before touching anything: several
things that look like bugs are deliberate, and several things that look fine have already
been proven wrong once.

- **Repo** `https://github.com/ShreyChouksey/universal-image-archive` (public)
- **Live** `https://shreychouksey.github.io/universal-image-archive/`
- **Owner** Shrey Chouksey. Everything below was built with him over one session; he is
  exacting about correctness and about the interface never lying.

---

## 1. What this is

An archive of **every possible image** at a given grid and colour depth. At the default
3840 × 2160 / 48-bit it holds 10^119,849,433 images and **stores none of them**.

It is a rebuild of Jonathan Basile's [Babel Image Archives](https://babelia.libraryofbabel.info)
(640 × 416, 12-bit, server-rendered, ~3 s per image). This one is 4K at 48-bit, runs entirely
in the browser, and draws a frame in one GPU pass.

**The one idea everything rests on:**

> An address **is** its image. Read the pixels row by row, each channel most-significant byte
> first, and treat the whole run as a single integer in base 256. Address 0 is black, the
> largest address is white, and every image in between sits at exactly one number.

The map is a total bijection in both directions. That is not decoration — it is what makes
the collection *complete* rather than merely large, and it is what makes the Plate feature
(§7) possible at all. **Any change that breaks it is wrong, however convenient.**

---

## 2. The architecture in one page

```
src/core/     pure, testable, no DOM
  philox.ts       Philox 4x32-10 counter-based generator + Random123 self-test
  address.ts      the bijection: materialise, traverse, mod-10^15 residue,
                  tail solving, digit counting, the .uia container
  offset.ts       THE KEY MODULE — walking an address without building one
  format.ts       grids, depths, geometry, custom grids, capacity limits
  sphere.ts       equirectangular projection, both directions
  plate.ts        bitmap font, plate composition, exact readback, verification
  png.ts          16-bit PNG writer AND reader (filters 0-4, CRC-checked)
  raster.ts       pixel conversions (extracted from the worker to be testable)
  magnitude.ts    scale arithmetic for the human-facing anchors

src/gpu/
  shaders.ts      WGSL and GLSL ports of the generator AND the projection
  renderer.ts     WebGPU (rgba16float / Display-P3 / HDR) + WebGL2 fallback,
                  and the readback probes

src/workers/archive.worker.ts   the 47 MiB end: materialise, search, exports
src/ui/            stage (pan/zoom/loupe/look-around), reader, numbers
src/main.ts        the state machine and all wiring  (~1,900 lines, the big one)
test/engine.test.ts  87 tests, `node --test`, no build step, no dependencies
```

### The state model — read this twice

A **location is a base plus a signed offset.**

```ts
state = { format, seed, offset, mode: 'seed' | 'address', held, playing }

type Held =
  | { kind: 'none' }
  | { kind: 'seed'; seed: Seed; offset: number }        // worker holds A(seed)
  | { kind: 'foreign'; label: string; origin: Seed };   // a photo/file/plate
```

- `mode: 'seed'` — the base is the generator. Pixel *i* is `Philox(seed, i)`, evaluated on
  the GPU. Nothing is allocated.
- `mode: 'address'` — the base is a materialised byte buffer in the worker, uploaded as a
  texture.
- `state.offset` — how far the location has drifted from the base, **in either mode**.

**Why the offset exists (this is the project's cleverest idea, don't undo it):** adding N to
a base-256 integer only touches its least significant bytes plus the carry. So the image at
`base + N` is the base image *with ~72 bytes rewritten at the very end*. The shader
evaluates its base everywhere except the last 12 pixels, where it reads a **tail patch** from
a uniform (`src/core/offset.ts`, `PATCH_PIXELS = 12`).

Consequences, all verified on the deployed site:

| | |
| --- | --- |
| Step cost | **0.072 ms** seeded, **0.032 ms** on a located photo (was 300 ms / 6 ms) |
| Worker traffic per step | none |
| Grids too large to materialise | still walkable — 64K steps an address of 30,681,454,953 digits |
| An exact address in a URL | `#c=<hex>&o=424242` |

The worker's buffer **stays at the base** while you walk. Anything that needs the address to
actually *be* the bytes — export, plate verification, the Address panel — calls
`flushOffset()` first, which folds the drift in once.

`Held` remembers `origin` so that leaving the address lane and coming back restores the
coordinate too. Without that, a round trip strands you (§8, trap 4).

---

## 3. Invariants — a violation is a top-severity bug

1. `address <-> image` is a total bijection.
2. The CPU generator, the WGSL port and the GLSL port produce **identical** bytes.
3. Chunked materialisation equals unchunked, exactly.
4. `sampleSeed(i)` equals the bytes `materialiseSeed` writes at pixel *i*. The loupe uses the
   former and exports use the latter; if they disagree the interface lies.
5. A PNG written by `encodePng` and read by `decodePng` round-trips byte-for-byte at 8 and
   16 bpc.
6. `solveTail` makes the address end in exactly the requested 15 digits, always.
7. `trailingDecimalDigits` agrees with a BigInt computation.
8. Every arithmetic path stays inside exact double range (< 2^53) or uses BigInt.
9. The sphere projection and its inverse agree; longitude wraps, latitude clamps.
10. **Navigation is exactly reversible.** Walk N, walk back N, and every byte, the
    coordinate, and the URL are as they were. This one is the owner's stated priority.
11. A tail patch equals what materialising-and-stepping would produce.

---

## 4. How correctness is maintained, and why it is not paranoia

**Wrong noise looks exactly like right noise.** A shader bug, a divergent port, a wrong
projection — none of them are visible. The whole verification culture follows from that.

**Four probes run at every page load** (see the console):

```
archive: philox4x32-10 matches Random123 reference vectors
archive: GPU matches CPU across 64 probed pixels
archive: offset patch paints exactly what the CPU computes
archive: plate composes and reads back exactly
```

They read pixels **back off the GPU** and compare against the CPU. Keep them. They have
caught real bugs twice.

**87 tests** (`npm test`) run the real modules under `node --test` — no build step, no
dependencies. Node 24 strips the types; `test/resolve-ts.mjs` is a loader hook so Node can
resolve the source's extensionless imports without touching product code.

The testing bias throughout: **check claims against an independent oracle, not against the
code's own logic.** BigInt is used as the oracle for every fast path precisely because it is
too slow to ship. Where a fast path replaced a slow one, the test compares them.

CI (`.github/workflows/deploy.yml`) runs `npm test` **before** the build, so a broken
invariant fails the deploy rather than shipping.

---

## 5. Traps that have already bitten. Do not rediscover these.

1. **`patch` is a reserved keyword in WGSL.** The pipeline went silently invalid and *every
   readout-based test still passed* — the DOM was correct while the GPU drew nothing. The
   uniform is called `tailPatch`/`tailInfo` in WGSL for this reason.
2. **Test pixels, not the readout.** Following from (1): a test that reads
   `#addressReadout` proves nothing about what was rendered. Use `renderer.probe(...)`.
3. **`drawingBufferStorage` needs `alpha: true`** and reports failure through the WebGL
   error queue, not by throwing. Without checking `gl.getError()` the app cheerfully
   advertised 16-bit HDR it did not have.
4. **Crossing lanes must restore the coordinate**, or a round trip strands the user. This was
   the single most-reported bug of the session; it is why `Held` carries `origin`.
5. **GitHub Pages CDN caches HTML ~10 minutes.** After a push, wait for propagation and hard
   refresh before concluding a deploy failed. Poll for a known string in the deployed HTML.
6. **`npm` needs `allowScripts` for esbuild** (already in `package.json`). Without it Vite
   has no binary.
7. **V8's BigInt caps at 2^30 bits** — exactly 134,217,728 bytes parses, one more throws.
   `BIGINT_MAX_BYTES` in `address.ts`. The 8K decimal export is gated on it.
8. **The worker is serial.** Polling it from a test competes with the operation being timed
   and inflates the numbers wildly. Measure via the DOM or via `performance.now()` around
   synchronous calls.

---

## 6. Measured limits (not guesses)

| Wall | Value | What it stops |
| --- | --- | --- |
| `maxTextureDimension2D` | 16,384 | Address *materialisation* needs a texture. **Binding limit.** |
| Largest single `ArrayBuffer` | ~2,016 MB | caps address bytes and RGBA16 texture separately |
| JS heap | 4,096 MB | both must fit at once — 14 B/px combined |
| BigInt | 2^30 bits | decimal export, digit-count fallback |
| Philox counter word | 2^32 pixels | 65536 × 65536, far past anything reachable |

**16K UHD is the last grid that fully materialises** (~9 s resolve, ~16 s PNG encode). 32K
and 64K are in the picker deliberately as *browse only* — and since the offset work, they
are **walkable** too. Browsing cost is per *viewport* pixel, so it is flat from 1080p to 64K.

---

## 7. Features, and the reasoning behind the non-obvious ones

- **Two lanes, one meaning.** Coordinates (128-bit, shareable) name addresses through
  Philox. The arrows always walk *the address*; the coordinate is where you **jump** to.
- **Plane and sphere geometry** over the same bytes. Sphere is equirectangular, always 2:1.
  The interface prints the trade honestly: 2/π = 64% equal-area efficiency, and 3.75×
  coarser per degree than a flat 4K frame.
- **Plates** — an image with fifteen digits printed on its face that *are* the last fifteen
  digits of its own address. Only possible because the address is the image, so the image can
  be solved for. Verification compares every pixel of every glyph cell **and** recomposes the
  whole panel, so an edited caption cannot verify. Layouts are frozen and versioned: a
  released layout may be superseded, never edited, or every plate minted under it stops
  verifying.
- **Custom grids** — a picture whose dimensions match no listed grid can get an archive cut
  to its exact size (`r=c900x1600` in the URL). Pixel-exact, no resampling.
- **Exports round-trip**: `.uia` (binary), hex `.txt`, decimal `.txt` (the real number, all
  119,849,434 digits). All three can be dropped back in.
- **Address panel** — a virtualised hex reader with byte offsets and the pixel each row
  belongs to; click a row and the stage flies there. Measured entropy, not claimed.

**Design language — please preserve it.** The chrome carries **no accent hue**: the subject
is 281 trillion colours and any tinted furniture competes with the work. Colour appears only
where it encodes data (the R/G/B loupe). Warm graphite ground, bone ink, `ui-serif` for
prose, tabular mono for every measurement, hairlines rather than cards, 2px corners max.
Dark only, deliberately.

---

## 8. Where we are

**Everything above is done, deployed and verified.** Working tree clean at
`2321206 Walk a located address the same way, at the same cost`. 87/87 tests pass.

Two adversarial audits have been run (engine correctness, then navigation reversibility);
their surviving findings are all fixed. The known-remaining items, none blocking:

- **The tail patch covers 72 bytes.** If a carry runs past it, the code detects this and
  falls back to a real materialised step — correct, just not instant. On pseudorandom data
  that needs all 72 bytes to be `0xFF` (256^-72), but on a **located photo letterboxed in
  black** the tail genuinely is a run of zeros, so the fallback is reachable there. Working
  as designed; could be made faster by widening the patch.
- **`decimalDigitCount`** is exact via BigInt below 8 KiB, two-double above, with an exact
  fallback at decade boundaries — except above the BigInt ceiling, where an address
  constructed within 10^-11 of a power of ten could be off by one. Documented in-code.
- **No LICENSE file.** Public repo, so currently "all rights reserved" by default. The owner
  has not chosen one.
- **`src/main.ts` is ~1,900 lines** and is the natural next refactor if it starts to hurt.
  Do not refactor it speculatively — it is coherent, just large.
- **Untested on real mobile hardware** beyond the responsive breakpoint.

---

## 9. Working agreements

```bash
npm install        # allowScripts for esbuild is already configured
npm run dev        # http://localhost:5273
npm test           # 87 tests, ~35 s
npm run build      # typecheck + build; CI gates the deploy on test then build
```

`?backend=webgl2` forces the fallback path — this is how the GLSL port stays tested, and the
first thing to try when a driver misbehaves. In dev only, `window.__archive` exposes the
state machine for browser-driven verification; it is correctly absent from production.

Deploy is `git push` — GitHub Actions builds and publishes to Pages.

**How the owner likes to work:** verify in the real browser, not just in tests; report
measured numbers rather than adjectives; say plainly what was *not* done and why. He notices
when the interface asserts something it has not checked, and he is right to.

---

## 10. Good next moves

Nothing is broken. If you are looking for the next substantive thing:

- Widen the tail patch so black-tailed located images step instantly too.
- A LICENSE, if the owner wants others to use it.
- The **spectral** extension (K colour bands per pixel instead of 3) was designed and
  deliberately deferred — the payoff is metamerism, images that are provably different and
  visually identical. The full reasoning is in the session history; it was judged to make the
  default encounter duller, so it needs a UI idea before it is worth building.
- Mobile.

Ask before changing the design language, the two-lane model, or anything in §3.
