import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useCallback, useMemo } from 'react'

export const Route = createFileRoute('/')({ component: ResearchPage })

// ─── constants ────────────────────────────────────────────────────────────────

const RIME_API_KEY = import.meta.env.VITE_RIME_API_KEY as string
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string

const RANDOM_USE_CASES = [
  'pharmacy prescription refill and drug interaction check',
  'airline rebooking after a flight cancellation',
  'hospital patient intake and insurance verification',
  'telecom troubleshooting a fiber outage',
  'wealth management portfolio review call',
  'automotive dealership scheduling a recall repair',
  'SaaS technical support for an API integration issue',
  'utility company handling a billing dispute',
  'insurance claim intake after a car accident',
  'medical device company fielding a compliance question',
]

// ─── helpers ──────────────────────────────────────────────────────────────────

const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

// Matches special tokens that must stay whole: credit cards first (most specific),
// then phone numbers, then email addresses.
const SPECIAL_TOKEN_RE =
  /\b\d{4}(?:[ \-]\d{4}){3}\b|(?:\+?1[ \-.])?(?:\(\d{3}\)|\d{3})[ \-.]\d{3}[ \-.]\d{4}|[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

// Returns Map<displayWord, frequency> where displayWord preserves the
// capitalisation of the first occurrence (e.g. "Pfizer", not "pfizer").
// Deduplication is case-insensitive via a separate lowercase→display map.
// Email addresses, phone numbers, and credit card numbers are kept as single tokens.
function parseWords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  const seen = new Map<string, string>() // lowercase → first-seen display form

  const addToken = (token: string) => {
    if (token.length < 2) return
    const lower = token.toLowerCase()
    if (!seen.has(lower)) seen.set(lower, token)
    const display = seen.get(lower)!
    freq.set(display, (freq.get(display) ?? 0) + 1)
  }

  const addSegmentedText = (chunk: string) => {
    for (const { segment, isWordLike } of wordSegmenter.segment(chunk)) {
      if (!isWordLike) continue
      if (segment.length < 2 || !/[a-zA-Z]/.test(segment)) continue
      addToken(segment)
    }
  }

  // Extract special tokens first so they aren't split by the segmenter
  const specialRe = new RegExp(SPECIAL_TOKEN_RE.source, 'g')
  let lastIndex = 0
  for (const match of text.matchAll(specialRe)) {
    addSegmentedText(text.slice(lastIndex, match.index))
    // Only count special tokens that contain letters (emails); skip pure-digit phones/CCs
    if (/[a-zA-Z]/.test(match[0])) addToken(match[0])
    lastIndex = match.index! + match[0].length
  }
  addSegmentedText(text.slice(lastIndex))

  return freq
}

async function fetchOov(words: string[]): Promise<string[]> {
  const res = await fetch('https://beta.rime.ai/oov', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RIME_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: words.join(' ') }),
  })
  if (!res.ok) throw new Error(`Coverage API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!Array.isArray(data)) throw new Error('Unexpected response from coverage API')
  return data.filter((w): w is string => typeof w === 'string')
}

async function fetchWordAudio(word: string): Promise<string> {
  const res = await fetch('https://users.rime.ai/v1/rime-tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RIME_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mp3',
    },
    body: JSON.stringify({ text: word, speaker: 'lagoon', modelId: 'mistv2' }),
  })
  if (!res.ok) throw new Error(`TTS API error ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

async function generateScript(useCase: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content.trim()
}

// ─── types ────────────────────────────────────────────────────────────────────

interface OovWord {
  word: string
  frequency: number
}

interface Results {
  totalTokens: number
  uniqueWordCount: number
  oovWords: OovWord[]
  oovTokenCount: number
  coveragePct: number
}

// ─── component ────────────────────────────────────────────────────────────────

function ResearchPage() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')
  const [loadingWord, setLoadingWord] = useState<string | null>(null)
  const [playingWord, setPlayingWord] = useState<string | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const currentAudio = useRef<HTMLAudioElement | null>(null)

  const [useCase, setUseCase] = useState('')
  const [generatingScript, setGeneratingScript] = useState(false)
  const [scriptError, setScriptError] = useState('')

  const wordCount = useMemo(() => parseWords(text).size, [text])

  const handleTextChange = useCallback((val: string) => {
    setText(val)
    setStatus('idle')
    setResults(null)
    setError('')
  }, [])

  const handleCheck = useCallback(async () => {
    const freq = parseWords(text)
    if (freq.size === 0) return
    setStatus('checking')
    setResults(null)
    setError('')
    try {
      const uniqueWords = Array.from(freq.keys())
      const oovList = await fetchOov(uniqueWords)
      const oovSet = new Set(oovList.map(w => w.toLowerCase()))
      const oovWords: OovWord[] = uniqueWords
        .filter(w => oovSet.has(w.toLowerCase()))
        .map(w => ({ word: w, frequency: freq.get(w)! }))
        .sort((a, b) => b.frequency - a.frequency)
      const totalTokens = Array.from(freq.values()).reduce((s, v) => s + v, 0)
      const oovTokenCount = oovWords.reduce((s, w) => s + w.frequency, 0)
      const coveragePct =
        uniqueWords.length > 0
          ? ((uniqueWords.length - oovWords.length) / uniqueWords.length) * 100
          : 100
      setResults({ totalTokens, uniqueWordCount: uniqueWords.length, oovWords, oovTokenCount, coveragePct })
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStatus('error')
    }
  }, [text])

  const handlePlay = useCallback(
    async (word: string) => {
      if (playingWord === word) {
        currentAudio.current?.pause()
        currentAudio.current = null
        setPlayingWord(null)
        return
      }
      currentAudio.current?.pause()
      currentAudio.current = null
      setPlayingWord(null)
      setLoadingWord(word)
      try {
        let url = audioCache.current.get(word)
        if (!url) {
          url = await fetchWordAudio(word)
          audioCache.current.set(word, url)
        }
        const audio = new Audio(url)
        currentAudio.current = audio
        audio.onended = () => {
          setPlayingWord(null)
          currentAudio.current = null
        }
        await audio.play()
        setPlayingWord(word)
      } catch {
        // fail silently
      } finally {
        setLoadingWord(null)
      }
    },
    [playingWord],
  )

  const handleGenerateScript = useCallback(async (overrideUseCase?: string) => {
    const target = overrideUseCase ?? useCase
    if (!target.trim()) return
    setGeneratingScript(true)
    setScriptError('')
    try {
      const script = await generateScript(target)
      handleTextChange(script)
      return script
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'Failed to generate script.')
    } finally {
      setGeneratingScript(false)
    }
  }, [useCase, handleTextChange])

  const handleLucky = useCallback(async () => {
    const pick = RANDOM_USE_CASES[Math.floor(Math.random() * RANDOM_USE_CASES.length)]
    setUseCase(pick)
    setGeneratingScript(true)
    setScriptError('')
    try {
      const script = await generateScript(pick)
      handleTextChange(script)
      const freq = parseWords(script)
      if (freq.size === 0) return
      setStatus('checking')
      setResults(null)
      const uniqueWords = Array.from(freq.keys())
      const oovList = await fetchOov(uniqueWords)
      const oovSet = new Set(oovList.map(w => w.toLowerCase()))
      const oovWords: OovWord[] = uniqueWords
        .filter(w => oovSet.has(w.toLowerCase()))
        .map(w => ({ word: w, frequency: freq.get(w)! }))
        .sort((a, b) => b.frequency - a.frequency)
      const totalTokens = Array.from(freq.values()).reduce((s, v) => s + v, 0)
      const oovTokenCount = oovWords.reduce((s, w) => s + w.frequency, 0)
      const coveragePct =
        uniqueWords.length > 0
          ? ((uniqueWords.length - oovWords.length) / uniqueWords.length) * 100
          : 100
      setResults({ totalTokens, uniqueWordCount: uniqueWords.length, oovWords, oovTokenCount, coveragePct })
      setStatus('done')
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'Something went wrong.')
      setStatus('error')
    } finally {
      setGeneratingScript(false)
    }
  }, [handleTextChange])

  const coverageColor =
    !results
      ? ''
      : results.coveragePct >= 95
        ? 'text-emerald-400'
        : results.coveragePct >= 80
          ? 'text-amber-400'
          : 'text-red-400'

  const barColor =
    !results
      ? ''
      : results.coveragePct >= 95
        ? 'bg-emerald-500'
        : results.coveragePct >= 80
          ? 'bg-amber-400'
          : 'bg-red-500'

  return (
    <div className="min-h-screen px-4 py-10" style={{ backgroundColor: 'var(--surface-0)' }}>
      <div className="mx-auto max-w-5xl">

        {/* Page header */}
        <div className="mb-8">
          <p
            className="mb-1 text-xs font-semibold uppercase tracking-widest"
            style={{ color: 'var(--text-muted)' }}
          >
            SpeechQA 2.0
          </p>
          <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--text-emphasis)' }}>
            Research
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Check how well Rime handles your vocabulary before you ship.
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[5fr_7fr]">

          {/* Left: Input card */}
          <div
            className="rounded-2xl"
            style={{
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border-default)',
            }}
          >
            <div className="p-5 pb-0">
              <textarea
                className="w-full resize-none rounded-xl p-4 font-mono text-sm leading-relaxed outline-none transition placeholder:font-sans"
                rows={12}
                placeholder="Paste a word list, script, or transcript…"
                value={text}
                onChange={e => handleTextChange(e.target.value)}
                style={{
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-emphasis)',
                }}
              />
            </div>

            {/* Word count */}
            <div className="px-5 py-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {wordCount > 0
                  ? `${wordCount.toLocaleString()} unique word${wordCount !== 1 ? 's' : ''}`
                  : 'Word lists, scripts, transcripts'}
              </span>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '0 20px' }} />

            {/* Generate helper row */}
            <div className="flex items-center gap-2 px-5 py-3">
              <span className="shrink-0 text-xs" style={{ color: 'var(--text-muted)' }}>
                Generate a sample:
              </span>
              <input
                type="text"
                placeholder="describe your use case…"
                value={useCase}
                onChange={e => { setUseCase(e.target.value); setScriptError('') }}
                onKeyDown={e => e.key === 'Enter' && handleGenerateScript()}
                className="min-w-0 flex-1 rounded-lg px-3 py-1.5 text-xs outline-none transition"
                style={{
                  backgroundColor: 'var(--surface-3)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-emphasis)',
                }}
              />
              <button
                onClick={() => handleGenerateScript()}
                disabled={!useCase.trim() || generatingScript}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
                style={{ backgroundColor: '#FF9300', color: '#000' }}
              >
                {generatingScript && useCase ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                    Generating…
                  </span>
                ) : 'Generate'}
              </button>
              <button
                onClick={handleLucky}
                disabled={generatingScript}
                className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
                style={{
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--surface-3)',
                }}
              >
                {generatingScript && !useCase ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text-secondary)]" />
                    Generating…
                  </span>
                ) : 'Surprise me'}
              </button>
            </div>

            {scriptError && (
              <p className="px-5 pb-2 text-xs" style={{ color: '#f87171' }}>
                {scriptError}
              </p>
            )}

            {/* Check Coverage — full-width primary action */}
            <div className="p-5 pt-2">
              <button
                onClick={handleCheck}
                disabled={wordCount === 0 || status === 'checking' || generatingScript}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: 'var(--text-emphasis)', color: 'var(--surface-0)' }}
              >
                {status === 'checking' ? (
                  <>
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                      style={{ borderColor: 'rgba(0,0,0,0.2)', borderTopColor: 'var(--surface-0)' }}
                    />
                    Checking…
                  </>
                ) : (
                  'Check Coverage'
                )}
              </button>
            </div>
          </div>

          {/* Right: Results panel — always rendered */}
          <div className="space-y-4">

            {/* Summary card */}
            <div
              className="rounded-2xl p-6"
              style={{
                backgroundColor: 'var(--surface-1)',
                border: '1px solid var(--border-default)',
              }}
            >
              {status === 'checking' ? (
                <div className="flex items-center justify-center py-6">
                  <span
                    className="h-6 w-6 animate-spin rounded-full border-2"
                    style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--text-emphasis)' }}
                  />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-8">
                    <div className="shrink-0 text-center">
                      {results ? (
                        <div className={`text-5xl font-bold leading-none tabular-nums ${coverageColor}`}>
                          {results.coveragePct.toFixed(1)}
                          <span className="text-3xl font-semibold">%</span>
                        </div>
                      ) : (
                        <div className="text-5xl font-bold leading-none" style={{ color: 'var(--text-muted)' }}>
                          —
                        </div>
                      )}
                      <div
                        className="mt-1.5 text-xs font-semibold uppercase tracking-widest"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        covered
                      </div>
                    </div>

                    <div className="h-16 w-px shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />

                    <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <Stat label="Total tokens" value={results ? results.totalTokens.toLocaleString() : '—'} />
                      <Stat label="Unique words" value={results ? results.uniqueWordCount.toLocaleString() : '—'} />
                      <Stat
                        label="OOV words"
                        value={results ? results.oovWords.length.toLocaleString() : '—'}
                        warn={!!results && results.oovWords.length > 0}
                      />
                      <Stat
                        label="OOV tokens"
                        value={results ? results.oovTokenCount.toLocaleString() : '—'}
                        warn={!!results && results.oovTokenCount > 0}
                      />
                    </dl>
                  </div>

                  <div
                    className="mt-5 h-1.5 overflow-hidden rounded-full"
                    style={{ backgroundColor: 'var(--surface-4)' }}
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                      style={{ width: results ? `${results.coveragePct}%` : '0%' }}
                    />
                  </div>
                </>
              )}
            </div>

            {/* OOV section */}
            {status === 'error' ? (
              <div
                className="rounded-2xl px-4 py-3 text-sm"
                style={{
                  backgroundColor: 'rgba(248,113,113,0.1)',
                  border: '1px solid rgba(248,113,113,0.3)',
                  color: '#f87171',
                }}
              >
                {error}
              </div>
            ) : status === 'checking' ? (
              <div
                className="flex items-center justify-center rounded-2xl px-6 py-10"
                style={{
                  backgroundColor: 'var(--surface-1)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Checking vocabulary…
                </span>
              </div>
            ) : status === 'done' && results && results.oovWords.length > 0 ? (
              <div
                className="overflow-hidden rounded-2xl"
                style={{
                  backgroundColor: 'var(--surface-1)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <div
                  className="px-5 py-4"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                >
                  <h2
                    className="flex items-center gap-2 text-sm font-semibold"
                    style={{ color: 'var(--text-emphasis)' }}
                  >
                    Out-of-vocabulary words
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}
                    >
                      {results.oovWords.length}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Rime will attempt to pronounce these. Click play to hear how.
                  </p>
                </div>

                <div>
                  {results.oovWords.map(({ word, frequency }, i) => (
                    <div
                      key={word}
                      className="flex items-center gap-3 px-5 py-3 transition"
                      style={{
                        borderTop: i > 0 ? '1px solid var(--border-subtle)' : undefined,
                      }}
                    >
                      <span
                        className="flex-1 font-mono text-sm font-medium"
                        style={{ color: 'var(--text-emphasis)' }}
                      >
                        {word}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs tabular-nums"
                        style={{
                          backgroundColor: 'var(--surface-3)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        ×{frequency.toLocaleString()}
                      </span>
                      <PlayButton
                        word={word}
                        isLoading={loadingWord === word}
                        isPlaying={playingWord === word}
                        onPlay={handlePlay}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : status === 'done' && results && results.oovWords.length === 0 ? (
              <div
                className="rounded-2xl px-6 py-10 text-center"
                style={{
                  backgroundColor: 'rgba(52,211,153,0.08)',
                  border: '1px solid rgba(52,211,153,0.2)',
                }}
              >
                <p className="text-lg font-semibold" style={{ color: '#34d399' }}>
                  Full coverage
                </p>
                <p className="mt-1 text-sm" style={{ color: 'rgba(52,211,153,0.7)' }}>
                  Every word in your input is in Rime's dictionary.
                </p>
              </div>
            ) : (
              // idle empty state
              <div
                className="rounded-2xl px-6 py-10 text-center"
                style={{
                  backgroundColor: 'var(--surface-1)',
                  border: '1px solid var(--border-default)',
                }}
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                  Out-of-vocabulary words will appear here
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--border-strong)' }}>
                  Enter text and click Check Coverage to analyze
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd
        className="font-semibold tabular-nums"
        style={{ color: warn ? '#fbbf24' : value === '—' ? 'var(--text-muted)' : 'var(--text-emphasis)' }}
      >
        {value}
      </dd>
    </>
  )
}

function PlayButton({
  word,
  isLoading,
  isPlaying,
  onPlay,
}: {
  word: string
  isLoading: boolean
  isPlaying: boolean
  onPlay: (word: string) => void
}) {
  return (
    <button
      onClick={() => onPlay(word)}
      disabled={isLoading}
      title={`Play Rime's pronunciation of "${word}"`}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
      style={{
        border: '1px solid var(--border-default)',
        backgroundColor: 'var(--surface-3)',
        color: isPlaying ? '#fbbf24' : 'var(--text-secondary)',
      }}
    >
      {isLoading ? (
        <>
          <span
            className="h-3 w-3 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--border-strong)', borderTopColor: '#FF9300' }}
          />
          Loading
        </>
      ) : isPlaying ? (
        <>■ Stop</>
      ) : (
        <>▶ Play</>
      )}
    </button>
  )
}
