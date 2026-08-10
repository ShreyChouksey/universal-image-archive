# Universal Image Archive

Every image that can be drawn on a 3840 × 2160 grid at 48-bit colour, addressable and
reachable in the browser. The archive holds 10<sup>119,849,433</sup> images and stores
none of them.

It is a reworking of Jonathan Basile's [Babel Image Archives](https://babelia.libraryofbabel.info),
which applied Borges' Library of Babel to pictures. That version renders 640 × 416 at
12-bit colour on a server, takes about three seconds per image, and hands you an address
of roughly a million digits that most browsers choke on. This one runs entirely on the
client, draws a 4K frame in a single GPU pass, and is 124× larger in bits.

|                        | Babel Image Archives | Universal Image Archive |
| ---------------------- | -------------------- | ----------------------- |
| Grid                   | 640 × 416            | 3840 × 2160             |
| Colour depth           | 12-bit (4,096)       | 48-bit (281.47 trillion)|
| Address                | 3,194,880 bits       | 398,131,200 bits        |
| Images                 | 10^961,755           | 10^119,849,433          |
| Where it runs          | Server               | Your GPU                |
| Time to draw one       | ~3 s                 | One frame               |
| Geometry               | Plane only           | Plane or sphere         |

**Picking this up?** [HANDOFF.md](HANDOFF.md) is the orientation document: the state model,
the invariants that must not break, the traps already discovered, and where things stand.

## The idea

An address **is** its image. Read the pixels row by row, each channel most-significant
byte first, and treat the whole run as one integer in base 256. Address zero is black,
the largest address is white, and every image in between sits at exactly one number. The
map is a bijection in both directions, which is what makes the collection complete rather
than merely large.

At 4K and 48-bit a full address is 47.46 MiB — 119,849,434 decimal digits. That cannot go
in a link, so the archive has a second lane:

- **Coordinates** — 128 bits, 32 hex characters. Short, shareable, and resolved to an
  address through a counter-based function. Every coordinate names a real address.
- **Addresses** — exact and complete. Not every address has a coordinate; those are
  reached by supplying the image, which is what search does.

## Why it is fast

The colour at pixel *i* is a pure function of *i*. There is no sequential state, so:

- the GPU evaluates all 8,294,400 pixels in one fragment pass;
- the CPU can read any byte of an address without walking the preceding 47 MB;
- materialising a full 4K/48-bit address takes about 1.5 s, and encoding it as a
  16-bit PNG about 0.7 s.

The generator is Philox 4×32-10. It is verified at startup against the two published
Random123 test vectors, and the GPU's output is read back and compared against the CPU's
across a block of pixels — because wrong noise looks exactly like right noise, and the
picture on screen must be the number printed beneath it.

## Colour depth

Channels are 16 bits: the deepest integer colour any mainstream still format carries.
The canvas is configured `rgba16float` in Display-P3 with extended-range tone mapping
where the browser allows it, falling back through P3 8-bit to sRGB. Exports are written
as real 16-bit truecolour PNGs — `canvas.toBlob()` can only produce 8, which would discard
half of every address on the way out, so the encoder writes the format directly and uses
`CompressionStream('deflate')` for the zlib layer.

Most monitors will show 8 or 10 of those 16 bits. The rest are not wasted: they are the
difference between 16.8 million possible colours and 281.5 trillion, and the archive is
that much larger for them.

## How big the grid can get

Browsing and materialising have completely different cost curves, and only one of them
has a ceiling.

**Browsing costs nothing per pixel of the image.** The shader runs once per *viewport*
pixel, and the image is never allocated. Measured draw time is flat from 1080p to 64K:

| Grid | Pixels | Draw | Materialise | PNG encode | PNG size | Peak heap |
| ---- | ------ | ---- | ----------- | ---------- | -------- | --------- |
| 1080p | 2.07 M | 0.4 ms | — | — | — | — |
| 4K UHD | 8.29 M | 1.8 ms | 0.56 s | 0.62 s | 47.5 MB | 69 MB |
| 5K | 14.7 M | 1.5 ms | 0.97 s | 1.7 s | 84 MB | 181 MB |
| 8K UHD | 33.2 M | 1.7 ms | 2.2 s | 2.5 s | 190 MB | 370 MB |
| 12K | 74.6 M | 1.7 ms | 4.9 s | 5.7 s | 427 MB | 574 MB |
| 16K | 132.7 M | 1.7 ms | 8.7 s | 15.6 s | 760 MB | 1017 MB |
| 32K | 530.8 M | 5.7 ms | *browse only* | | | |
| 64K | 2.12 G | 5.5 ms | *browse only* | | | |

*(Apple Silicon, Chrome, WebGPU. Draw is the fit view; zooming in does not change it.)*

The walls, measured rather than assumed:

| Wall | Value | What it stops |
| ---- | ----- | ------------- |
| `maxTextureDimension2D` | 16,384 | Address mode needs a texture, so no axis may exceed this. **This is the binding limit.** |
| Largest single `ArrayBuffer` | ~2,016 MB | Caps the address bytes and the RGBA16 texture separately |
| JS heap | 4,096 MB | Both have to fit at once — address is 6 B/px, texture 8 B/px, so 14 B/px total |
| Philox counter word | 2³² pixels | 65536 × 65536, four orders of magnitude past anything reachable |

So: **16K UHD is the last grid that fully works**, at about 9 s to resolve and 16 s to
encode. The theoretical wall for the full pipeline is around 250 megapixels — roughly
16384 × 15000 — where the 14 B/px combined cost exhausts the heap.

Past that, a grid is *browse only*: 32K and 64K are in the picker on purpose. You can
wander a two-gigapixel image at 5 ms a frame and never be able to hold it. Exports and
address resolution are disabled with an explanation rather than failing silently — the GPU
reports an oversized texture through an error scope, not by throwing, so an unguarded
attempt produces a black frame and no reason for it.

One honest caveat: at 64K the fit view is featureless grey. Each screen pixel is averaging
tens of thousands of independent samples, so the variance collapses to the mean. The
structure is real and still there; it only exists at zoom.

## Reading the address

The bench can only show the first and last sixteen bytes of a 47-megabyte number, which
states the scale without conveying it. The **Address** panel (`A`) reads the real thing:

- **A window onto any part of it.** Byte offset, sixteen bytes of hex, and the pixel those
  bytes belong to. Click a line and the stage flies to that pixel with the loupe on — the
  number and the picture stop being two facts about each other.
- **A slider geared to the truth.** At 4K there are 3,110,400 lines; dragging the slider by
  a single pixel crosses about 8,964 of them, and an arrow key moves 3. Those figures are
  computed from the slider's own width rather than written into the copy.
- **Measured entropy, not claimed entropy.** Shannon entropy of the loaded address and its
  real gzip ratio. A typical address reads 7.999997 of 8 bits per byte and compresses to
  100.03% of its original size — gzip makes it *bigger*. All 256 byte values present.
- **A byte histogram.** 256 counts across the whole address. A flat field is what no
  structure looks like.

Hexadecimal, not decimal, and not as a compromise: the address is a byte string, so hex has
O(1) random access and any window is instant. Decimal has no such property — the digit at
position *n* depends on all 47 MB — which is exactly why it is an export rather than a view.

### Making it land

| | |
| --- | --- |
| Written out in full | 119,849,434 digits |
| Set in one line at 10 pt | 254 km |
| Printed on A4 | 35,250 pages, stacked 4 m high |
| Read aloud at three digits a second | 462 days |
| Every atom in the universe, a billion images a second, since the Big Bang | 10¹⁰⁷ images |
| Fraction of the archive that would cover | 10⁻¹¹⁹˒⁸⁴⁹˒³²⁶ |

## Taking the address with you

Three exports, because `.uia` alone is a binary blob you cannot look at:

| Format | What it is | Cost |
| --- | --- | --- |
| **Hexadecimal** `.hex.txt` | Exact, readable, one hex pair per byte | Immediate |
| **Decimal** `.dec.txt` | The actual number, all 119,849,434 digits | ~62 s at 4K |
| **Binary** `.uia` | Exact bytes plus a header, reopens here | Immediate |

The decimal export is genuinely the number. Verified at the Babelia grid: the decimal file
equals `BigInt('0x' + hexfile)`, and its last twelve digits match the bench readout —
which is computed by a completely different path (a streaming `mod 10¹⁵` over the bytes,
never touching BigInt). Two independent methods, same answer.

## Is every image random?

**No, and the difference is the point.** The archive contains every photograph ever taken,
pure black at address zero, pure white at the largest address. Nothing in it is random; it
is simply all of them.

What is random is the **coordinate lane**. Every one of the 2¹²⁸ coordinates resolves to
noise — not because the generator prefers noise, but because images that mean anything are
vanishingly rare among all images. You will never find a face by pressing Random.

**There are no bad coordinates.** Philox is counter-based, so it has no internal state to
fall into a rut; every coordinate is an independent key. Measured over the real generator:

| Test | Result |
| --- | --- |
| Byte χ² (255 df, critical 330.5) | 218–275 across all-zeros, all-ones, low-Hamming and random keys |
| Shannon entropy | 7.99984 bits/byte at 1.14 MiB per seed |
| gzip ratio | 1.0003 — literally incompressible |
| Serial correlation | ≤ 0.0036 |
| Adjacent coordinates | 64.27 of 128 bits change (ideal 64) |
| One key bit flipped | 62.13 bits change (ideal 64) |
| Correlation at lag 3840 (one row down) | 0.0006, under the 0.0016 noise floor |
| 5,000 random coordinates over p<0.001 | **5** — exactly the 5 chance predicts |

A generator that fails at precisely the rate randomness predicts is a correct one. The
Address panel recomputes entropy on whatever is loaded, so this is checkable on the picture
in front of you rather than taken on faith.

## One lane: walking an address without ever building one

An address is 47.46 MiB, and materialising one to take a single step is what
forced the coordinate lane and the address lane apart. It does not have to.

Adding N to a base-256 integer changes only its least significant bytes — the last
`ceil(log₂₅₆ N)` of them, plus however far the carry runs. Everything above is untouched.
For a seeded address every byte is a pure function of its own index, so the image at
`A(seed) + N` **is the seeded image with a few bytes rewritten at the very end**. The shader
evaluates Philox everywhere except the last twelve pixels, where it reads a patch from a
uniform.

So a location is a **coordinate and a signed offset**, and stepping costs arithmetic on
72 bytes plus a uniform upload — no allocation, no texture, no 47 MiB anywhere:

| | Before | Now |
| --- | --- | --- |
| One step | ~300 ms (66 MB texture re-upload) | **0.125 ms** |
| First step | 1.5 s materialisation | none |
| On a browse-only 64K grid | impossible | **5 ms**, on an address of 30,681,454,953 digits |
| Address visible before resolving | no | yes — head and tail are cheap from the generator |
| Exact address in a URL | impossible at 47 MiB | `#c=…&o=424242` |

**A located photograph walks the same way.** Its picture is already on the GPU as a texture,
and a step still only rewrites the tail — so the patch rides on top of the texture exactly
as it rides on top of the generator, and the 47 MiB in the worker is never touched while you
walk. The base's head, tail and decimal residue are handed over once when it loads, and
every nearby address is then described entirely on the main thread.

| Stepping a located photograph | Before | Now |
| --- | --- | --- |
| Per step | 6 ms (banded texture upload + worker round trip) | **0.097 ms** |
| Worker traffic per step | two messages | none |

The worker's buffer stays at the base and the drift is carried separately, which is what
makes it free. Anything that needs the address to actually *be* the bytes — exporting,
verifying a plate, reading it in the Address panel — folds the drift in first: one step of
arithmetic on 47 MiB, paid once at the moment it matters instead of on every press.

The arrows therefore always mean *the address*, by one mechanism, whatever the base. The
coordinate stopped being something you walk and became what it always was: where you jump
to.

Two things make it honest rather than merely fast. The carry is the one thing that can
escape the patch; that case is detected and reported, and the caller falls back to
materialising — on a pseudorandom tail it needs all 72 bytes to be 0xFF, a probability of
256⁻⁷². And a startup probe reads the tail pixels back off the GPU and compares them against
the CPU's patch, because a shader painting a different address than the number beneath it
claims would look exactly like one painting the right one.

## Walking, and coming back

The rule the whole thing rests on: **walk N steps, walk back N, and you are exactly where
you were** — same pixels, same address, same coordinate.

The arrows walk whichever lane you are actually in. A picture reached through search lives
at an address and has no coordinate, so from there ← → move the *address*; while browsing
coordinates they move the *coordinate*. Moving the coordinate from an address would not be
travel at all — it is a jump into a different space, and coming back returns the number
without the picture. The step box between the arrows sets the distance, so the invariant is
testable at any size.

Both lanes are exact modular groups, verified against BigInt: `bumpAddress` over base 256
and `seedAdd` over 2¹²⁸, both carrying and borrowing correctly and both wrapping cleanly at
either end. `+100` is bit-identical to a hundred `+1`s.

Crossing between the lanes is reversible too. Teleporting away — Random, a typed
coordinate, Traverse — *parks* the loaded picture rather than destroying it, and a chip on
the stage brings it back along with the coordinate it was parked from, so the arrows resume
meaning what they meant before you left. Anything that would spend a loaded picture (a grid,
depth or geometry change; resolving the coordinate's own address) asks first.

Stepping is a banded repaint: `bumpAddress` reports how far its carry reached, and only
those rows are re-uploaded. A step of one touches one row instead of sixty-six megabytes,
which took a step from ~300 ms to **6 ms**. Presses are coalesced rather than dropped, so
twelve fast clicks move exactly twelve. The readout's decimal tail is carried forward
arithmetically — the residue of address+delta is (residue+delta) mod 10¹⁵ exactly — instead
of re-streaming 47 MB per step.

## Plane and sphere

A plane grid is a **window**: the address is everything visible through a frame pointed one
way. A sphere grid is a **standpoint**: the same bytes, read as a full turn of longitude
against half a turn of latitude, so the address is not a picture you look at but a place you
look *from*. Drag to turn your head.

Nothing about the bijection changes — same row-major order, same big-endian channels, same
map. Only the *reading* of the grid differs, which is why geometry belongs to the format and
travels with the file rather than living in the address.

```
pixels   4096 × 2048            =       8,388,608
bytes    8,388,608 × 6          =      50,331,648   = 48.0000 MiB exactly
bits     50,331,648 × 8         =     402,653,184
         402,653,184 × log10(2) = 121,210,686.2     → 10^121,210,686 spheres
```

Against the flat 4K archive's 398,131,200 bits, the sphere archive is **10^1,361,252 times
larger** — the entire flat archive is smaller than the rounding error on the sphere
archive's exponent.

| Sphere grid | Address | Bits | Holds | Pitch |
| --- | --- | --- | --- | --- |
| 2048 × 1024 | 12.00 MiB | 100,663,296 | 10^30,302,671 | 10.55′/texel |
| **4096 × 2048** | **48.00 MiB** | **402,653,184** | **10^121,210,686** | 5.27′/texel |
| 6144 × 3072 | 108.00 MiB | 905,969,664 | 10^272,724,044 | 3.52′/texel |
| 8192 × 4096 | 192.00 MiB | 1,610,612,736 | 10^484,842,744 | 2.64′/texel |

8192 is not arbitrary: it is WebGPU's guaranteed `maxTextureDimension2D`, so the top rung is
the largest sphere a conforming device is *required* to be able to resolve.

**It is a trade, not an upgrade,** and the interface prints both sides of it. Equirectangular
sampling crowds texels together approaching the poles, so equal-area efficiency is
2/π = **63.7%** — about 36% of a sphere's address is the projection's redundancy rather than
the archive's content. And the default sphere resolves at 5.27′ per texel against a flat 4K
frame's 1.41′ per pixel at the same 90° field of view: **3.75× coarser per degree of view**.
Completeness is bought with resolution.

Search places a flat photograph into the sphere by asking, for every texel, whether the
camera that took it could have seen that direction. Set the surround to *the archive itself*
and everything the photograph didn't reach fills with the archive's own noise at your current
coordinate: you supply what you saw, and the archive supplies the rest of what could have
been seen from there.

Exports carry GPano XMP, so a sphere opens as a real 360 photo in a phone or a panorama
viewer. That chunk is metadata sitting before `IDAT` and changes not one pixel byte — a plate
exported as a sphere still verifies exactly.

Two failure modes that are invisible over noise, and are therefore checked rather than
assumed:

- **The projection is a third port of the same maths.** `probeSphere` reads 8×8 pixels back
  off the GPU and compares them against `src/core/sphere.ts`. Verified on both WebGPU and
  WebGL2, at the equator, both sides of the ±π seam, and both poles — zero mismatches.
- **`textureLoad` ignores sampler wrap.** Longitude is wrapped arithmetically instead;
  without it a black hairline runs down lon = ±π, invisible against static and glaring in a
  360 viewer.

The startup probe deliberately forces *plane* geometry even for a sphere format, because it
compares fragments against `sampleSeed` by linear index — otherwise every boot in sphere mode
would report a divergence that isn't there.

## Plates

A plate is an image with fifteen digits printed on its face, and those digits are the last
fifteen digits of the number that image **is**.

This is not a caption or a watermark, and it is the one thing here that an archive built on
lookup keys cannot do at all. Because the address is the image rather than a pointer to it,
the image can be *solved for*: stamp the ground and the digits, which fixes every byte
except the last seven, then choose those seven so the whole 119,849,434-digit number ends
in what the panel already says. Those seven bytes are the bottom-right two pixels, well
outside any glyph, so nothing is adjusted afterwards and nothing can drift.

```
address = H · 256⁷ + T,  H fixed by the stamp
T ≡ target − H · 256⁷   (mod 10¹⁵)     → 9 solutions in range
```

Type in a birthday or a phone number and the archive returns a 4K image whose address
provably ends with it. The panel reports the odds: for Plate I, one address in
10^46,164,241 is a valid plate of that layout.

**Verification is the point.** Drop a plate back on the Search panel and it reads TRUE or
FALSE — the digits are read off the pixels by exact bitmap comparison, never OCR, and
compared against the address recomputed from all 47.5 MB. Verified end to end:

| | Result |
| --- | --- |
| Freshly minted | TRUE |
| Address stepped by +1 | **FALSE** — computed `…794` against printed `…793` |
| Stepped back by −1 | TRUE again |
| 16-bit PNG export → decode → verify | TRUE |
| Screenshot, or any 8-bit rendering | FALSE, and says why |

So a plate is a proof of unmodified transmission with no key, no signature, and nobody to
trust. Its fragility is the feature — which is why the plate says `TRUE ONLY IN ITS EXACT
BYTES` on its own face, inside the region that makes it true.

Determinism is checked at startup alongside the Philox reference vectors: a plate is
composed, read back, and its arithmetic confirmed, because a wrong plate looks exactly like
a right plate. The font is an embedded bitmap at integer scale — never `fillText`, which is
not bit-identical across platforms and would make a plate true only on the machine that
minted it. Layouts are frozen and versioned; a released layout may be superseded but never
edited, or every plate minted under it stops verifying.

## Running it

```bash
npm install && npm run dev
```

```bash
npm test
```

70 tests run the real modules under `node --test` with no build step, checking the fast
paths against BigInt oracles and the codec against hand-built files — including a
truncation sweep of every prefix of a PNG, tamper tests on plates, and decade-boundary
attacks on the digit counter. CI runs them before every deploy; a broken invariant
cannot ship.

Needs WebGPU or WebGL2. Append `?backend=webgl2` to force the fallback path.

## Layout

| Path                          | What it holds                                              |
| ----------------------------- | ---------------------------------------------------------- |
| `src/core/philox.ts`          | The generator, plus its reference-vector self-test          |
| `src/core/address.ts`         | The bijection, traversal, and the decimal readout           |
| `src/core/png.ts`             | 16-bit truecolour PNG writer                                |
| `src/core/format.ts`          | Grid, depth, and geometry definitions                        |
| `src/core/sphere.ts`          | The equirectangular projection, and what it costs            |
| `src/gpu/shaders.ts`          | WGSL and GLSL ports of the generator                        |
| `src/gpu/renderer.ts`         | WebGPU and WebGL2 backends, and the readback probe          |
| `src/workers/archive.worker.ts` | Materialising, search, and encoding, off the main thread  |
| `src/ui/stage.ts`             | Pan, zoom, and the pixel loupe                              |

## Keys

`R` random · `←` `→` coordinate · `[` `]` neighbouring address · `Space` traverse ·
`F` fit / face forward · `1` actual size · `G` plane ↔ sphere · `I` loupe · `S` search ·
`P` plate · `E` export

## Credit

After Borges, and after Jonathan Basile's Library of Babel and Babel Image Archives,
which did it first.
