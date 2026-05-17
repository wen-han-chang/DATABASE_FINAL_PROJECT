const OPENAI_API_URL = 'https://api.openai.com/v1/responses'

function getApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim()
}

function getModel() {
  return String(process.env.OPENAI_MODEL || 'gpt-5-mini').trim()
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') {
    return response.output_text
  }

  const chunks = []
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') {
        chunks.push(content.text)
      }
    }
  }
  return chunks.join('\n').trim()
}

async function createResponse(body) {
  const apiKey = getApiKey()
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY 尚未設定。')
    error.statusCode = 500
    throw error
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getModel(),
      ...body,
    }),
    signal: AbortSignal.timeout(45000),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI API request failed (${response.status})`
    const error = new Error(message)
    error.statusCode = 502
    throw error
  }

  return payload
}

export async function createStructuredResponse({ instructions, userInput, schema, name }) {
  const response = await createResponse({
    input: [
      { role: 'developer', content: instructions },
      { role: 'user', content: userInput },
    ],
    text: {
      format: {
        type: 'json_schema',
        name,
        strict: true,
        schema,
      },
    },
  })

  const text = extractOutputText(response)
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('OpenAI 回傳的結構化資料格式無法解析。')
    error.statusCode = 502
    throw error
  }
}

export async function createTextResponse({ instructions, userInput }) {
  const response = await createResponse({
    input: [
      { role: 'developer', content: instructions },
      { role: 'user', content: userInput },
    ],
  })

  return extractOutputText(response)
}
