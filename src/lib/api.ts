// ─── voice catalogue ──────────────────────────────────────────────────────────

export interface VoiceEntry {
  speaker: string
  gender: string      // "Male" | "Female" | "Non-binary"
  age: string         // "Young Adult" | "Adult" | "Elder"
  country: string
  dialect: string
  demographic: string
  genre: string[]
  modelId: string
  lang: string
  language: string
  flagship: boolean
}

const VOICE_DETAILS_URL = '/api/voices'

/**
 * Fetches all mistv2 voices from the Rime voice catalogue.
 * Flagship voices are sorted first, then alphabetically by speaker name.
 */
export async function fetchVoices(): Promise<VoiceEntry[]> {
  const res = await fetch(VOICE_DETAILS_URL)
  if (!res.ok) throw new Error(`Failed to fetch voices: ${res.status}`)
  const all: VoiceEntry[] = await res.json()
  return all
    .filter(v => v.modelId === 'mistv2')
    .sort((a, b) => {
      if (a.flagship && !b.flagship) return -1
      if (!a.flagship && b.flagship) return 1
      return a.speaker.localeCompare(b.speaker)
    })
}

// ─── word parsing ─────────────────────────────────────────────────────────────

const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

/**
 * Returns Map<displayWord, frequency> where displayWord preserves the
 * capitalisation of the first occurrence (e.g. "Pfizer", not "pfizer").
 * Deduplication is case-insensitive.
 */
export function parseWords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  const seen = new Map<string, string>() // lowercase → first-seen display form
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (!isWordLike) continue
    if (segment.length < 2 || !/[a-zA-Z]/.test(segment)) continue
    const lower = segment.toLowerCase()
    if (!seen.has(lower)) seen.set(lower, segment)
    const display = seen.get(lower)!
    freq.set(display, (freq.get(display) ?? 0) + 1)
  }
  return freq
}

// ─── Rime APIs ────────────────────────────────────────────────────────────────

const RIME_OOV_URL = '/api/oov'
const RIME_TTS_URL = '/api/rime-tts'

function rimeProxyAuthHeaders(apiKey: string): Record<string, string> {
  const bearer = `Bearer ${apiKey}`
  return {
    Authorization: bearer,
    // Some hosts strip `Authorization`; edge proxy reads this fallback.
    'X-Rime-Authorization': bearer,
  }
}

/**
 * Returns the subset of `words` that are out-of-vocabulary for Rime.
 */
export async function fetchOov(words: string[], apiKey: string): Promise<string[]> {
  const res = await fetch(RIME_OOV_URL, {
    method: 'POST',
    headers: {
      ...rimeProxyAuthHeaders(apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: words.join(' ') }),
  })
  if (!res.ok) throw new Error(`Coverage API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Unexpected response from coverage API')
  return data.filter((w): w is string => typeof w === 'string')
}

/**
 * Synthesises `word` with Rime TTS and returns a blob URL for the audio.
 */
export async function fetchWordAudio(word: string, apiKey: string, speaker = 'lagoon'): Promise<string> {
  const res = await fetch(RIME_TTS_URL, {
    method: 'POST',
    headers: {
      ...rimeProxyAuthHeaders(apiKey),
      'Content-Type': 'application/json',
      Accept: 'audio/mp3',
    },
    body: JSON.stringify({ text: word, speaker, modelId: 'mistv2' }),
  })
  if (!res.ok) throw new Error(`TTS API error ${res.status}: ${await res.text()}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// ─── OpenAI API ───────────────────────────────────────────────────────────────

const OPENAI_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

/**
 * Generates a realistic customer-service script for the given use case,
 * rich in domain-specific vocabulary that stress-tests TTS pronunciation.
 */
export async function generateScript(useCase: string, apiKey: string): Promise<string> {
  const res = await fetch(OPENAI_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a scriptwriter for AI voice assistants. Generate realistic, natural-sounding customer service conversations with 6–10 back-and-forth exchanges between an Agent and a Customer. Use domain-specific vocabulary, brand names, product names, technical terms, medications, proper nouns, and industry jargon — the kinds of words a text-to-speech engine might mispronounce. Include a variety of unusual words throughout. Format each line as "Agent: ..." or "Customer: ..." on its own line. Return ONLY the dialogue, no stage directions, no preamble, no explanation.',
        },
        {
          role: 'user',
          content: `Write a full customer service conversation for this use case: ${useCase}`,
        },
      ],
      max_tokens: 600,
      temperature: 0.8,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices[0].message.content.trim()
}

// ─── IPA → Rime Phonetic Alphabet conversion ──────────────────────────────────

/**
 * Converts an IPA pronunciation string to the Rime Phonetic Alphabet.
 *
 * Strategy:
 *  1. Strip surrounding / / or [ ] brackets and length marks (ː).
 *  2. Scan left-to-right, matching digraphs before single chars.
 *  3. IPA stress markers (ˈ ˌ) are deferred until the next vowel,
 *     where they become Rime's 1 / 2 prefix — matching Rime's spec exactly.
 *  4. Unknown/diacritic characters are silently dropped.
 *
 * Rime vowel set: @ a A W x Y E R e I i o O U u N
 * Rime consonants that differ from ASCII: C(ch) D(ð) G(ŋ) J(dʒ) S(ʃ) T(θ) Z(ʒ)
 */
export function ipaToRime(ipa: string): string {
  const s = ipa
    .trim()
    .replace(/^[/[]/, '').replace(/[/\]]$/, '') // strip brackets
    .replace(/ː/g, '')  // length mark — irrelevant for phoneme identity
    .replace(/\./g, '') // syllable-boundary dots

  // Digraphs must be tested before single chars (order within array matters too)
  const digraphs: [string, string][] = [
    ['tʃ', 'C'],  // ch  — China
    ['dʒ', 'J'],  // j   — jive
    ['aɪ', 'Y'],  // i   — bite
    ['aʊ', 'W'],  // ou  — about/cow
    ['eɪ', 'e'],  // a   — bait
    ['oʊ', 'o'],  // o   — boat
    ['əʊ', 'o'],  // o   — boat (British)
    ['ɔɪ', 'O'],  // oy  — boy
  ]

  const singles: Record<string, string> = {
    // Vowels
    'æ': '@',             // bat
    'ɑ': 'a', 'ɒ': 'a',  // hot
    'ʌ': 'A',             // butt
    'ə': 'x',             // comma (schwa)
    'ɛ': 'E', 'e': 'E',  // bet
    'ɜ': 'R',             // bird
    'ɪ': 'I',             // bit
    'i': 'i',             // beat
    'ɔ': 'a',             // thought — closest available
    'ʊ': 'U',             // book
    'u': 'u',             // boot
    'a': 'a',             // low front
    // Consonants that differ from their ASCII letter
    'ŋ': 'G',             // sing
    'ʃ': 'S',             // shy
    'θ': 'T',             // thigh
    'ð': 'D',             // thy
    'ʒ': 'Z',             // pleasure
    'ɹ': 'r',             // American rhotic r
    'j': 'y',             // yes
    // ASCII consonants — pass through unchanged
    'b': 'b', 'd': 'd', 'f': 'f', 'g': 'g', 'h': 'h',
    'k': 'k', 'l': 'l', 'm': 'm', 'n': 'n', 'p': 'p',
    'r': 'r', 's': 's', 't': 't', 'v': 'v', 'w': 'w',
    'z': 'z',
  }

  const RIME_VOWELS = new Set('@aAWxYERieIoOUuN'.split(''))
  const out: string[] = []
  let pendingStress = ''
  let idx = 0

  while (idx < s.length) {
    const ch = s[idx]

    // Stress: defer until next vowel
    if (ch === 'ˈ') { pendingStress = '1'; idx++; continue }
    if (ch === 'ˌ') { pendingStress = '2'; idx++; continue }

    // Try digraphs first
    let hit = false
    for (const [seq, rim] of digraphs) {
      if (s.startsWith(seq, idx)) {
        if (RIME_VOWELS.has(rim)) { out.push(pendingStress || '0'); pendingStress = '' }
        out.push(rim)
        idx += seq.length
        hit = true
        break
      }
    }
    if (hit) continue

    // Single char
    const rim = singles[ch]
    if (rim) {
      if (RIME_VOWELS.has(rim)) { out.push(pendingStress || '0'); pendingStress = '' }
      out.push(rim)
    }
    // Unknown chars (combining diacritics, etc.) are silently dropped
    idx++
  }

  return out.join('')
}

// ─── Phonetics: IPA via LLM + deterministic Rime conversion ──────────────────

export interface PhoneticResult {
  /** IPA string as returned by the LLM — shown to the user */
  ipa: string
  /** Rime Phonetic Alphabet string (converted from IPA) — sent to Rime TTS */
  rime: string
}

/**
 * Uses OpenAI to fetch IPA pronunciations for OOV words, then converts each to
 * the Rime Phonetic Alphabet via the deterministic `ipaToRime` function.
 *
 * Asking for IPA (not Rime phonetics directly) is significantly more reliable:
 * IPA is heavily represented in LLM training data, while Rime's alphabet is not.
 * The IPA → Rime conversion step is purely algorithmic and has no hallucination risk.
 */
export async function fetchWordPhonetics(
  words: string[],
  apiKey: string,
): Promise<Record<string, PhoneticResult>> {
  const res = await fetch(OPENAI_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a linguist specializing in American English phonetics. For each word provided, give its IPA (International Phonetic Alphabet) pronunciation using standard American English.

Rules:
- Use ˈ for primary stress and ˌ for secondary stress, placed immediately before the stressed syllable.
- Do NOT include / / or [ ] brackets in your output strings — bare IPA only.
- For brand names, drug names, and proper nouns, use the standard accepted pronunciation.

Return ONLY a valid JSON object mapping each word to its IPA string. No markdown, no backticks, no extra text.
Example: {"Pfizer": "ˈfaɪzər", "Zoloft": "ˈzoʊlɑft", "Lisinopril": "lɪˈsɪnəprɪl", "Tylenol": "ˈtaɪlənɑl"}`,
        },
        {
          role: 'user',
          content: `Provide American English IPA for: ${words.join(', ')}`,
        },
      ],
      max_tokens: 400,
      temperature: 0.1,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const raw = data.choices[0].message.content.trim()

  let ipaMap: Record<string, string>
  try {
    ipaMap = JSON.parse(raw) as Record<string, string>
  } catch {
    throw new Error('Failed to parse IPA response from OpenAI')
  }

  return Object.fromEntries(
    Object.entries(ipaMap).map(([word, ipa]) => [
      word,
      { ipa, rime: ipaToRime(ipa) } satisfies PhoneticResult,
    ]),
  )
}

/**
 * Synthesises audio for a Rime phonetic string using phonemizeBetweenBrackets.
 * Pass the bare Rime phoneme sequence (e.g. "f1Yzxr") — this function wraps it
 * in `{}` before sending to Rime TTS.
 */
export async function fetchPhoneticAudio(text: string, apiKey: string, speaker = 'lagoon'): Promise<string> {
  const res = await fetch(RIME_TTS_URL, {
    method: 'POST',
    headers: {
      ...rimeProxyAuthHeaders(apiKey),
      'Content-Type': 'application/json',
      Accept: 'audio/mp3',
    },
    body: JSON.stringify({
      text,
      speaker,
      modelId: 'mistv2',
      phonemizeBetweenBrackets: true,
    }),
  })
  if (!res.ok) throw new Error(`TTS API error ${res.status}: ${await res.text()}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// Send recorded audio to OpenAI Whisper and return the transcribed text.
// Pass `prompt` as the OOV word to bias Whisper toward recognising it.
export async function transcribeAudio(audioBlob: Blob, apiKey: string, prompt?: string): Promise<string> {
  const form = new FormData()
  form.append('file', audioBlob, 'recording.webm')
  form.append('model', 'whisper-1')
  form.append('language', 'en')
  if (prompt) form.append('prompt', prompt)
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Whisper API error ${res.status}: ${await res.text()}`)
  return ((await res.json()).text as string).trim()
}
