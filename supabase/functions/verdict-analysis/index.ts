import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

interface VerdictRequest {
  userChoice: 'yes' | 'no'
  expectedClass: string
  predictedClass: string
  classNames: string[]
  reason: string
  gradcamEvidence: string
  occlusionEvidence: string
  agreementBand: 'strong' | 'partial' | 'disagreement' | null
  style?: {
    language?: 'es' | 'en'
    maxSentences?: number
    audience?: string
  }
}

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>
}

function responseJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    },
  })
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return responseJson(200, { ok: true })
  if (request.method !== 'POST') return responseJson(405, { error: 'Method not allowed' })

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

  if (!apiKey) {
    return responseJson(500, { error: 'OPENAI_API_KEY is not configured' })
  }

  let payload: VerdictRequest
  try {
    payload = (await request.json()) as VerdictRequest
  } catch {
    return responseJson(400, { error: 'Invalid JSON body' })
  }

  const language = payload.style?.language ?? 'es'
  const maxSentences = Math.max(2, Math.min(payload.style?.maxSentences ?? 4, 6))
  const audience = payload.style?.audience ?? 'student'

  const systemPrompt =
    language === 'es'
      ? 'Eres un asistente docente de IA explicable. Escribe en espanol claro, breve y preciso. No inventes hechos que no esten en la entrada.'
      : 'You are an explainable-AI teaching assistant. Write in clear, concise language. Do not invent facts beyond the provided input.'

  const userPrompt = [
    language === 'es'
      ? `Analiza por que el modelo acerto o fallo para un ${audience}. Responde en maximo ${maxSentences} frases.`
      : `Analyze why the model was right or wrong for a ${audience}. Respond in at most ${maxSentences} sentences.`,
    `userChoice=${payload.userChoice}`,
    `expectedClass=${payload.expectedClass}`,
    `predictedClass=${payload.predictedClass}`,
    `reason=${payload.reason}`,
    `agreementBand=${payload.agreementBand ?? 'unknown'}`,
    `classNames=${payload.classNames.join(', ')}`,
    `gradcamEvidence=${payload.gradcamEvidence}`,
    `occlusionEvidence=${payload.occlusionEvidence}`,
  ].join('\n')

  try {
    const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!llmResponse.ok) {
      const detail = await llmResponse.text()
      return responseJson(502, { error: 'LLM provider error', detail })
    }

    const data = (await llmResponse.json()) as OpenAiResponse
    const analysis = data.choices?.[0]?.message?.content?.trim()

    if (!analysis) return responseJson(502, { error: 'Empty LLM response' })

    return responseJson(200, { analysis })
  } catch (error) {
    return responseJson(500, {
      error: 'Unexpected error while generating verdict analysis',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
})
