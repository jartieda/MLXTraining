# Phase 0 Research: Explainable AI Lab

**Feature**: `001-xai-lab` | **Date**: 2026-08-17 | **Plan**: [plan.md](./plan.md)

Every unknown from the plan's Technical Context is resolved below. Figures marked *(verified)* were
measured against the actual published artifacts during this research phase; figures marked
*(to measure)* are budgets that a task in `tasks.md` must confirm on real hardware.

---

## R1. Backbone model and width

**Decision**: MobileNet v1 at 224×224 input, loaded as a **Layers** model from
`https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_{alpha}_224/model.json`, self-hosted
as a build asset rather than fetched from Google at runtime. Ship **alpha 0.50** as the default,
with alpha 0.25 selectable as a "faster, less accurate" option on constrained devices.

**Verified artifact sizes** (parameter counts read from the published `weightsManifest`):

| alpha | parameters | float32 weights | `conv_pw_13_relu` | `conv_pw_11_relu` |
|---|---|---|---|---|
| 0.25 | 475,544 | ~1.9 MB | 7×7×256 | 14×14×128 |
| 0.50 | 1,342,536 | ~5.4 MB | 7×7×512 | 14×14×256 |
| 1.00 | 4,253,864 | ~17.0 MB | 7×7×1024 | 14×14×512 |

**Rationale**: A **Layers** model is required, not a graph model. Grad-CAM needs a named
intermediate activation tensor, and `tf.model({inputs, outputs})` can only slice a Layers model.
The convenience wrapper `@tensorflow-models/mobilenet` exposes embeddings but not an arbitrary
intermediate layer, so it is unsuitable. Alpha 0.50 is the balance point: 5.4 MB is acceptable as a
lazy-loaded asset on a school connection, and its 512-channel final activation produces visibly
better-localised Grad-CAM maps than 0.25's 256 channels. Self-hosting removes a third-party
runtime dependency and makes the load time predictable.

**Alternatives considered**: MobileNet v2 or v3 — better accuracy per parameter, but the published
TensorFlow.js artifacts are graph models, which forecloses Grad-CAM entirely. Alpha 1.00 — best
features, but 17 MB defeats SC-008. `@tensorflow-models/mobilenet` — no intermediate-layer access.
A KNN classifier over embeddings, which is the fast path some comparable tools take — trains
instantly but has no differentiable head, so there is no gradient to compute Grad-CAM from; it
would eliminate the product's central feature.

---

## R2. Transfer-learning architecture

**Decision**: Truncate the backbone at `conv_pw_13_relu` and freeze it. Train only this head:

```
GlobalAveragePooling2D → Dropout(0.2) → Dense(100, relu) → Dropout(0.2) → Dense(nClasses, softmax)
```

Compile with Adam (lr 1e-3) and categorical cross-entropy. Compute each sample's backbone
activation **once** at capture time, cache it in IndexedDB, and call `fit()` on the cached
activations. Default 20 epochs, batch size 16, with a 20% validation split when every class has at
least 5 samples.

**Rationale**: The expensive work is the backbone forward pass, and caching it at capture time
moves that cost out of the training loop entirely — pressing Train then fits a head of roughly
50k parameters over a few hundred cached vectors, which is a sub-second operation. This is what
makes SC-002 comfortable rather than tight. Freezing the backbone also keeps Grad-CAM stable: the
activations being explained do not shift between runs, so a learner comparing two training runs is
seeing the effect of her data, not of a drifting feature extractor.

**Consequence for storage**: caching activations costs 7·7·512·4 bytes ≈ 100 KB per sample at
alpha 0.50, which dominates the JPEG itself. Cache the pooled 512-float vector (2 KB) for training,
and recompute the full spatial activation on demand for Grad-CAM, which needs it for one frozen
frame at a time. This is the difference between ~10 MB and ~200 KB for a 100-sample project.

**Alternatives considered**: Fine-tuning the last few backbone blocks — better accuracy on unusual
subjects, but training time grows by more than an order of magnitude and the explanation target
moves between runs. Training from raw pixels each epoch — simpler code, roughly 20× slower.

---

## R3. Grad-CAM in TensorFlow.js

**Decision**: Compute against the frozen truncated backbone's activation tensor:

1. `A = truncated.predict(x)` — shape `[1, 7, 7, C]`.
2. `grads = tf.grad(a => head.apply(a).gather([classIdx], 1).sum())(A)`.
3. `weights = grads.mean([1, 2])` — spatial average per channel.
4. `cam = tf.relu(A.mul(weights).sum(-1))` — shape `[1, 7, 7]`.
5. `tf.image.resizeBilinear(cam, [224, 224])`, normalise to [0,1] by its own maximum, apply the
   colormap.

Wrap the whole computation in `tf.tidy` and expose `targetLayer` as a two-value option:
`conv_pw_13_relu` (default, 7×7) and `conv_pw_11_relu` (14×14, offered to learners as "finer
detail").

**Rationale**: Because the backbone is frozen, gradients only need to traverse the small head, so
this is a cheap operation — comfortably inside the 1 s budget of SC-003. Step 4 is the standard
Grad-CAM formulation; the ReLU is what makes the map show evidence *for* the class rather than a
signed mixture. Normalising by the map's own maximum is required for the legend to be meaningful,
and means the legend must be labelled relatively ("low → high evidence") rather than as an absolute
quantity, which is also the more honest framing under Principle III.

**The 7×7 coarseness is a real limitation, and it is pedagogically relevant.** A 7×7 map upsampled
to 224×224 cannot localise a small object precisely. The interface must not imply more precision
than exists, which is why the finer 14×14 layer is offered — and why the difference between the two
is itself worth surfacing as a teaching point about explanation resolution.

**Alternatives considered**: Grad-CAM++ or Score-CAM — better localisation, materially more
computation, and harder to explain to a 14-year-old. Guided backpropagation — visually striking but
known to be largely class-insensitive, which would actively mislead learners. Plain gradient
saliency — cheap, but noisy at the pixel level and much harder to read than a smooth heat map.

---

## R4. Occlusion sensitivity, batched

**Decision**: Port `computeOcclusionHeatmap`, `normalizeHeatmap`, and `paintHeatmap` from the
existing prototype at `../EjemploXAI/app.js` to TypeScript, with two changes: the score being
perturbed becomes the learner's classifier probability for the chosen class instead of a detector's
confidence, and **all occluded variants are stacked into a single batched forward pass** instead of
being predicted one at a time in a loop.

Grid 12×12 by default, grey patch at the dataset mean, patch size equal to one cell, and **stride
equal to one full cell — no overlap**, so the grid yields exactly 144 variants and a 12×12 map. Emit
progress per batch chunk of 24, and honour an `AbortSignal`.

**Correction (2026-08-17)**: an earlier version of this decision specified both "144 variants" and
"50% stride overlap", which cannot both be true — a half-cell stride over a 12×12 grid produces
23×23 = 529 positions, 3.7× the work, and a 23×23 map rather than a 12×12 one. The five-second
budget below was reasoned on 144. Overlap is therefore dropped rather than the budget raised: it buys
a smoother-looking map, which is cosmetic, at a cost that would put SC-003 out of reach on the
reference phone. If a smoother map is ever wanted, the cheap route is bilinear upsampling of the
144-cell map, not more forward passes.

**Rationale**: The prototype's sequential loop is the single reason occlusion feels slow; 144
separate `predict` calls pay the per-call overhead 144 times. One `tf.stack` of 144 tensors through
the backbone is a single GPU dispatch. This is the difference between roughly 30 s and the under-5 s
budget in SC-003 *(to measure)*. Chunking at 24 rather than one batch of 144 keeps peak memory
bounded on a low-end phone and gives the progress indicator something real to report.

Keeping this method alongside Grad-CAM is a constitutional requirement (Principle III), and it
earns its place: it is model-agnostic and its logic — "cover this bit, see if the answer changes" —
is immediately intuitive to a beginner in a way that gradients are not.

**Alternatives considered**: LIME or SHAP — principled and popular, but they need hundreds to
thousands of perturbed evaluations and a surrogate model, far outside the interactive budget.
RISE — random masks, fewer evaluations, but the resulting maps are harder to explain than a plain
grid sweep. Keeping the sequential loop — simplest port, misses the performance budget.

---

## R5. Agreement between the two explanations

**Decision**: Report two numbers, computed after resizing both maps to a common 14×14 grid:
**Spearman rank correlation** over all cells as the headline agreement figure, and **IoU of the
top 20% hottest cells** as a "do they point at the same place" figure. Present the headline as three
bands — strong agreement (ρ ≥ 0.6), partial (0.2 ≤ ρ < 0.6), disagreement (ρ < 0.2) — each with a
plain-language sentence.

**Rationale**: Rank correlation is the right tool because the two methods produce values on
incomparable scales; only the ordering of importance is meaningfully shared. Pearson correlation
would be distorted by the very different value distributions. The top-k IoU is added because rank
correlation over mostly-cold cells can look respectable while the hot regions sit in different
places, which is exactly the case a learner most needs to notice. Banding is required so the
comparison is legible to someone who has never seen a correlation coefficient.

Per FR-018, the disagreement band must produce an explicit statement that neither map is guaranteed
correct — the interface must not quietly average them or present the prettier one.

**Alternatives considered**: Pearson correlation — scale-sensitive, misleading here. Pointing game
(does the maximum fall on the object) — needs ground-truth boxes the lab does not have. A single
blended number — hides the distinction the learner needs.

---

## R6. Heat-map colormap

**Decision**: **Inferno**, as a 256-entry lookup table generated at build time, applied over the
frozen frame with a learner-controlled opacity (FR-019) and a labelled legend running "low
evidence → high evidence".

**Rationale**: Inferno is perceptually uniform, so equal steps in evidence look like equal steps in
colour — the property that makes a heat map readable as data rather than decoration. It is
monotonic in lightness, so it survives greyscale printing and is legible with any form of
colour-vision deficiency. Its dark-purple-to-yellow range is visually distinct from the Technovation
brand accents (navy, blue, orange, magenta), which satisfies the Principle V requirement that heat
never be confused with interface chrome.

**Jet is explicitly rejected.** Its non-monotonic lightness invents visual boundaries where the
data is smooth, which in an explainability tool means teaching learners to see structure that the
model does not have.

**Alternatives considered**: Viridis — equally valid and slightly calmer; inferno chosen because its
brighter hot end reads better as "hot" to a beginner. Brand-coloured ramp — rejected under
Principle V's explicit exemption. Jet — rejected as above.

---

## R7. Backend selection and the no-WebGL path

**Decision**: Try `webgl`; on failure fall back to `wasm` (`@tensorflow/tfjs-backend-wasm`, with
SIMD and multithreading where available); fall back last to `cpu`. Expose a capability report so the
interface can warn that training and explanations will be slower (FR-047). Run a dedicated
end-to-end suite with WebGL disabled to prove SC-012 rather than assuming it.

**Rationale**: SC-012 gives a 4× budget on the non-accelerated path, which is only defensible if it
is measured. Because training fits a tiny head on cached vectors (R2), the WASM path suffers mainly
on the backbone passes — one per capture, plus the occlusion batch. Occlusion is therefore the
operation most at risk on this path, and the grid may need to drop to 8×8 when WebGL is absent
*(to measure)*.

**Alternatives considered**: WebGPU — faster where present, but coverage across the target device
range is not yet dependable enough to be the primary path; revisit later. Refusing to run without
WebGL — violates Principle IV.

---

## R8. Tensor memory management

**Decision**: Every tensor-producing function wraps its body in `tf.tidy`, and any tensor that
outlives a call is returned explicitly and disposed by its owner via an explicit `dispose()` on the
owning object. The live-prediction loop is driven by a throttled timer at 10 fps rather than
`requestAnimationFrame`, and reuses a single input tensor buffer. A development-only assertion
compares `tf.memory().numTensors` before and after each ML operation and fails a test if the count
grows.

**Rationale**: A webcam loop is the classic TensorFlow.js leak: at 60 fps, a handful of undisposed
tensors per frame exhausts GPU memory within a minute and the tab dies. The leak assertion in tests
is what makes this a caught regression rather than a bug report from a classroom. Throttling to
10 fps is also the right product choice — it is well above the rate at which a prediction display
reads as "live" and cuts backbone work by 6×.

**Alternatives considered**: Relying on review to catch missing disposals — historically
unreliable. Running inference in a Web Worker — appealing for main-thread smoothness, but WebGL
context transfer across workers adds complexity that Principle VII does not justify at this stage.

---

## R9. Supabase schema and row-level security

**Decision**: Postgres tables `profiles`, `invitations`, `classrooms`, `enrolments`,
`projects`, `training_runs`, `lesson_progress`, `reflections`. Row-level security enabled on every
table, with no table left policy-less. Two schema-level guarantees enforce Principle I structurally
rather than by policy: **no table has a column capable of holding image or weight data**, and **no
table has a column capable of holding a learner's email address, date of birth, or real name**. Both
are asserted by inspecting `information_schema.columns`, so neither can be quietly reintroduced.

Educator access is resolved through a `SECURITY DEFINER` function
`is_educator_of(learner_id uuid) returns boolean` rather than a policy subquery that reads
`enrolments` directly, because a policy on `enrolments` that queries `enrolments` recurses.

There are no join codes. A learner is created inside her classroom by the invitation her educator
issued (R15), so `invitations.classroom_id` carries what a join code used to, and an entire mechanism
— generation, rotation, retirement, and the RPC that validated it — does not exist. Invitation codes
are short and human-typable, stored only as hashes, and never selectable by anyone including the
issuer.

The three roles are separated by what they can read, not by a flag the client could set. `role` and
`is_active` are not client-writable, so no account can promote itself. An administrator's read surface
is deliberately two tables wide — educator profiles and her own invitations — and returns zero rows
everywhere else.

**Rationale**: Row-level security is the only enforcement point a client-side application can rely
on, so the policies are the security model — hence their treatment as contracts with their own test
suite in `tests/db/`. Recursive-policy failure is the standard way multi-tenant Supabase schemas
break, and the definer function is the standard remedy.

Preferring a structural guarantee to a policy guarantee is the lesson of the previous revision of
this design, which gated every write on a consent state. That worked, but it required remembering to
add the gate to each new write policy — one forgotten table and the guarantee was silently gone. A
column that cannot exist needs nothing remembered.

**Alternatives considered**: *A `consent_state` write gate on every table* — the previous design;
correct but fragile in exactly the way described above, and now unnecessary since no learner personal
data is collected. *Plaintext invitation codes readable by the issuer* — convenient for showing a
code again later, but a readable table of live codes is a set of bearer credentials for entering
classrooms. *A single `user_data` JSONB table* — loses per-column policy granularity, which is what
P2, P3 and P6 depend on.

---

## R10. Local storage budget and eviction

**Decision**: Store JPEG at quality 0.8 and 224×224 (~15 KB per sample), plus a 512-float pooled
embedding (2 KB), giving roughly 17 KB per sample and ~1.7 MB per 100-sample project. Query
`navigator.storage.estimate()` before each capture burst, warn at 80% of the available quota,
refuse new captures at 95% with an offer to delete a project, and request
`navigator.storage.persist()` on first save so the browser is less likely to evict silently.

**Rationale**: Storing at the model's own input resolution means no information is discarded that
the model could have used, and it keeps a realistic classroom project comfortably inside even a
conservative quota. The reason to warn early and explicitly is FR-049 and FR-044: a learner losing
40 captured samples to a silent quota error mid-lesson is the worst failure this product can have,
because the loss is unrecoverable — by design, nothing was backed up.

**Alternatives considered**: Storing full-resolution captures — 10× the space for information the
model discards. Automatic eviction of the oldest project — silently destroys a learner's work.
Origin Private File System — better suited to large blobs, unnecessary at this scale.

---

## R11. Internationalisation

**Decision**: `react-i18next` with `en` as `fallbackLng`, `es` as the only other locale,
browser-language detection on first visit, and the choice persisted in `localStorage`. Namespaces
split by feature plus a `lessons` namespace. A Vitest test walks the `en` key tree and fails on any
key missing from `es`, and a lint rule forbids literal strings in JSX text positions.

**Rationale**: SC-005 demands zero untranslated strings, which is only maintainable if the build
enforces it — every project that relies on discipline here ends up shipping mixed languages. The
lesson content is the bulk of the translatable text, so it gets its own namespace and is lazy-loaded
per module rather than shipped in the initial bundle.

**Alternatives considered**: Hand-rolled context-based i18n — fewer dependencies, but no
pluralisation or interpolation and no ecosystem tooling. Shipping English first and retrofitting
Spanish — retrofits reliably leave hardcoded strings behind.

---

## R12. Design tokens and brand compliance

**Decision**: Tokens declared once in `src/styles/tokens.css` as CSS custom properties and mapped
into the Tailwind theme. Values taken from the Technovation public theme:

| Token | Value | Permitted use |
|---|---|---|
| `--tv-navy` | `#041e42` | Primary, dark surfaces, body text |
| `--tv-blue` | `#0076cf` | Actions, links |
| `--tv-orange` | `#ff7500` | Warm accent, calls to action |
| `--tv-amber` | `#ffbb1c` | **Fill, border, or background behind dark text only** |
| `--tv-magenta` | `#ec0089` | Vivid accent |
| `--tv-green` | `#43b02a` | **Fill, border, or background behind dark text only** |
| `--tv-sky` | `#5bc2e7` · `#7fbae7` · `#ade0f3` | Light support surfaces |

Typefaces **Poppins** (body and headings) and **Rubik** / **Rubik Mono One** (display),
self-hosted via `@fontsource`. A lint rule forbids hex literals and `font-family` declarations in
component files.

**Rationale**: Amber and green fail WCAG AA contrast against white for body text, so restricting
them to non-text roles is a correctness constraint, not a stylistic preference — encoding it in the
token table is what stops it being forgotten. Self-hosting the fonts avoids a third-party request on
the critical path and any question about Google Fonts and GDPR. Both families are open-licensed.

**Recorded gap**: these tokens were extracted from Technovation's public stylesheet, not from an
official brand manual, and **use of the Technovation logo or wordmark requires written confirmation
from the program before public release** (`TODO(TECHNOVATION_TRADEMARK)`). Colour and typography
choices are unaffected by that confirmation.

**Alternatives considered**: Tailwind-only theme without CSS custom properties — the heat-map canvas
and the lesson content need runtime access to the values. Fetching fonts from Google's CDN — extra
third-party request and an avoidable data-protection question.

---

## R13. Testing a camera-dependent application

**Decision**: Playwright with `--use-fake-device-for-media-stream` and
`--use-file-for-fake-video-capture` pointed at a committed Y4M fixture showing distinguishable
scenes, so an end-to-end run captures deterministic samples and trains a model whose accuracy is
predictable. Component tests inject a fake `MediaStream`. The ML core is tested in a node
environment against committed PNG fixtures with `tf.setBackend('cpu')` and a fixed seed.

Specific determinism guards: Grad-CAM is asserted against a stored reference map within a numeric
tolerance; occlusion is asserted to agree with a slow reference implementation that loops rather
than batching, which is the check that the batching optimisation did not change the answer.

**Rationale**: Testing the batched implementation against a naive loop is the highest-value test in
the suite. It is precisely the class of bug Principle VI exists for — a batching error yields a
heat map that still looks plausible, so nothing but a numeric comparison against a
known-correct-but-slow path will catch it.

**Alternatives considered**: Mocking the ML layer entirely in end-to-end tests — fast, but then
nothing tests the real integration. Requiring a physical camera in CI — not reproducible.

---

## R14. Deployment

**Decision**: Static build deployed to Netlify. Supabase URL and anon key injected as build-time
`VITE_`-prefixed variables. A strict Content-Security-Policy allowing `connect-src` to the Supabase
project only, `wasm-unsafe-eval` for the TensorFlow.js WASM backend, and no third-party origins.
Backbone weights and `@fontsource` files served as immutable, long-cached same-origin assets.

**Rationale**: The CSP is a second, independent enforcement of Principle I: with `connect-src`
restricted to Supabase and no other origin, there is no destination an image could be exfiltrated
to even if application code were compromised. `wasm-unsafe-eval` is unavoidable for the WASM
fallback and is scoped to that need. Netlify over GitHub Pages because Pages cannot serve custom
CSP headers, which this design depends on.

**Alternatives considered**: GitHub Pages — free and simple, but no custom headers, so no CSP.
Vercel or Cloudflare Pages — equally capable; the choice is not load-bearing and can change without
affecting anything else in this plan.

---

## R15. Provisioning an account on someone else's behalf

**Decision**: Every account is created by redeeming a single-use invitation. A `SECURITY DEFINER`
function issues the invitation, returning the code once to the issuer and storing only its hash. The
holder redeems it through the auth provider's ordinary registration call, which a second
`SECURITY DEFINER` function gates on a code that is valid, unexpired, unredeemed, and unrevoked. All
privileged logic lives in Postgres functions with an explicit `search_path`, inside the database the
BaaS already operates.

**Rationale**: Creating an account for another person requires privilege the caller does not have,
and there are only three places that privilege can live: a server the project runs, the auth
provider's internal tables, or the database's own definer functions. The third is the only one
compatible with Principle II — it introduces no new channel, no new deployable, and no secret that
has to reach the client. It is also the pattern this schema already uses for `is_educator_of`, so it
adds no new concept for a student contributor to learn.

Storing only the hash matters for the same reason password hashes matter: an invitation code is a
bearer credential for creating an account inside a named classroom. A leaked table of live codes
would let an outsider occupy a classroom.

**Alternatives considered**: *Writing directly into the auth provider's internal user table* from a
definer function — fewest moving parts, and it would allow an educator to set a learner's password
outright, but it depends on undocumented internal schema that the provider explicitly discourages
touching and may change in any upgrade, breaking account creation with no warning and no test to
catch it beforehand. *An Edge Function holding a `service_role` key* — the officially supported route
and the most robust of the three, but it is server-side code the project writes, deploys, and
operates, which Principle II forbids; adopting it would have required either a Complexity Tracking
justification or a further constitution amendment. *A shared classroom password* — trivial to
distribute and impossible to attribute work to a person, so it defeats the educator dashboard.

---

## R16. Learner identity without an email address

**Decision**: A learner is identified by an educator-assigned username, unique system-wide, plus a
self-chosen alias, unique within her classroom. Because the auth provider requires an
address-shaped identifier, one is derived deterministically from the username in a domain reserved
by RFC 2606 as permanently non-resolvable. Email confirmation is disabled for these accounts. The
derived identifier is never displayed, never sent to, and is not a means of contact.

**Rationale**: This is what makes "the application holds no personal data about a minor" literally
true rather than a policy claim, and it is the whole basis of the project's data-protection position.
A reserved non-resolvable domain is chosen over a plausible-looking one precisely so that no
misconfiguration can ever cause mail to be delivered somewhere real.

**Consequence, accepted deliberately**: a learner has no self-service password recovery. There is no
address to send a reset to, so recovery runs through her educator, who issues a fresh single-use
code. This is a real cost — a learner locked out between sessions depends on an adult being
available — and it is the price of holding no contact detail. The interface must state it plainly
rather than letting her hunt for a "forgot password" link that cannot exist, and she keeps the
unauthenticated local lab in the meantime.

**Alternatives considered**: *Optional learner email* — restores self-service recovery but
reintroduces personal data for a minor and, with it, the consent question this design exists to
avoid. *Educator sets the password directly* — no lockout risk at all, but the educator then knows a
credential belonging to a child, which is worse than the inconvenience it removes. *Username with no
auth-provider account, authenticated by a custom function* — avoids the synthetic identifier
entirely, but means implementing session issuance by hand, which is far more dangerous than a
cosmetic workaround.

---

## Deferred to legal review

Recorded here so it is not mistaken for a solved problem:

1. **Data-controller split.** The school or program that provisions learner accounts is the data
   controller for those learners; this project provides the processor. What the project must disclose
   to a school before that school creates accounts for its minors, and how the responsibility is
   documented between them, is a legal question this plan does not answer. Recorded as
   `TODO(CONTROLLER_AGREEMENT)` in the constitution.

It blocks public launch and blocks nothing in this plan.

**Closed**: the two consent items previously recorded here — the applicable digital-consent age and
the strength of the guardian-consent mechanism — no longer exist. The application collects no learner
personal data, so there is nothing to consent to inside it and no age threshold to resolve.
`TODO(CONSENT_MECHANISM)` is closed in the constitution.
