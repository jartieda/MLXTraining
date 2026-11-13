# Feature Specification: Lab LLM

**Feature Branch**: `002-lab-llm` (merged into `001-xai-lab`)

**Created**: 2026-10-16

**Status**: Implemented — XAI learning path (comparator, word lens, self-report check, missions) on top of the original baseline; parts of the original roadmap remain deferred

**Input**: Actual code in `src/features/llmLab/` as of 2026-11-12, and the plan in [`docs/plan_lab_llm_xai.md`](../../docs/plan_lab_llm_xai.md). The original product vision below remains the roadmap where not yet implemented.

## Current Implementation Snapshot *(verified against code, 2026-11-12)*

This section is the source of truth for what the application currently does. The original nine-exercise vision and its requirements below are not claims of shipped functionality unless the status table says so.

### Scope and constraints

- Only `/lab-llm` (`src/features/llmLab/`, `src/locales/{en,es}/llm.json`). Login and the Lab CV are untouched by this feature.
- **The engine is not modified.** `llmEngine.ts` and `webllm.ts` expose `nextTokenAlternatives(prompt, assistantPrefix, signal)` (real probabilities of the top 3 next tokens), `generate(messages, maxTokens, signal)` (greedy, no randomness) and `unload()`. Everything below is built on those three calls. What they cannot support is shipped as a clearly labelled mock-up.
- **Audience:** learners aged 14 and over. Direct language, everyday examples (social media, school, work, music). The sentiment example is kept verbatim: «Hoy he perdido mi chaqueta favorita, pero mi amiga me ha ayudado a encontrarla y ahora estoy contenta.»
- **Honest numbers:** whole percentages in the main view; a value outside the reported top 3 is shown as «no está entre las 3 primeras» / «not measured», never as 0 %; a value that fell out of the top 3 is reported as a lower bound («al menos»).
- **Local only:** inference runs in the browser; experiments, mission progress and the project card are stored in IndexedDB on the device and never sent anywhere.

### Page structure

- **Model and engine controls at the top**, shared by every tab: model (Gemma, Llama, Qwen), engine (GPU via WebLLM, CPU via Transformers.js + ONNX WebAssembly), load status, error and retry. GPU is the default; there is no automatic CPU fallback. The exact model name (for example «Gemma 2 · 2B») is shown with every result. Model controls are locked while a comparison, lens or audit is running.
- **Three tabs** (`role="tablist"`), the same three as the Lab CV: «Herramientas» (tools to use with your own texts), «Retos» (prepared cases) and «Misiones». Each of the first two opens with a one-line intro. Panels stay mounted (hidden, not unmounted), so switching tab never discards a result.
- The shared structure and the home page that explains it are specified in [`001-xai-lab/spec.md`](../001-xai-lab/spec.md), «Session 2026-11-12».

### Tab «Herramientas»

- **¿Qué palabra viene después?** — bounded top-k word search (3 candidates per step, beam 9, depth 8, at most 36 queries) with up to three complete-word candidates. Simple view by default: whole percentages («< 1 %» below one percent); the token products, path sums and `␣` marks are behind «Ver el cálculo». Stop button; a stopped search keeps what it found.
- **A/B comparator** (`compare/ComparePanel.tsx`). Two modes:
  - *Dos prompts, un modelo*: prompts A and B, a word-level diff that highlights what changed and warns (without blocking) above 2 changed words; «Copiar A en B» and «Volver al ejemplo».
  - *Un prompt, dos modelos*: run the prompt on the loaded model, switch model at the top (the result is kept), run it again. The second run is disabled while the same model is still loaded. Result columns are titled with the model names.
- **Bet before running** («¿Cambiará la respuesta?»: Sí / No / No lo sé), echoed in the verdict.
- **Three result layers**:
  - *Siguiente palabra*: `findWordCandidates` on both prompts.
  - *Probabilidad de cada opción*: `scoreOptions` appends the options and «Responde solo con la letra de la opción», reads option letters from the top-3 first tokens and adds up spellings of the same letter. Rows are aligned by answer text, not by letter, so swapping the option order compares the same answer. If more than 50 % of the reported mass is not an option letter, a warning says the percentages mean little.
  - *Respuesta completa*: `generate` on both prompts with a word-level diff of the answers.
- **Verdict «¿Ha cambiado?»** with bands *Casi igual* (< 5 points), *Cambio pequeño* (5–20) and *Cambio grande* (≥ 20, or the most likely answer is a different one, or A's top answer is no longer measured in B); free-text answers are banded by the share of words that differ. A sentence per case (sentiment, bias, prompt change, hallucination, two models). «Ver el cálculo» lists the raw tokens and probabilities.
- **Nine prepared cases**: sentiment (chaqueta «contenta → cansada»; irony with the phone before the exam), bias (Lucía/Javier for a web-developer job; «Mi jefe/jefa es muy…»), prompt changes (tone, negation, option order) and hallucination (Rosalía and the Nobel; permission to say «no lo sé»).
- **Saved experiments**: «Guardar experimento» stores case, model(s), prompts, bet, band and the verdict sentence; the 10 most recent are listed and can be deleted.
- **Audit of 5 name pairs** (under the name-bias case): the same application with Lucía/Javier, Fátima/Lucía, Wei/Javier, Aisha/Marta and Mohamed/Pablo (10 queries). Table of P(«Sí») per name and difference in points; verdict with the mean absolute difference, the largest pair and how many pairs move 5 points or more. Progress bar and stop; a stopped audit is not summarised.
- **Word lens** (`compare/WordLens.tsx`): occlusion for text on the sentiment question. One query with the whole text, then one per word with that word removed (18 words → 19 queries, announced before running), with progress and stop. Impact = points the original answer loses without the word; a lower bound when the answer leaves the top 3. Words are coloured in three steps of one colour relative to the strongest word; words that barely matter stay uncoloured; words that push against the answer get a dashed underline. A text summary names the strongest word, the top words and the words against. Refuses to measure (with a message) if the whole text gets no option letter.
- **«¿Dice la verdad sobre sí mismo?»**: after the lens, the model is asked for the 3 exact words that influenced it, in quotation marks. Quotes are extracted («…», "…", “…”), kept only if they are in the text, and compared with the lens's top words. Bands as in the Lab CV: *Coinciden*, *Coinciden en parte*, *No coinciden*, or *No se puede comparar* when nothing is quoted. Closing lesson: what the model says is an explanation it wrote; the lens is a measurement.
- **«Repetir 5 veces» — mock-up.** Dashed card marked «Próximamente», five empty slots and a disabled button, with the reason: generation has no randomness, so five repetitions would be identical.

### Tab «Retos»

- **Prompt exercises** (`ReasoningChat`), the prepared challenges: general question (example: «Valora del 1 al 10 lo científica que es esta película: Avengers»), sentiment (chaqueta example; the question is appended automatically and the model is asked to quote the exact words that influenced it), text bias (VillaArriba/VillaAbajo), and «Intenta engañar al modelo» (Rosalía's age), which keeps the last 4 turns of conversation. Each answer has a separately generated, model-written explanation behind «Ver cómo lo explica», caveated as a plausible text and not a trace of internal computation. Stop button in every exercise.
- The maths tutor and its «Extras» block were removed (merge `67d20e0`); the `tutor` variant still exists in `ReasoningChat` but is not rendered.
- The comparator's nine prepared cases stay inside the comparator in «Herramientas», as starting points for the tool.

### Tab «Misiones»

- Seven missions: ¿Qué palabra viene después?; Cambia una sola cosa; La lupa de palabras; ¿Dice la verdad sobre sí mismo?; ¿Importa el nombre?; ¿Se lo ha inventado?; Ficha XAI de tu proyecto. Each has «Qué haces», «Reto», a question for thinking with an answer box, and «He conseguido el reto». A progress bar counts completed missions.
- «Ir a…» opens «Herramientas», selects the prepared case the mission needs and scrolls to the tool.
- Mission 7 is a four-part XAI card (it overlaps with the home page's «Tu proyecto y la XAI», see D014) for the learner's own project (what the app decides, who it affects, which bias was tested, what explanation users will get). «Descargar ficha» saves a Markdown file with the card, the answered mission questions and the saved experiments; the mission is completed when all four parts are filled in.
- Answers are saved when the box loses focus; ticks are shown immediately and saved in a transaction.

### Storage

- IndexedDB database `ml4g-llm-lab`, separate from the Lab CV's database: version 1 `experiments`; version 2 adds `missions` and `projectCard` without touching saved experiments.

### Testing

- Unit: word search; model mapping and deployment policy; engine stop/serialisation; `scoreOptions`, `diffWords`, `compareScored` and bands; experiment store; word lens and self-report check; audit; missions store and card Markdown; locale parity.
- E2E (`tests/e2e/lab-llm-compare.spec.ts`, `tests/e2e/lab-llm-missions.spec.ts`), desktop and 360 px, with a fake engine injected through `window.__ML4G_FAKE_LLM_ENGINE__` so no model download is needed: big change on the sentiment example, diff warning, «not measured» instead of 0 %, position bias with swapped options, stereotypes and saving, stopping a free-text comparison, the lens and the self-report check, stopping the audit, two models, the mock-up, missions navigation to «Herramientas», persistence after reload, card download, the removed Extras block, no horizontal scrolling.
- Not verified with real models in this round (the model CDN was not reachable from the development network). Small models may not answer with a letter; the interface then shows warnings instead of percentages.

### Current Acceptance Scenarios

1. **Choose a local engine and model**: model/backend controls are visible above the tabs, readiness and loading progress are conveyed, and an unavailable WebGPU engine reports a recoverable error without silently switching backend.
2. **Inspect next-word alternatives**: a prompt yields up to three complete-word candidates in whole percentages; «Ver el cálculo» shows the explored token paths.
3. **Run an explanatory exercise** (tab «Retos»): the general, sentiment, bias and deception variants return an answer and allow the model-written explanation to be revealed with an explicit caveat; any generation can be stopped.
4. **Compare two prompts**: given A and B that differ in one word, the comparator highlights the change, runs both on the same model without randomness, aligns the answers on one scale and gives a «¿Ha cambiado?» band and a case-specific sentence; an unmeasured option reads «no está entre las 3 primeras».
5. **Detect position bias**: with the options reversed in B, results are compared by answer, so a model that keeps choosing the same letter shows a big change.
6. **Use the word lens**: on the chaqueta example the lens announces 19 queries, can be stopped, colours the words and names in text the word whose removal lowers the original answer most.
7. **Check the self-explanation**: after the lens, asking the model for its 3 influential words produces a *Coinciden / Coinciden en parte / No coinciden / No se puede comparar* band with both lists side by side.
8. **Audit a bias**: the five-pair audit fills a table, reports the mean difference and the largest pair, and can be stopped without producing a partial summary.
9. **Compare two models**: in «Un prompt, dos modelos», the first result survives switching model; the second run is blocked until a different model is loaded.
10. **Follow the missions**: progress and answers survive a reload; «Ir a…» opens «Herramientas» with the right tool and case; the project card downloads as Markdown and completes mission 7 when all four parts are filled in.
11. **Use examples and translations**: every visible string exists in English and Spanish with matching keys.

### Status of the original requirements

| Requirement | Status | Notes |
|---|---|---|
| FR-LLM-001/002/003 (navigation) | Done | «Lab CV» and «Lab LLM» in the main navigation. |
| FR-LLM-004/005/006 (chat with Lexi, per-answer «why», multi-turn) | Partly | No «Lexi» persona. Each answer has «Ver cómo lo explica»; only «Intenta engañar al modelo» keeps history (4 turns). |
| FR-LLM-007 (side panel) | Not done | Explanations open inline. |
| FR-LLM-008 (heat map / attention) | Replaced | No attention weights are exposed. The word lens measures occlusion impact instead and does not call it attention. |
| FR-LLM-009 (confidence) | Partly | Real probabilities of option letters and next words; no global confidence score. |
| FR-LLM-010 (sources) | Not done | No retrieval. |
| FR-LLM-011, 017 (limits of explanations) | Done | Caveats on model-written explanations; «¿Dice la verdad sobre sí mismo?». |
| FR-LLM-012/013 (progressive path) | Replaced | Seven missions with challenge and question for thinking instead of nine exercises. |
| FR-LLM-014 (progress persistence) | Partly | Local to the device; not synced to accounts. |
| FR-LLM-015 (en/es) | Done | Locale parity test. |
| FR-LLM-016 (hallucination, bias, prompt injection, grounding) | Partly | Hallucination, bias and prompt fragility covered; prompt injection and grounding not covered. |
| FR-LLM-018 (responsible use) | Partly | Case notes and mission questions; no dedicated reminders. |
| FR-LLM-019–024, 033, 034 (fixed 88/8/4 exercise, attention tooltips) | Not done | Real model probabilities are used instead of simulated ones. |
| FR-LLM-025–028 («Mis Proyectos» home) | Partly | The «Inicio» page explains how the site works, the XAI theory and the project questions, and links to both labs and the learning questionnaire (see 001-xai-lab); there is no «Mis Proyectos» route. |
| FR-LLM-029–032 (local models, load status, next words) | Done | Plus a CPU engine. |
| NFR-LLM-002 (360 px) | Done | Checked in E2E. |
| NFR-LLM-001, 003, 004 | Not verified | No load-time measurement, automated accessibility audit or offline mode for the LLM lab. |

## Original User Scenarios *(deferred product vision; not current acceptance criteria)*

The following scenarios were written for the initial product proposal. They describe future scope where they conflict with the Current Implementation Snapshot.

### User Story 1 - Navegar entre Lab CV y Lab LLM (Priority: P1)

Como estudiante, quiero ver una nueva pestaña `Lab LLM` junto a `Lab CV` para entender que ahora existen dos laboratorios: visión por computador y modelos de lenguaje.

**Why this priority**: Es la puerta de entrada. Si la navegación no es clara, el laboratorio LLM no se descubre.

**Independent Test**: Se valida sin depender del chat ni de ejercicios, solo con routing y navegación.

**Acceptance Scenarios**:

1. **Given** un usuario en la app, **When** ve la navegación principal, **Then** aparece `Lab CV` (renombrado desde `Laboratorio`) y `Lab LLM` como pestaña adyacente.
2. **Given** un usuario en `Lab CV`, **When** pulsa `Lab LLM`, **Then** se navega a la nueva vista sin perder el estilo visual existente.
3. **Given** un usuario en móvil, **When** abre el menú de navegación, **Then** ambas pestañas son visibles y accesibles por teclado y lector de pantalla.

---

### User Story 1b - Mis Proyectos como página de inicio XAI (Priority: P1)

Como estudiante, quiero que `Mis Proyectos` funcione como página de inicio para entender que existen dos lecciones/laboratorios de XAI según la tecnología (CV y LLM) y por qué la XAI es importante.

**Why this priority**: Define el punto de entrada pedagógico y orienta la navegación desde el primer minuto.

**Independent Test**: Se valida sin depender de chat ni ejercicios, solo con contenido y enlaces de entrada.

**Acceptance Scenarios**:

1. **Given** un usuario abre `/projects`, **When** carga la vista, **Then** aparece una introducción breve sobre la importancia de la XAI para decisiones transparentes y responsables.
2. **Given** la página de inicio de `Mis Proyectos`, **When** revisa la sección de rutas, **Then** ve dos bloques diferenciados: `Lab CV` y `Lab LLM` con explicación de la tecnología de cada uno.
3. **Given** un usuario elige una ruta desde `Mis Proyectos`, **When** pulsa el CTA correspondiente, **Then** navega al laboratorio correcto sin ambiguedad.

---

### User Story 2 - Conversar con Lexi en el Chat Sandbox (Priority: P1)

Como estudiante, quiero conversar con el robot `Lexi` para explorar respuestas de un LLM que se ejecuta en el navegador con WebLLM, de forma segura y educativa.

**Why this priority**: Es el núcleo interactivo del Lab LLM.

**Independent Test**: Puede probarse completamente en el navegador, sin depender de servidores externos.

**Acceptance Scenarios**:

1. **Given** un usuario en `Lab LLM`, **When** escribe un mensaje y envía, **Then** Lexi responde en el hilo de chat.
2. **Given** una respuesta de Lexi, **When** el mensaje se renderiza, **Then** incluye el botón `¿Por qué dijiste esto?`.
3. **Given** un mensaje largo o varias rondas, **When** se navega por el chat, **Then** se mantiene legible y usable en desktop y móvil.
4. **Given** el laboratorio se abre por primera vez, **When** el modelo no está descargado todavía, **Then** la interfaz muestra una carga local progresiva y explica que el motor se ejecuta en el navegador.

---

### User Story 2b - Elegir modelo pequeño para ejecutar en el navegador (Priority: P1)

Como estudiante, quiero elegir entre tres modelos pequeños para ver cómo cambia la respuesta y entender que el comportamiento depende del modelo.

**Why this priority**: Hace visible que la explicación depende de la arquitectura y del modelo, no solo del texto.

**Independent Test**: Se valida cambiando entre los 3 modelos sin salir del navegador.

**Acceptance Scenarios**:

1. **Given** el usuario abre Lab LLM, **When** ve el selector de modelo, **Then** puede elegir entre `Gemma`, `Llama` y `Qwen (Alibaba)`.
2. **Given** un modelo seleccionado, **When** el usuario cambia a otro, **Then** el laboratorio recarga el motor WebLLM localmente y mantiene el historial del chat.
3. **Given** un modelo pequeño seleccionado, **When** el usuario pide una respuesta, **Then** la salida refleja ese modelo sin requerir conexión a un servicio remoto de inferencia.

---

### User Story 3 - Explicar cada respuesta con panel lateral XAI (Priority: P1)

Como estudiante, quiero abrir un panel explicativo por respuesta para entender evidencia, confianza y contexto de una salida de LLM.

**Why this priority**: Convierte el chat en una experiencia de XAI, no solo de conversación.

**Independent Test**: Se prueba por cada respuesta de Lexi, sin depender de la ruta de ejercicios.

**Acceptance Scenarios**:

1. **Given** una respuesta de Lexi, **When** el usuario pulsa `¿Por qué dijiste esto?`, **Then** se abre panel lateral con visual de atención/palabras clave resaltadas.
2. **Given** el panel abierto, **When** se muestran métricas, **Then** aparece porcentaje de confianza (ejemplo: 95%) con explicación en lenguaje simple.
3. **Given** el panel abierto, **When** se muestran fuentes, **Then** aparece una lista de fragmentos de contexto consultados o una indicación explícita de "sin contexto externo".
4. **Given** lector de pantalla, **When** el panel se abre, **Then** su contenido es navegable y con etiquetas comprensibles.
5. **Given** una respuesta con varias palabras candidatas, **When** el usuario revisa el detalle de generación, **Then** ve una lista de las siguientes palabras posibles con sus probabilidades relativas.

---

### User Story 4 - Completar ruta de 9 ejercicios progresivos (Priority: P2)

Como estudiante, quiero una secuencia guiada de ejercicios para aprender gradualmente conceptos de LLM, XAI y ética.

**Why this priority**: Estructura el aprendizaje y conecta práctica con reflexión.

**Independent Test**: Se valida módulo por módulo con progreso persistente.

**Acceptance Scenarios**:

1. **Given** un usuario en Lab LLM, **When** abre la ruta, **Then** ve 9 ejercicios con estado (no iniciado, en progreso, completado).
2. **Given** un ejercicio, **When** completa pasos requeridos, **Then** se marca como completado y se guarda progreso.
3. **Given** un ejercicio con reflexión ética, **When** envía su respuesta, **Then** queda almacenada y editable.

---

### User Story 5 - Entender riesgos éticos y límites del modelo (Priority: P2)

Como estudiante, quiero practicar casos de alucinación, sesgo, prompt injection y verificación de fuentes para usar LLMs de forma responsable.

**Why this priority**: El componente ético es requisito explícito del feature.

**Independent Test**: Se valida con casos guiados y criterios de logro por ejercicio.

**Acceptance Scenarios**:

1. **Given** un ejercicio de prompt injection, **When** el estudiante prueba una entrada maliciosa, **Then** el sistema muestra señales de riesgo y mitigaciones.
2. **Given** un ejercicio de sesgo laboral, **When** compara respuestas, **Then** identifica sesgo potencial con explicación guiada.
3. **Given** un ejercicio de grounding/citas, **When** evalúa fuentes, **Then** puede distinguir respuesta bien fundamentada de una alucinada.

---

## Original Learning Path Proposal *(deferred roadmap; not implemented)*

La ruta inicial incluye los 9 ejercicios solicitados:

1. **Probabilidad de salida**: completar frase (`El perro vio al gato y [corrió/maulló/voló]`) con lectura de probabilidades de la siguiente palabra token a token.
2. **Lupa de atención**: visual de self-attention en palabras clave.
3. **Prompt tuning**: cambiar prompt y comparar cambios en pesos/importancia.
4. **Mentiras y Prompt Injection**: entradas engañosas (`El cielo es verde...`) y defensa.
5. **Chain of Thought en cómic**: visualizar razonamiento por pasos en formato pedagógico (sin exponer razonamientos inseguros en producción).
6. **Clasificación y sentimiento**: felicidad/tristeza con explicación de evidencia textual.
7. **Descubrir la alucinación**: detectar afirmaciones no soportadas.
8. **Sesgos en evaluación laboral**: identificar lenguaje o decisiones sesgadas.
9. **Fuentes y citas (Grounding/RAG)**: evaluar calidad de fuentes y trazabilidad de citas.

Detalle obligatorio del Ejercicio 1 (versión infantil):

- Debe permitir seleccionar una opción sugerida o escribir una continuación libre para: `El perro vio al gato y [opción]`.
- Debe mostrar las siguientes palabras candidatas del modelo con probabilidad y permitir compararlas entre sí.
- Debe ofrecer como ejemplo inicial tres opciones pequeñas con probabilidades visibles, pero el comportamiento esperado es general: top-k candidatos con peso relativo por modelo.
- Debe mostrar una barra animada por opción con colores llamativos y texto porcentual visible.
- Debe incluir una explicación animada en lenguaje sencillo indicando por qué `corrió` es más probable por la relación semántica con `perro` y `gato`.

Detalle obligatorio del Ejercicio 2 (Lupa de Atención):

- Debe aceptar un texto de entrada y resaltar cada palabra con fondo cuya opacidad dependa de su peso de atención en rango `[0.0, 1.0]`.
- Al pasar el ratón por una palabra resaltada, debe mostrarse tooltip infantil: `Lexi prestó un [X]% de atención a esta palabra`.
- En móvil (sin hover), el mismo mensaje debe aparecer por tap/foco para mantener equivalencia de accesibilidad.

Ejercicios opcionales propuestos (extensión futura):

- **E10 - Consistencia temporal**: comprobar si el modelo se contradice en turnos largos.
- **E11 - Privacidad y datos sensibles**: detectar y evitar fuga de datos personales en prompts.

## Original Edge Cases *(roadmap considerations)*

- Respuesta de Lexi sin metadatos de explicación: el panel debe mostrar estado degradado y mensaje claro, nunca vacío.
- Confianza alta en respuesta incorrecta: el sistema debe explicitar que confianza no implica veracidad.
- Fuentes contradictorias: se debe mostrar conflicto en lugar de una síntesis engañosa.
- Modo offline o fallo de red: sandbox disponible con ejemplos locales y aviso de limitaciones.
- Mensajes ofensivos o inseguros del usuario: aplicar guardrails pedagógicos y redirección segura.

## Original Requirements *(deferred roadmap unless covered by the Current Implementation Snapshot)*

### Functional Requirements

The following requirements capture the original target. They are not acceptance claims for the current implementation; use the Current Implementation Snapshot above to determine shipped behavior.

**Navigation and IA lab structure**

- **FR-LLM-001**: La navegación principal MUST renombrar `Laboratorio` a `Lab CV`.
- **FR-LLM-002**: La navegación principal MUST incluir una nueva pestaña `Lab LLM` junto a `Lab CV`.
- **FR-LLM-003**: La nueva pestaña MUST respetar tokens visuales, tipografía y patrones de interacción existentes.

**Chat sandbox**

- **FR-LLM-004**: Lab LLM MUST ofrecer un chat interactivo con asistente `Lexi`.
- **FR-LLM-005**: Cada respuesta de Lexi MUST renderizar el botón `¿Por qué dijiste esto?`.
- **FR-LLM-006**: El chat MUST soportar múltiples turnos y mantener historial en sesión.
- **FR-LLM-029**: El chat MUST ejecutarse en el navegador usando WebLLM, sin requerir inferencia remota para responder.
- **FR-LLM-030**: El usuario MUST poder elegir entre tres modelos pequeños: `Gemma`, `Llama` y `Qwen (Alibaba)`.
- **FR-LLM-031**: El laboratorio MUST mostrar el estado de carga local del modelo cuando WebLLM se está preparando en el navegador.
- **FR-LLM-032**: Cada respuesta MUST poder mostrar las siguientes palabras posibles con sus probabilidades relativas.

**XAI panel for responses**

- **FR-LLM-007**: Al pulsar `¿Por qué dijiste esto?` MUST abrirse un panel lateral por respuesta.
- **FR-LLM-008**: El panel MUST mostrar heatmap/atención o resaltado de palabras clave.
- **FR-LLM-009**: El panel MUST mostrar porcentaje de confianza/probabilidad de salida.
- **FR-LLM-010**: El panel MUST mostrar fuentes o fragmentos de contexto consultados, o indicar ausencia.
- **FR-LLM-011**: El panel MUST incluir texto explicativo de limitaciones de la explicación.

**Progressive exercises**

- **FR-LLM-012**: Lab LLM MUST incluir una ruta de 9 ejercicios progresivos.
- **FR-LLM-013**: Cada ejercicio MUST tener objetivo, pasos, criterio de completitud y reflexión ética.
- **FR-LLM-014**: El progreso MUST persistir por usuario autenticado y quedar local para visitante.
- **FR-LLM-015**: El contenido de ejercicios MUST estar disponible en `en` y `es`.
- **FR-LLM-019**: El Ejercicio 1 MUST permitir elegir o escribir la continuación de `El perro vio al gato y [opción]`.
- **FR-LLM-020**: El Ejercicio 1 MUST simular probabilidades con distribución base `corrió` 88%, `maulló` 8%, `voló` 4%.
- **FR-LLM-021**: El Ejercicio 1 MUST renderizar una barra de progreso animada por opción, con colores de alto contraste y porcentaje legible.
- **FR-LLM-022**: El Ejercicio 1 MUST mostrar explicación animada y en lenguaje infantil de por qué `corrió` es más probable por contexto (`perro`, `gato`).
- **FR-LLM-023**: El Ejercicio 2 MUST implementar lupa de atención por palabra con opacidad proporcional al peso `[0.0, 1.0]`.
- **FR-LLM-024**: El Ejercicio 2 MUST mostrar tooltip por hover/foco/tap con el texto `Lexi prestó un [X]% de atención a esta palabra`.
- **FR-LLM-033**: La visualización de atención MUST poder derivarse de la generación local del modelo y presentarse palabra por palabra.
- **FR-LLM-034**: La interfaz MUST permitir explorar la atención por hover, foco y tap sin perder el estado de la explicación.

**Projects as pedagogical home**

- **FR-LLM-025**: La ruta `Mis Proyectos` MUST actuar como página de inicio pedagógica de XAI.
- **FR-LLM-026**: La página de inicio de `Mis Proyectos` MUST explicar por qué la XAI es importante en lenguaje accesible para estudiantes.
- **FR-LLM-027**: La página de inicio de `Mis Proyectos` MUST presentar dos rutas/lecciones de XAI según tecnología: `Lab CV` y `Lab LLM`.
- **FR-LLM-028**: Cada ruta en `Mis Proyectos` MUST incluir CTA claro al laboratorio correspondiente.

**Ethics and safety**

- **FR-LLM-016**: El laboratorio MUST cubrir explícitamente alucinación, sesgo, prompt injection y grounding.
- **FR-LLM-017**: El laboratorio MUST evitar presentar explicaciones como verdad absoluta del modelo.
- **FR-LLM-018**: El laboratorio MUST incluir recordatorios de uso responsable en actividades de riesgo.

### Non-Functional Requirements

- **NFR-LLM-001**: Primera carga de la ruta `Lab LLM` con lazy loading y skeleton en menos de 3 s en dispositivo medio.
- **NFR-LLM-002**: Interfaz responsive usable en 360 px y desktop >= 1280 px.
- **NFR-LLM-003**: Cumplir WCAG 2.1 AA en navegación, foco, contraste y lector de pantalla.
- **NFR-LLM-004**: Modo degradado funcional con contenido local cuando no haya proveedor LLM disponible.

## Original Success Criteria *(not yet validated; deferred roadmap)*

### Measurable Outcomes

- **SC-LLM-001**: 100% de respuestas de Lexi muestran botón `¿Por qué dijiste esto?` en pruebas E2E.
- **SC-LLM-002**: En al menos 95% de interacciones, el panel lateral abre en < 300 ms tras clic.
- **SC-LLM-003**: 100% de los 9 ejercicios tienen traducción completa en `en` y `es` validada por test.
- **SC-LLM-004**: Al menos 80% de participantes piloto completa 6/9 ejercicios en una sesión guiada.
- **SC-LLM-005**: Pruebas de accesibilidad automáticas sin violaciones críticas en ruta `Lab LLM`.
- **SC-LLM-006**: En E2E del Ejercicio 1, la distribución visible de probabilidades coincide con `88/8/4` para las opciones base.
- **SC-LLM-007**: En E2E del Ejercicio 2, el tooltip infantil aparece en hover de escritorio y foco/tap en móvil para cualquier palabra resaltada.
- **SC-LLM-008**: La página `Mis Proyectos` muestra la explicación de importancia de XAI y los dos accesos `Lab CV` y `Lab LLM` en desktop y móvil.
- **SC-LLM-009**: El usuario puede cambiar entre los 3 modelos pequeños sin salir del navegador y ver un cambio observable en las sugerencias de la siguiente palabra.
- **SC-LLM-010**: En al menos 95% de las respuestas de prueba, el laboratorio muestra un top-k de siguientes palabras con probabilidades y la lupa de atención correspondiente.
