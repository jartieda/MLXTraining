# Vendored prototype

`occlusion-prototype.js` is a verbatim copy of `app.js` from the project's earlier
standalone experiment (originally at `../EjemploXAI/app.js`, outside this repository).

**Why it is here.** R4 specifies porting `computeOcclusionHeatmap`, `normalizeHeatmap`, and
`paintHeatmap` from it. Referencing a file outside the repository made T064 impossible for
any contributor who did not happen to have that directory on their machine, and left the
port with no reviewable source. Vendoring it makes the provenance explicit and the port
diffable.

**It is not source.** It is excluded from ESLint, Prettier, and the TypeScript build. Nothing
in `src/` may import from it. It exists to be read while writing
`src/ml/explain/occlusion.ts`, and can be deleted once that port is reviewed and merged.

## What the port must change

| Prototype | Port (`src/ml/explain/occlusion.ts`) |
|---|---|
| `await model.detect(canvas)` once per cell, sequentially (line 266) | All variants in a chunk through the backbone in **one batched pass**, chunked at 24 (R4) |
| Perturbs a COCO-SSD detector's `score` | Perturbs the learner's classifier probability for the chosen class |
| Grid derived from a bounding box, clamped to a minimum of 4 | Fixed 12×12 over the whole 224×224 frame |
| Grey patch `rgba(127,127,127,1)` | Grey patch at the dataset mean |
| Reads `document`, canvases and module-level mutable state | Pure function over an `ImageSource`; no DOM (Principle VI) |

## One thing the prototype settles

`getPatchForCell` computes `cellWidth = boxWidth / gridWidth` and places each patch at
`col * cellWidth` with that same width — so the sweep is **non-overlapping**. An earlier
revision of R4 claimed a 50% stride overlap alongside a count of 144 variants, which cannot
both hold: a half-cell stride over a 12×12 grid yields 23×23 = 529 positions. The prototype
confirms the count was right and the overlap was the error, which is how R4 came to specify
a full-cell stride.
