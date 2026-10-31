export const WORD_COMPLETION_INSTRUCTION = 'completa la frase con una palabra'

export interface ModelTokenAlternative {
  readonly token: string
  readonly logprob: number
  readonly bytes?: readonly number[] | null
}

export interface WordTokenScore {
  readonly token: string
  readonly probability: number
}

export interface WordCandidatePath {
  readonly tokens: readonly WordTokenScore[]
  readonly probability: number
}

export interface WordCandidate {
  readonly word: string
  /** Sum of the probability products for all explored paths that produced this word. */
  readonly probability: number
  readonly paths: readonly WordCandidatePath[]
}

export interface WordPartialPath {
  readonly text: string
  readonly tokens: readonly WordTokenScore[]
  readonly probability: number
}

export interface WordSearchProgress {
  readonly modelCalls: number
  readonly candidates: readonly WordCandidate[]
  readonly partials: readonly WordPartialPath[]
}

interface SearchState {
  readonly text: string
  readonly tokens: readonly WordTokenScore[]
  readonly probability: number
}

interface WordSearchOptions {
  readonly limit?: number
  readonly topK?: number
  readonly beamWidth?: number
  readonly maxTokenDepth?: number
  readonly maxModelCalls?: number
  readonly onProgress?: (progress: WordSearchProgress) => void
}

/** Prefix every model request with the required instruction and continue a partial word when supplied. */
export function buildWordCompletionPrompt(prompt: string, partialWord = ''): string {
  const base = `${WORD_COMPLETION_INSTRUCTION}: ${prompt.trim()}\nResponde únicamente con una palabra.`
  if (partialWord.length === 0) return base

  return `${base}\nPrefijo parcial de la palabra que estás generando: «${partialWord}». Responde únicamente con la continuación que falta para terminar esa palabra, sin repetir el prefijo; si la palabra ya está completa, devuelve un espacio.`
}

/**
 * Explore a bounded beam of genuine model top-logprob alternatives until a word boundary
 * is reached. Every path score is the product of its conditional token probabilities
 * (including the token that closes the word); distinct token paths that complete the
 * same word are summed. Unfinished prefixes are reported through `onProgress` and are
 * never promoted to complete words. If the model fails after some work was done, the
 * results gathered so far are returned instead of discarding them.
 */
export async function findWordCandidates(
  getNextTokenAlternatives: (partialWord: string) => Promise<readonly ModelTokenAlternative[]>,
  options: WordSearchOptions = {},
): Promise<readonly WordCandidate[]> {
  const limit = options.limit ?? 3
  const topK = options.topK ?? 3
  const beamWidth = options.beamWidth ?? 9
  const maxTokenDepth = options.maxTokenDepth ?? 8
  const maxModelCalls = options.maxModelCalls ?? 36

  let modelCalls = 0
  let frontier: SearchState[] = [{ text: '', tokens: [], probability: 1 }]
  const completed = new Map<string, WordCandidatePath[]>()
  const unfinished = new Map<string, SearchState>()
  // The model only sees the partial text, so equal prefixes share one query.
  const queryCache = new Map<string, readonly ModelTokenAlternative[]>()

  function partialSnapshot(extra: readonly SearchState[]): WordPartialPath[] {
    return [...unfinished.values(), ...extra]
      .sort((left, right) => right.probability - left.probability)
      .slice(0, beamWidth)
      .map(({ text, tokens, probability }) => ({ text, tokens, probability }))
  }

  function reportProgress(extra: readonly SearchState[] = []): void {
    options.onProgress?.({
      modelCalls,
      candidates: buildCandidates(completed, limit),
      partials: partialSnapshot(extra),
    })
  }

  function rememberUnfinished(state: SearchState): void {
    if (state.tokens.length > 0) unfinished.set(`${state.text}|${state.tokens.length}`, state)
  }

  search: for (let depth = 0; depth < maxTokenDepth && frontier.length > 0; depth += 1) {
    const nextFrontier: SearchState[] = []

    for (let index = 0; index < frontier.length; index += 1) {
      const state = frontier[index]!
      let alternatives = queryCache.get(state.text)

      if (alternatives === undefined) {
        if (modelCalls >= maxModelCalls) {
          for (const pending of [...frontier.slice(index), ...nextFrontier]) rememberUnfinished(pending)
          frontier = []
          break search
        }

        modelCalls += 1
        try {
          alternatives = await getNextTokenAlternatives(state.text)
        } catch (error) {
          if (completed.size === 0 && unfinished.size === 0 && nextFrontier.length === 0 && state.tokens.length === 0) {
            throw error
          }
          for (const pending of [...frontier.slice(index), ...nextFrontier]) rememberUnfinished(pending)
          frontier = []
          break search
        }
        queryCache.set(state.text, alternatives)
      }

      const atStart = state.text.length === 0
      let producedContinuation = false
      let completedOrEnded = false

      for (const alternative of alternatives.slice(0, topK)) {
        if (!Number.isFinite(alternative.logprob)) continue
        const tokenText = decodeModelToken(alternative)
        const probability = Math.exp(alternative.logprob)
        const tokenScore: WordTokenScore = { token: alternative.token, probability }

        // End-of-sequence (or empty) tokens close the current word.
        if (tokenText.length === 0 || isEndToken(tokenText)) {
          if (!atStart) {
            addCompletedPath(completed, closeWith(state, tokenScore))
            completedOrEnded = true
          }
          continue
        }

        let piece = tokenText
        if (atStart) {
          // Leading whitespace/quotes are tokenizer or formatting noise, not part of the word.
          piece = tokenText.replace(LEADING_NOISE, '')
          if (piece.length === 0) continue
        } else if (/^\s/u.test(tokenText)) {
          // Whitespace after a non-empty prefix means the word ended before this token.
          addCompletedPath(completed, closeWith(state, tokenScore))
          completedOrEnded = true
          continue
        }

        // Chat requests restart generation from the user message. If the model echoes the
        // partial word instead of emitting its next piece, do not append the echo to itself
        // (e.g. "azul" + "azul" -> "azulazul"); the model is signalling the word is done.
        if (!atStart && piece.trim() === state.text) {
          addCompletedPath(completed, state)
          completedOrEnded = true
          continue
        }

        // A longer echo means this request restarted the word rather than continuing it,
        // so restart this branch from the returned token to keep the path coherent.
        const restarted = !atStart && piece.startsWith(state.text)
        const nextText = restarted ? piece : `${state.text}${piece}`
        const nextTokens = restarted ? [tokenScore] : [...state.tokens, tokenScore]
        const nextProbability = restarted ? probability : state.probability * probability

        const boundaryIndex = findWordBoundary(nextText)
        if (boundaryIndex >= 0) {
          const word = nextText.slice(0, boundaryIndex).trim()
          if (word.length > 0) {
            addCompletedPath(completed, { text: word, tokens: nextTokens, probability: nextProbability })
            completedOrEnded = true
          }
          continue
        }

        nextFrontier.push({ text: nextText, tokens: nextTokens, probability: nextProbability })
        producedContinuation = true
      }

      const dead = !producedContinuation && !completedOrEnded ? [state] : []
      for (const deadState of dead) rememberUnfinished(deadState)
      reportProgress(nextFrontier)
    }

    frontier = nextFrontier
      .sort((left, right) => right.probability - left.probability)
      .slice(0, beamWidth)
  }

  for (const state of frontier) rememberUnfinished(state)
  reportProgress()

  return buildCandidates(completed, limit)
}

function closeWith(state: SearchState, terminator: WordTokenScore): SearchState {
  return {
    text: state.text,
    tokens: [...state.tokens, terminator],
    probability: state.probability * terminator.probability,
  }
}

function buildCandidates(
  completed: Map<string, WordCandidatePath[]>,
  limit: number,
): readonly WordCandidate[] {
  return [...completed.entries()]
    .map(([word, paths]) => ({
      word,
      probability: paths.reduce((sum, path) => sum + path.probability, 0),
      paths,
    }))
    .sort((left, right) => right.probability - left.probability)
    .slice(0, limit)
}

function addCompletedPath(completed: Map<string, WordCandidatePath[]>, state: SearchState): void {
  const word = state.text.trim()
  if (word.length === 0 || state.tokens.length === 0) return
  const paths = completed.get(word) ?? []
  paths.push({ tokens: state.tokens, probability: state.probability })
  completed.set(word, paths)
}

const LEADING_NOISE = /^[\s«"“”'‘’¿¡*_`>#-]+/u

function decodeModelToken(alternative: ModelTokenAlternative): string {
  if (alternative.bytes && alternative.bytes.length > 0) {
    return new TextDecoder().decode(Uint8Array.from(alternative.bytes))
  }
  return alternative.token
    .replace(/^(?:▁|Ġ)+/u, ' ')
    .replace(/(?:▁|Ġ)/gu, ' ')
}

function findWordBoundary(text: string): number {
  const match = /[\s.,!?;:()[\]{}»"“”…*]/u.exec(text)
  return match?.index ?? -1
}

function isEndToken(token: string): boolean {
  return /^<\|?\/?[a-z_]*(?:end|eos|eot)[a-z_]*\|?>$|^<\/s>$|^\[eos\]$/iu.test(token.trim())
}
