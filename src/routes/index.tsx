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

const DEMO_TEXT = `Acme Corp's new Zyntex platform integrates directly with Salesforce CRM via GraphQL APIs.
Our CEO Elon Musk and CTO Satya Nadella discussed the roadmap at KubeCon last quarter.
The Liraglutide trial data from Dr. Schwarzkopf's team at Pfizer looks promising.
Please reach out to Ramamurthy or Wojciechowski on the ISV partnerships team.`

// ─── helpers ──────────────────────────────────────────────────────────────────

const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

function parseWords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    if (!isWordLike) continue
    const word = segment.toLowerCase()
    if (word.length >= 2 && /[a-z]/.test(word)) {
      freq.set(word, (freq.get(word) ?? 0) + 1)
    }
  }
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
  return res.json()
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

  // Script generator state
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
        .filter(w => oovSet.has(w))
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
      // auto-run coverage on the generated script
      const freq = parseWords(script)
      if (freq.size === 0) return
      setStatus('checking')
      setResults(null)
      const uniqueWords = Array.from(freq.keys())
      const oovList = await fetchOov(uniqueWords)
      const oovSet = new Set(oovList.map(w => w.toLowerCase()))
      const oovWords: OovWord[] = uniqueWords
        .filter(w => oovSet.has(w))
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
      ? 'text-white'
      : results.coveragePct >= 95
        ? 'text-emerald-400'
        : results.coveragePct >= 80
          ? 'text-amber-400'
          : 'text-red-400'

  const barColor =
    !results
      ? 'bg-[#3b3b3b]'
      : results.coveragePct >= 95
        ? 'bg-emerald-500'
        : results.coveragePct >= 80
          ? 'bg-amber-400'
          : 'bg-red-500'

  return (
    <div className="min-h-screen px-4 py-10" style={{ backgroundColor: 'var(--surface-0)' }}>
      <div className="mx-auto max-w-2xl">

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

        {/* Script generator */}
        <div
          className="mb-4 rounded-xl p-4"
          style={{
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Generate a script
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Describe your use case — e.g. healthcare scheduling, telecom support, pharmacy refills…"
              value={useCase}
              onChange={e => { setUseCase(e.target.value); setScriptError('') }}
              onKeyDown={e => e.key === 'Enter' && handleGenerateScript()}
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition"
              style={{
                backgroundColor: 'var(--surface-3)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-emphasis)',
              }}
            />
            <button
              onClick={() => handleGenerateScript()}
              disabled={!useCase.trim() || generatingScript}
              className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: '#FF9300', color: '#000' }}
            >
              {generatingScript ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                  Generating…
                </>
              ) : (
                'Generate'
              )}
            </button>
            <div className="relative group">
              <button
                onClick={handleLucky}
                disabled={generatingScript}
                className="flex shrink-0 items-center rounded-lg px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
                style={{
                  backgroundColor: 'var(--surface-4)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
              >
                🎲
              </button>
              <div
                className="pointer-events-none absolute bottom-full right-0 mb-2 w-48 rounded-lg px-3 py-2 text-xs opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  backgroundColor: 'var(--surface-4)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                I'm feeling lucky — picks a random use case, generates a script, and checks coverage automatically
              </div>
            </div>
          </div>
          {scriptError && (
            <p className="mt-2 text-xs" style={{ color: '#f87171' }}>
              {scriptError}
            </p>
          )}
        </div>

        {/* Input card */}
        <div
          className="rounded-2xl p-5"
          style={{
            backgroundColor: 'var(--surface-1)',
            border: '1px solid var(--border-default)',
          }}
        >
          <textarea
            className="w-full resize-none rounded-xl p-4 font-mono text-sm leading-relaxed outline-none transition placeholder:font-sans"
            rows={7}
            placeholder="Paste a word list, script, or transcript — or use Generate above."
            value={text}
            onChange={e => handleTextChange(e.target.value)}
            style={{
              backgroundColor: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-emphasis)',
            }}
          />

          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {wordCount > 0
                  ? `${wordCount.toLocaleString()} unique word${wordCount !== 1 ? 's' : ''}`
                  : 'Word lists, scripts, transcripts'}
              </span>
              {!text && (
                <button
                  onClick={() => handleTextChange(DEMO_TEXT)}
                  className="text-xs underline underline-offset-2 transition hover:opacity-80"
                  style={{ color: '#FF9300' }}
                >
                  Try an example
                </button>
              )}
            </div>
            <button
              onClick={handleCheck}
              disabled={wordCount === 0 || status === 'checking'}
              className="flex shrink-0 items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: 'var(--text-emphasis)', color: 'var(--surface-0)' }}
            >
              {status === 'checking' ? (
                <>
                  <span
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: 'var(--surface-0)', borderTopColor: 'transparent' }}
                  />
                  Checking…
                </>
              ) : (
                'Check Coverage'
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {status === 'error' && (
          <div
            className="mt-4 rounded-xl px-4 py-3 text-sm"
            style={{
              backgroundColor: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.3)',
              color: '#f87171',
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        {status === 'done' && results && (
          <div className="mt-5 space-y-4">

            {/* Summary */}
            <div
              className="rounded-2xl p-6"
              style={{
                backgroundColor: 'var(--surface-1)',
                border: '1px solid var(--border-default)',
              }}
            >
              <div className="flex items-center gap-8">
                <div className="shrink-0 text-center">
                  <div className={`text-5xl font-bold leading-none tabular-nums ${coverageColor}`}>
                    {results.coveragePct.toFixed(1)}
                    <span className="text-3xl font-semibold">%</span>
                  </div>
                  <div
                    className="mt-1.5 text-xs font-semibold uppercase tracking-widest"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    covered
                  </div>
                </div>

                <div className="h-16 w-px shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />

                <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <Stat label="Total tokens" value={results.totalTokens.toLocaleString()} />
                  <Stat label="Unique words" value={results.uniqueWordCount.toLocaleString()} />
                  <Stat
                    label="OOV words"
                    value={results.oovWords.length.toLocaleString()}
                    warn={results.oovWords.length > 0}
                  />
                  <Stat
                    label="OOV tokens"
                    value={results.oovTokenCount.toLocaleString()}
                    warn={results.oovTokenCount > 0}
                  />
                </dl>
              </div>

              <div
                className="mt-5 h-1.5 overflow-hidden rounded-full"
                style={{ backgroundColor: 'var(--surface-4)' }}
              >
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                  style={{ width: `${results.coveragePct}%` }}
                />
              </div>
            </div>

            {/* OOV list */}
            {results.oovWords.length > 0 ? (
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
            ) : (
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
            )}
          </div>
        )}
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
        style={{ color: warn ? '#fbbf24' : 'var(--text-emphasis)' }}
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
