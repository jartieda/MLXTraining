# Explainable AI Lab (Technovation): análisis y propuesta de mejoras

Fecha: 2026-11-02 · Fuentes: póster JENUI «Evaluación de la necesidad de técnicas XAI en un proyecto de tecnología y emprendimiento juvenil», `spec_cvlab.md`, `spec_llmlab.md` y la web desplegada (analizada a partir de su bundle JS: rutas, textos ES/EN, módulos).

---

## 1. Qué dice el póster y qué implica para la web

| Hallazgo del póster | Implicación para el laboratorio |
|---|---|
| 6.447 proyectos (2024–2025); uso de IA del 26,3 % al 40,9 %, IA generativa del 37,7 % al 67,7 % | Las participantes ya usan IA: el laboratorio debe enseñar a *cuestionarla*, no solo a usarla. |
| Tecnologías: **LLM 42,6 %**, **sistemas de recomendación 15,2 %**, **visión por computador 10,5 %** (también análisis de sentimiento y predictivo) | Hoy hay labs para la 1.ª y la 3.ª tecnología, pero **no para la 2.ª**. El Lab LLM es el que más alumnas va a tocar y es el menos desarrollado. |
| XAI Score de 1 a 5 (criticidad del dominio, opacidad del modelo y vulnerabilidad de la usuaria); media de 2,95 en 2024 y 2,89 en 2025; mediana de 3 | El XAI Score puede ser una **actividad de entrada**: cada alumna puntúa su propio proyecto y el laboratorio le recomienda una ruta. |
| ODS más frecuentes: salud (3), educación (4) y consumo responsable (12). Puntuaciones más altas en «Paz y Justicia» (3,82) y «Salud» (3,46) | Los ejemplos de los ejercicios deberían salir de esos dominios, no de ejemplos neutros. |
| Sensibilidad hacia la inclusión, los sesgos de género y la seguridad personal | El módulo de sesgos debe trabajar **sesgo de género con contrafactuales**, que es el tema que ya les interesa. |
| Conclusión: hay una brecha entre la adopción y el análisis crítico; hace falta XAI desde etapas tempranas (LIME, SHAP y mapas de activación) | Cada lab debería enseñar **la misma idea transversal**: una explicación por perturbación (como LIME u oclusión) frente a otra explicación, y luego comparar si coinciden. |

---

## 2. Estado actual de la web (verificado en el bundle)

**Rutas:** `/`, `/projects`, `/lab/:projectId`, `/lab-llm`, `/lessons`, `/lessons/:moduleId`, `/classroom`, `/admin`, `/login`, `/redeem`, `/reset`.

**Lab CV (muy completo y coherente con su spec):** captura y subida de fotos, entrenamiento en el dispositivo con 3 ajustes, matriz de confusión, aviso de desequilibrio, comparación de entrenamientos, Grad-CAM a 7×7 o 14×14, oclusión, puntuación de coincidencia, veredicto, exportación y descripción en palabras del mapa de calor. Textos excelentes («la discrepancia es el hallazgo», «evidencia, no motivo»).

**Ruta de aprendizaje:** 7 módulos, **todos de CV**: `what-the-model-sees`, `reading-a-heat-map`, `shortcuts-and-bias`, `fooling-the-model`, `comparing-explanations`, `imbalance-experiment` y `final-presentation`. Tienen pasos, reto, prerrequisitos verificables y reflexiones que se guardan y ve la educadora.

**Lab LLM:** un sandbox con top-3 de palabras candidatas mediante productos de probabilidades de tokens, los modelos Gemma, Llama y Qwen, y un motor GPU (WebLLM) o CPU (Transformers.js). Tiene 5 ejercicios independientes: pregunta con explicación, sentimiento, sesgo, tutor matemático y engaño. **No tiene progreso, reflexiones ni conexión con la ruta ni con el panel de la educadora.**

---

## 3. Mejoras propuestas

### 3.1 Arreglos rápidos (P0: textos y coherencia, menos de un día)

1. **Las etiquetas del Lab LLM prometen más de lo que hacen**, y eso choca con el propio aviso de la página:
   - Ejercicio general: la intro dice «para que describa el razonamiento que siguió» y el panel se titula «Razonamiento del modelo». Propuesta: «Explicación escrita por el modelo (autoexplicación)», con la intro «…para que *escriba una explicación* de su respuesta».
   - Sentimiento: «para ver en qué palabras se fijó». El laboratorio no mide en qué palabras se fija. Propuesta: «para ver qué palabras *dice* que le influyeron» (o implementar la lupa de palabras de §4, módulo 3).
   - Botón «¿Por qué dijo esto el modelo?» → «Pídele que lo explique». El Lab CV ya distingue «evidencia» de «motivo»; el LLM debería usar el mismo vocabulario.
2. **«Sandbox de chat»** no es un chat: muestra la siguiente palabra. Propuesta: «Laboratorio de la siguiente palabra».
3. **Un texto de desarrollo ha llegado a producción**: «Abre la app desde http://localhost:5173…». En producción debería decir «abre la app con HTTPS».
4. **`common.retry` = «Reiniciar» / «Reset»** en un botón de reintento, mientras que en el LLM aparece «Reintentar». Hay que unificarlo.
5. **El veredicto del Lab CV llama a OpenAI** (confirmado en el código; ver §3.3). No es solo una plantilla: si el despliegue tiene Supabase configurado, se envía a un servidor remoto.
6. **La spec del LLM está desalineada**: describe 9 ejercicios, un panel lateral, una cifra de confianza y atención, que no están implementados. Propongo reescribirla con la ruta de §4 y marcar la atención como descartada (ver por qué abajo).
7. **Tamaño de la descarga del modelo**: antes de cargar Gemma, Llama o Qwen, mostrar los MB que ocupa y si ya está en caché. El dispositivo de referencia es un Chromebook con 4 GB y una red escolar.

### 3.2 Mejoras de estructura (P1)

1. **Inicio basado en el póster**: una sección «¿Por qué XAI?» con 3 cifras (42,6 % LLM, 15,2 % recomendadores y 10,5 % CV) y una **autoevaluación XAI Score** de 3 preguntas deslizantes (criticidad, opacidad y vulnerabilidad) sobre *su* proyecto Technovation. El resultado recomienda un laboratorio y explica por qué un proyecto de salud o justicia necesita más explicabilidad. Esto conecta directamente la investigación con la herramienta y sirve como instrumento para recoger datos.
2. **Ruta de aprendizaje por laboratorio**: hoy «Ruta de aprendizaje» es global, pero solo contiene CV, y el panel de la educadora dice «x de 7 módulos». Propongo `/lessons/cv/*`, `/lessons/llm/*` y `/lessons/rec/*` usando el mismo motor de módulos (pasos, reto, `challengeRequires` y reflexiones). La educadora vería el progreso por laboratorio.
3. **Un esqueleto pedagógico común a los tres labs** (es la mejora de más valor didáctico, porque la alumna aprende un *método* de XAI y no tres herramientas sueltas):

| Concepto transversal | CV (existe) | LLM (propuesto) | Recomendador (propuesto) |
|---|---|---|---|
| ¿Qué «ve» el modelo? | píxeles y clases | tokens | valoraciones y etiquetas |
| Salida con probabilidad | confianza por clase | top-k de la siguiente palabra | puntuación por ítem |
| Explicación interna | Grad-CAM | autoexplicación del modelo | vecinos («porque te gustó X») |
| Explicación por perturbación | oclusión de cuadrados | oclusión de palabras | quitar una valoración |
| ¿Coinciden? | puntuación de coincidencia | coincidencia entre palabras citadas y palabras con impacto | coincidencia entre vecinos y valoraciones con impacto |
| Sesgo y justicia | desequilibrio de clases | contrafactual de género o de nombre | sesgo de popularidad y grupo minoritario |
| Proyecto final | presentar el modelo | ficha XAI del proyecto | ficha XAI del proyecto |

4. **Accesibilidad y E2E en el Lab LLM**: el CV tiene descripciones de texto y criterios WCAG; el LLM no tiene pruebas E2E ni de accesibilidad (lo reconoce la propia spec).

### 3.3 Hallazgos en el código (repositorio `jartieda/MLXTraining`, rama `001-xai-lab`, commit `5dc84f5`)

**Lab LLM (`src/features/llmLab/`)**

| # | Hallazgo | Dónde | Propuesta |
|---|---|---|---|
| 1 | Con el motor CPU, la página dice «versión reducida del modelo», pero en realidad carga **otro modelo, entre 4 y 8 veces más pequeño y a veces de otra generación**: `gemma-2-2b` (GPU) frente a `gemma-3-270m` (CPU); `Llama-3.2-3B` frente a `1B`; `Qwen2.5-3B` frente a `0.5B`. Las probabilidades no son comparables entre motores. | `webllm.ts` (`WEBLLM_MODEL_MAP` y `CPU_MODEL_MAP`) | Mostrar el nombre y el tamaño exactos del modelo cargado. Puede convertirse en material didáctico: «el mismo prompt en un modelo de 3B y en uno de 0,5B». |
| 2 | El ejercicio de engaño invita a insistir («¿Consigues que cambie de opinión si insistes?»), pero **cada envío es independiente**: `ReasoningChat` manda un solo mensaje y no guarda historial. No se puede insistir. | `ReasoningChat.tsx` (`handleAsk`) y `llm.json` (`deception.intro`) | Darle a ese ejercicio historial multiturno (`ChatTurn[]` ya está soportado en `engine.generate`) o quitar la frase. |
| 3 | En sentimiento y sesgo se usa **la misma instrucción oculta** que en el ejercicio general: «lista numerada de 3 a 5 pasos con el razonamiento». La intro promete «en qué palabras se fijó», pero el modelo no recibe esa petición. | `ReasoningChat.tsx` (`reasoning.hiddenInstruction` para todas las variantes) | Usar una instrucción por variante, por ejemplo: «cita entre comillas las palabras exactas del texto que más pesaron». Eso además prepara la comparación con la lupa de palabras (módulo 4). |
| 4 | El texto de la alumna se inserta **sin escapar dentro de la plantilla de chat** en el camino GPU. Si escribe `<end_of_turn>` o `<|im_end|>`, rompe el turno. | `webllm.ts` (`buildRawChatPrompt`) | Eliminar los tokens especiales del texto de la alumna. Opcional: aprovecharlo como demostración controlada en el módulo de prompt injection. |
| 5 | Para Gemma, el prompt crudo empieza por `<bos>`. **Hay que verificar** si WebLLM añade otro BOS en `completions.create`, porque un BOS doble distorsiona las probabilidades del sandbox. | `webllm.ts` | Hacer una prueba que compare los logprobs del primer token con y sin `<bos>`. |
| 6 | No hay **botón para cancelar la generación**. Hay 5 secciones que comparten un motor serializado con `MAX_TOKENS = 512`, así que en CPU una petición puede bloquear las demás durante minutos. El Lab CV sí permite cancelar la oclusión. | `llmEngine.ts` (`serialize`) y `ReasoningChat.tsx` | Usar `AbortController` o `engine.interruptGenerate()` en WebLLM; reducir `max_tokens` en CPU. |
| 7 | La temperatura de generación es distinta según el motor: 0,3 en GPU y voraz (`do_sample: false`) en CPU. El mismo ejercicio se comporta distinto según el motor. | `llmEngine.ts` | Unificarla y mostrarla. Un control deslizante de temperatura sería un buen ejercicio en el módulo 2. |
| 8 | Accesibilidad: los botones de modelo no tienen `aria-pressed` (los de motor sí). Además, el estado de carga con `aria-live` anuncia cada punto porcentual. | `LlmLabPage.tsx` (líneas 195–205 y 226–234) | Añadir `aria-pressed` y limitar los anuncios a hitos (25/50/75/100 %). |
| 9 | Pruebas: solo existen unitarias (`webllm`, `wordCompletion` y la del despliegue). No hay E2E del Lab LLM. | `tests/unit`, `tests/e2e` | Escribir E2E con un `LlmEngine` simulado: la interfaz `LlmEngine` lo hace fácil. |
| 10 | El sandbox pide «completa la frase con una palabra» con un texto fijo en español, también con la interfaz en inglés. | `wordCompletion.ts` (`WORD_COMPLETION_INSTRUCTION`) | Localizarlo. |

**Buena noticia para el plan:** la interfaz `LlmEngine.nextTokenAlternatives(userMessage, assistantPrefix)` ya devuelve logprobs reales en los dos motores. Es exactamente la primitiva que necesitan la lupa de palabras y los contrafactuales. Basta con pedir una respuesta con formato cerrado (por ejemplo «Responde solo: positivo / negativo / neutro») y leer el logprob del primer token de cada etiqueta, quitando cada vez una palabra. Un límite: WebLLM devuelve como máximo 5 `top_logprobs` y hoy se usa `TOP_K = 3`. Por eso las etiquetas deben ser cortas y distintas desde su primer token (por ejemplo `A`, `B` o `C`, o bien `positivo`/`negativo`, si sus primeros tokens difieren).

**Lab CV: el veredicto sale del dispositivo**

- `CompareView.tsx` llama a `requestLlmVerdictAnalysis()` (`src/features/explaining/llmVerdict.ts`), que invoca la Edge Function de Supabase `verdict-analysis`. Esa función llama a **`https://api.openai.com/v1/chat/completions`** con `gpt-4o-mini` por defecto. Envía **los nombres de clase escritos por la alumna**, la descripción en texto de los dos mapas y la banda de coincidencia. No envía imágenes.
- Esto choca con el mensaje de la interfaz («Se queda en este dispositivo») y con el espíritu de FR-048 y SC-010, además de con el público de 12–18 años. Las alumnas pueden escribir nombres de clase con datos personales, como el nombre de una compañera.
- El idioma está fijado en `language: 'es'` aunque la interfaz esté en inglés.
- **Propuesta:** (a) quitarlo y quedarse con el análisis por plantilla (`inferredVerdictAnalysis`), que ya existe y no depende de nada remoto; o (b) hacerlo opcional, con un aviso explícito y un destino nombrado; o (c) generarlo con el mismo WebLLM local del Lab LLM. Recomiendo la (a) o la (c). **Estado:** se ha aplicado la (a) en la rama `docs/propuesta-xai-lab`. Se han eliminado `llmVerdict.ts` y la función `verdict-analysis`. Falta quitar la función y el secreto `OPENAI_API_KEY` del proyecto Supabase desplegado.

**Despliegue:** `connect-src *` en Netlify y Nginx, que fija la prueba `webllm-deployment.test.ts`, permite conexiones a cualquier origen. Debilita la garantía comprobable de SC-010. Conviene limitarlo a los orígenes de descarga de modelos (Hugging Face, el CDN de WebLLM o el que se use) y a Supabase.

**Ruta de lecciones:** `MODULE_IDS` es una lista cerrada de 7 módulos CV, y `ModuleView.tsx:160` fija `total: 7` a mano. En la base de datos, `module_id` es `text` sin restricción, así que **no hace falta migración** para guardar módulos LLM. Sí habrá que generalizar `MODULE_IDS`, `CapabilityKind` (añadir capacidades LLM como `llmModelLoaded`, `wordLensRun` o `selfExplanationCompared`), `Roster.tsx` y ese `total: 7`.

---

## 4. Plan para la lección del Lab LLM

**Principio de diseño:** solo se enseña lo que el laboratorio puede **medir** de verdad. WebLLM no expone pesos de atención, y la atención tampoco es una explicación fiable. Lo que sí está disponible son los **logprobs**, que el sandbox ya usa con `top_logprobs`. Con ellos se construyen explicaciones por perturbación, honestas y equivalentes a la oclusión del Lab CV. Por eso propongo **sustituir la «lupa de atención» de la spec por una «lupa de palabras» basada en oclusión**.

| # | Módulo | Qué hace la alumna | Reto | Reflexión | Técnica |
|---|---|---|---|---|---|
| 1 | **Lo que lee el modelo: tokens** | Escribe frases y ve cómo se trocean en tokens (en español, con emojis y con nombres propios). | Encontrar una palabra que se parta en 3 o más tokens. | ¿Por qué «Rosalía» se trocea distinto que «perro»? | Visor del tokenizador (de WebLLM o Transformers.js). |
| 2 | **Adivinar la siguiente palabra** | Usa el sandbox actual con «El perro vio al gato y…»; cambia el contexto y el modelo. | Escribir un prompt en el que la palabra más probable tenga menos del 50 %, y otro en el que tenga más del 90 %. | ¿Probable significa verdadero? | Ya existe; solo falta guiarlo. |
| 3 | **La lupa de palabras** | En el ejercicio de sentimiento, el laboratorio tapa cada palabra y mide cuánto cambia P(«positivo»). Las palabras se colorean como un mapa de calor. | Encontrar una frase en la que «no» o la ironía cambie el resultado. | ¿Qué palabra pesaba más? ¿Te lo esperabas? | Oclusión de palabras con logprobs de la etiqueta (N+1 llamadas, cancelable). |
| 4 | **¿Dice la verdad sobre sí mismo?** | Compara las palabras que el modelo *dice* que le influyeron (autoexplicación) con las de la lupa (perturbación) y obtiene una puntuación de coincidencia. | Encontrar un caso en el que la autoexplicación cite palabras que no cambian nada. | ¿Te fías más de lo que dice o de lo que se mide? | Es la idea central de XAI (fidelidad) y el equivalente de «Compara dos explicaciones» en CV. |
| 5 | **Sesgos con contrafactuales** | Usa una carta de recomendación o un CV laboral. Cambia solo el nombre o el género (María/Juan, o nombres de distintos orígenes) y compara las probabilidades de las palabras candidatas («excelente», «trabajadora», «líder»…). | Encontrar un par de textos que solo difieran en el nombre y que den resultados distintos. | ¿Sería justo usar este modelo para elegir candidatas? | Pares contrafactuales; enlaza con la sensibilidad al género del póster. |
| 6 | **Alucinaciones y seguridad** | Usa el ejemplo de Rosalía y preguntas con premisas falsas. Repite 5 veces la misma pregunta y compara las respuestas, o compara Gemma, Llama y Qwen. | Lograr que el modelo invente un dato con mucha probabilidad. | ¿Qué señales te avisan de que se lo ha inventado? | Autoconsistencia (varias muestras) como señal de incertidumbre; probabilidad ≠ verdad. |
| 7 | **Fuentes y prompt injection** | Usa un mini-RAG local con 3 fragmentos de un dominio de salud. Uno contiene una instrucción maliciosa («ignora lo anterior y…»). El modelo debe citar el fragmento que usa. | Detectar cuándo el modelo obedece al fragmento malicioso y cuándo cita mal. | ¿Cómo protegerías tu app? | Grounding y citas comprobables; recuperación simple por palabras clave, sin servidor. |
| 8 | **Ficha XAI de mi proyecto** | Aplica el XAI Score y una ficha (qué decide, quién se ve afectado, cómo lo explicarás) a su proyecto Technovation. | Presentar la ficha. | ¿Qué explicación necesita tu usuaria? | Conecta con el póster y es el cierre común a los tres labs. |

**Qué pasa con los ejercicios actuales:**
- El general, el de sentimiento, el de sesgo y el de engaño se **reutilizan** dentro de los módulos 3 a 6.
- El tutor matemático no es XAI. Propongo moverlo a «Extras: la IA como tutora», o reconvertirlo en un ejercicio de *evaluar* si el tutor respeta su regla de no dar la solución (comprobación de las instrucciones del sistema).

**Implementación por fases:**
1. **Fase A (1–2 semanas):**
   - Generalizar `src/content/lessons/schema.ts` y `modules.ts` a varios laboratorios (`lab: 'cv' | 'llm' | 'rec'`) y quitar el `total: 7` fijo. No hace falta migración: `module_id` es texto libre.
   - Añadir los módulos LLM con `module_id = "llm-*"`.
   - Mostrar el progreso por laboratorio en el panel de la educadora (`Roster.tsx`).
   - Aplicar los arreglos de §3.1 y §3.3: el veredicto remoto, el historial en el ejercicio de engaño, las instrucciones por variante, el botón de cancelar y el nombre real del modelo.
   - Montar los módulos 2, 6 y 8, que se apoyan en lo que ya existe.
2. **Fase B (2–3 semanas):** desarrollar la lupa de palabras (módulo 3) y la coincidencia (módulo 4).
   - Nueva función `scoreLabels(engine, text, labels)` en `src/features/llmLab/`, construida sobre `nextTokenAlternatives` (que ya funciona en GPU y CPU) → probabilidad de cada etiqueta.
   - La oclusión reutiliza la lógica de `src/ml/explain/agreement.ts` para la puntuación de coincidencia (solapamiento de las k palabras principales).
   - Presupuesto de llamadas, progreso visible y opción de cancelar, igual que la oclusión de CV.
3. **Fase C (2 semanas):** desarrollar los contrafactuales (módulo 5), el visor de tokens (módulo 1) y el mini-RAG (módulo 7); añadir E2E y accesibilidad.
4. **Criterios de éxito**, en la línea de las specs: el 80 % identifica correctamente una autoexplicación infiel en el módulo 4, y el 80 % detecta un sesgo contrafactual en el módulo 5.

---

## 5. ¿Una lección de sistemas de recomendación? Sí, y está justificada por los datos

Es la **segunda tecnología más usada (15,2 %)** según el póster, por delante de CV, y es la única de las tres primeras sin laboratorio. Además, encaja con los ODS que más trabajan las participantes: salud (recetas o actividad física), educación (recursos de estudio) y consumo responsable (productos sostenibles).

**Propuesta de «Lab Rec»**, 100 % en el navegador y sin datos personales, igual que los otros labs:
- **Catálogo sintético** de 30 a 40 ítems con emoji y etiquetas (por ejemplo, retos saludables o libros), y **150 usuarias sintéticas** con gustos generados. Nada sale del dispositivo y no hace falta servidor.
- La alumna valora unos 10 ítems y recibe una lista top-5 de dos recomendadores: **basado en contenido** (etiquetas) y **colaborativo** (vecinas similares o una factorización matricial pequeña en JS o TF.js, que ya está en el proyecto).

| # | Módulo | Explicación o actividad | Equivalente en CV |
|---|---|---|---|
| 1 | **¿Cómo me conoce?** | Arranque en frío: sin valoraciones solo recomienda lo popular. La alumna ve cómo cambia la lista al valorar. | Qué ve el modelo |
| 2 | **«Porque te gustó…»** | Explicación por vecinos o por ítems, y aportación de cada etiqueta (exacta en el modelo lineal de contenido, al estilo SHAP). | Grad-CAM |
| 3 | **Quitar una valoración** | Elimina una valoración cada vez y mide cuánto cambia la puntuación del ítem recomendado (oclusión o leave-one-out). | Oclusión |
| 4 | **¿Coinciden?** | Compara la explicación «porque te gustó X» con la valoración que realmente más pesa. | Comparar explicaciones |
| 5 | **Burbujas y popularidad** | Ve qué ítems no se recomiendan nunca (larga cola), usa un control deslizante de diversidad y observa cómo se cierra la burbuja de filtro. | Atajos y sesgo |
| 6 | **Justicia para grupos minoritarios** | Un grupo sintético pequeño con gustos distintos recibe peores recomendaciones; la alumna ve la precisión por grupo y lo reequilibra. | Experimento de desequilibrio |
| 7 | **Ficha XAI de mi proyecto** | La misma ficha que en los otros labs. | Presentación final |

**Coste estimado:** bajo en comparación con el LLM (unas 2–3 semanas), porque no hay modelos pesados, todo es determinista y reutiliza el motor de lecciones, la matriz de confusión o tabla por grupo y la comparación de ejecuciones del Lab CV.

---

## 6. Prioridades propuestas

1. **P0:** decidir qué hacer con el veredicto CV que llama a OpenAI y limitar `connect-src` (§3.3); arreglos de textos (§3.1); reescritura de la spec del Lab LLM.
2. **P1:** ruta de lecciones por laboratorio, módulos LLM 2, 6 y 8, e inicio con el póster y el XAI Score.
3. **P2:** lupa de palabras y coincidencia en el LLM (módulos 3 y 4), que es el mayor salto didáctico.
4. **P3:** Lab Rec.
5. **P4:** contrafactuales, mini-RAG y visor de tokens; E2E y accesibilidad.
6. **Línea de investigación** (continuación del póster): un cuestionario pre/post opcional y anónimo en la ruta, y el XAI Score que se autoasigna cada alumna frente al que asigna el auditor automático (Gemini con LangChain). Eso daría datos de la vertiente *cualitativa* (percepción y confianza) que el póster deja como trabajo futuro.
