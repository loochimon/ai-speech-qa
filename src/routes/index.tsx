import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useCallback, useMemo } from 'react'

export const Route = createFileRoute('/')({ component: ResearchPage })

// ─── constants ────────────────────────────────────────────────────────────────

const API_KEY = 'REDACTED_RIME_API_KEY'

const DEMO_TEXT = `Acme Corp's new Zyntex platform integrates directly with Salesforce CRM via GraphQL APIs.
Our CEO Elon Musk and CTO Satya Nadella discussed the roadmap at KubeCon last quarter.
The Liraglutide trial data from Dr. Schwarzkopf's team at Pfizer looks promising.
Please reach out to Ramamurthy or Wojciechowski on the ISV partnerships team.`

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract words and their frequencies from arbitrary text.
 * Handles free text, CSV, newline-separated lists, scripts, transcripts.
 */
function parseWords(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, ' ') // keep apostrophes + hyphens mid-word
    .split(/\s+/)

  for (let token of tokens) {
    token = token.replace(/^['\-]+|['\-]+$/g, '') // strip leading/trailing ' and -
    if (token.length >= 2 && /[a-z]/.test(token)) {
      freq.set(token, (freq.get(token) ?? 0) + 1)
    }
  }
  return freq
}

async function fetchOov(words: string[]): Promise<string[]> {
  const res = await fetch('https://beta.rime.ai/oov', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
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
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mp3',
    },
    body: JSON.stringify({ text: word, speaker: 'lagoon', modelId: 'mistv2' }),
  })
  if (!res.ok) throw new Error(`TTS API error ${res.status}`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
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
  oovTokenCount: number   // sum of frequencies for OOV words
  coveragePct: number     // unique-word coverage
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
      // Toggle off
      if (playingWord === word) {
        currentAudio.current?.pause()
        currentAudio.current = null
        setPlayingWord(null)
        return
      }

      // Stop current
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
        // audio failed silently — could add error toast here
      } finally {
        setLoadingWord(null)
      }
    },
    [playingWord],
  )

  const coverageColor =
    !results ? 'text-gray-900'
    : results.coveragePct >= 95 ? 'text-emerald-600'
    : results.coveragePct >= 80 ? 'text-amber-500'
    : 'text-red-500'

  const barColor =
    !results ? 'bg-gray-300'
    : results.coveragePct >= 95 ? 'bg-emerald-500'
    : results.coveragePct >= 80 ? 'bg-amber-400'
    : 'bg-red-400'

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900">
      <div className="mx-auto max-w-2xl px-4 py-14">

        {/* Header */}
        <div className="mb-8">
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-teal-600">SpeechQA 2.0</p>
          <h1 className="text-3xl font-bold tracking-tight">Research</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Check how well Rime handles your vocabulary before you ship.
          </p>
        </div>

        {/* Input card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <textarea
            className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed text-gray-800 placeholder:font-sans placeholder:text-gray-400 transition focus:border-teal-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-100"
            rows={7}
            placeholder="Paste a word list, script, or transcript — one word per line, comma-separated, or free text."
            value={text}
            onChange={e => handleTextChange(e.target.value)}
          />

          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">
                {wordCount > 0
                  ? `${wordCount.toLocaleString()} unique word${wordCount !== 1 ? 's' : ''}`
                  : 'Word lists, scripts, transcripts'}
              </span>
              {!text && (
                <button
                  onClick={() => handleTextChange(DEMO_TEXT)}
                  className="text-xs text-teal-600 underline underline-offset-2 hover:text-teal-700"
                >
                  Try an example
                </button>
              )}
            </div>

            <button
              onClick={handleCheck}
              disabled={wordCount === 0 || status === 'checking'}
              className="flex shrink-0 items-center gap-2 rounded-full bg-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === 'checking' ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Results */}
        {status === 'done' && results && (
          <div className="mt-5 space-y-4">

            {/* Summary */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-8">
                {/* Big number */}
                <div className="shrink-0 text-center">
                  <div className={`text-5xl font-bold leading-none tabular-nums ${coverageColor}`}>
                    {results.coveragePct.toFixed(1)}
                    <span className="text-3xl font-semibold">%</span>
                  </div>
                  <div className="mt-1.5 text-xs font-semibold uppercase tracking-widest text-gray-400">
                    covered
                  </div>
                </div>

                <div className="h-16 w-px shrink-0 bg-gray-100" />

                {/* Stats */}
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

              {/* Coverage bar */}
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                  style={{ width: `${results.coveragePct}%` }}
                />
              </div>
            </div>

            {/* OOV word list */}
            {results.oovWords.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 px-5 py-4">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    Out-of-vocabulary words
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {results.oovWords.length}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Rime will attempt to pronounce these. Click play to hear how.
                  </p>
                </div>

                <div className="divide-y divide-gray-50">
                  {results.oovWords.map(({ word, frequency }) => (
                    <div
                      key={word}
                      className="flex items-center gap-3 px-5 py-3 transition hover:bg-gray-50"
                    >
                      <span className="flex-1 font-mono text-sm font-medium">{word}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs tabular-nums text-gray-500">
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
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-10 text-center">
                <p className="text-lg font-semibold text-emerald-700">Full coverage</p>
                <p className="mt-1 text-sm text-emerald-600">
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
      <dt className="text-gray-500">{label}</dt>
      <dd className={`font-semibold tabular-nums ${warn ? 'text-amber-600' : 'text-gray-800'}`}>
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
      className="flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {isLoading ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-200 border-t-teal-600" />
          Loading
        </>
      ) : isPlaying ? (
        <>
          <span>■</span> Stop
        </>
      ) : (
        <>
          <span>▶</span> Play
        </>
      )}
    </button>
  )
}
