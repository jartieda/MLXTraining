# Feature Specification: Lab LLM

**Feature Branch**: `002-lab-llm`

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description: "Nueva funcionalidad como pestaña junto a Laboratorio, renombrando Laboratorio a Lab CV. Nueva pestaña Lab LLM con chat sandbox interactivo (Lexi), botón '¿Por qué dijiste esto?' y panel de explicabilidad con heatmap de atención/palabras clave, confianza y fuentes. Ruta de 9 ejercicios progresivos para aprender XAI con LLMs y contenido ético."

## User Scenarios & Testing *(mandatory)*

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

## Learning Path Content *(mandatory)*

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

## Edge Cases

- Respuesta de Lexi sin metadatos de explicación: el panel debe mostrar estado degradado y mensaje claro, nunca vacío.
- Confianza alta en respuesta incorrecta: el sistema debe explicitar que confianza no implica veracidad.
- Fuentes contradictorias: se debe mostrar conflicto en lugar de una síntesis engañosa.
- Modo offline o fallo de red: sandbox disponible con ejemplos locales y aviso de limitaciones.
- Mensajes ofensivos o inseguros del usuario: aplicar guardrails pedagógicos y redirección segura.

## Requirements *(mandatory)*

### Functional Requirements

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

## Success Criteria *(mandatory)*

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
