import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useCallback, useMemo } from 'react'
import {
  parseWords,
  fetchOov,
  fetchWordAudio,
  fetchPhoneticAudio,
  fetchWordPhonetics,
  generateScript,
  type PhoneticResult,
} from '#/lib/api'

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

/**
 * A complete snapshot of one coverage run. Every piece of derived state
 * (results, phonetics, …) must live here so that Restore is fully lossless.
 * When adding new async data in future, initialise it as empty/null in
 * `runCheck` and patch it in-place once it arrives (see `loadPhonetics`).
 */
interface HistoryEntry {
  id: string
  label: string   // use case, or first line of pasted text
  text: string    // full input
  results: Results
  phonetics: Record<string, PhoneticResult>   // patched in async after check
  timestamp: Date
}

// ─── component ────────────────────────────────────────────────────────────────

function ResearchPage() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')

  // Audio: composite key = "word:default" or "word:suggested"
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null)
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const currentAudio = useRef<HTMLAudioElement | null>(null)

  const [useCase, setUseCase] = useState('')
  const [generatingScript, setGeneratingScript] = useState(false)
  const [scriptError, setScriptError] = useState('')

  // Phonetics: loaded after coverage check completes
  const [phonetics, setPhonetics] = useState<Record<string, PhoneticResult>>({})
  const [phoneticsLoading, setPhonleticsLoading] = useState(false)

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const wordCount = useMemo(() => parseWords(text).size, [text])

  const handleTextChange = useCallback((val: string) => {
    setText(val)
    setStatus('idle')
    setResults(null)
    setError('')
    setPhonetics({})
    setPhonleticsLoading(false)
  }, [])

  // Core check logic — returns the computed Results so callers can chain
  // phonetics fetching without depending on async state updates.
  const runCheck = useCallback(async (textToCheck: string, label?: string): Promise<Results | null> => {
    const freq = parseWords(textToCheck)
    if (freq.size === 0) return null
    setStatus('checking')
    setResults(null)
    setError('')
    setPhonetics({})
    setPhonleticsLoading(false)
    try {
      const uniqueWords = Array.from(freq.keys())
      const oovList = await fetchOov(uniqueWords, RIME_API_KEY)
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
      const newResults: Results = { totalTokens, uniqueWordCount: uniqueWords.length, oovWords, oovTokenCount, coveragePct }
      setResults(newResults)
      setStatus('done')
      // Derive a label from first non-empty line if none supplied
      const entryLabel = label?.trim() ||
        textToCheck.split('\n').find(l => l.trim())?.trim().slice(0, 72) ||
        'Untitled'
      setHistory(prev => [{
        id: crypto.randomUUID(),
        label: entryLabel,
        text: textToCheck,
        results: newResults,
        phonetics: {},   // populated async by loadPhonetics once it resolves
        timestamp: new Date(),
      }, ...prev])
      return newResults
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStatus('error')
      return null
    }
  }, [])

  // Kick off phonetics loading in the background (non-blocking).
  // When resolved, updates both the active state AND the most-recent history
  // entry so that Restore always brings back phonetics too.
  const loadPhonetics = useCallback((oovWords: OovWord[]) => {
    if (oovWords.length === 0) return
    setPhonleticsLoading(true)
    fetchWordPhonetics(oovWords.map(w => w.word), OPENAI_API_KEY)
      .then(p => {
        setPhonetics(p)
        // Patch the newest history entry — it was created moments ago in runCheck
        setHistory(prev => {
          if (prev.length === 0) return prev
          const [latest, ...rest] = prev
          return [{ ...latest, phonetics: p }, ...rest]
        })
      })
      .catch(() => { /* fail silently — phonetics are best-effort */ })
      .finally(() => setPhonleticsLoading(false))
  }, [])

  const handleCheck = useCallback(async () => {
    const res = await runCheck(text)
    if (res) loadPhonetics(res.oovWords)
  }, [text, runCheck, loadPhonetics])

  const handlePlay = useCallback(
    async (key: string, fetchFn: () => Promise<string>) => {
      if (playingAudio === key) {
        currentAudio.current?.pause()
        currentAudio.current = null
        setPlayingAudio(null)
        return
      }
      currentAudio.current?.pause()
      currentAudio.current = null
      setPlayingAudio(null)
      setLoadingAudio(key)
      try {
        let url = audioCache.current.get(key)
        if (!url) {
          url = await fetchFn()
          audioCache.current.set(key, url)
        }
        const audio = new Audio(url)
        currentAudio.current = audio
        audio.onended = () => {
          setPlayingAudio(null)
          currentAudio.current = null
        }
        await audio.play()
        setPlayingAudio(key)
      } catch {
        // fail silently
      } finally {
        setLoadingAudio(null)
      }
    },
    [playingAudio],
  )

  // Generate a script then immediately run coverage — single unified action.
  const handleGenerate = useCallback(async (overrideUseCase?: string) => {
    const target = (overrideUseCase ?? useCase).trim()
    if (!target) return
    setGeneratingScript(true)
    setScriptError('')
    try {
      const script = await generateScript(target, OPENAI_API_KEY)
      handleTextChange(script)
      const res = await runCheck(script, target)
      if (res) loadPhonetics(res.oovWords)
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'Failed to generate script.')
      setStatus('error')
    } finally {
      setGeneratingScript(false)
    }
  }, [useCase, handleTextChange, runCheck, loadPhonetics])

  const handleLucky = useCallback(async () => {
    const pick = RANDOM_USE_CASES[Math.floor(Math.random() * RANDOM_USE_CASES.length)]
    setUseCase(pick)
    await handleGenerate(pick)
  }, [handleGenerate])

  const handleRestore = useCallback((entry: HistoryEntry) => {
    setText(entry.text)
    setResults(entry.results)
    setPhonetics(entry.phonetics)   // restore full snapshot — nothing missing
    setStatus('done')
    setError('')
    setPhonleticsLoading(false)
  }, [])

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

  const isBusy = generatingScript || status === 'checking'
  const canDownloadCsv = !!(results && results.oovWords.length > 0)

  const handleDownloadCsv = useCallback(() => {
    if (!results || results.oovWords.length === 0) return
    const rows = [
      ['Word', 'Frequency', 'IPA Pronunciation', 'Rime Phonetic'],
      ...results.oovWords.map(({ word, frequency }) => {
        const p = phonetics[word]
        return [word, String(frequency), p?.ipa ?? '', p ? `{${p.rime}}` : '']
      }),
    ]
    const csv = rows
      .map(row => row.map(cell => (cell.includes(',') || cell.includes('"') ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'oov-words.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [results, phonetics])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--surface-0)' }}>

      {/* Page header */}
      <div
        className="flex items-center justify-between gap-4 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-emphasis)' }}>
            Research
          </h1>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            Check vocabulary coverage before you ship
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDownloadCsv}
            disabled={!canDownloadCsv}
            title={canDownloadCsv ? 'Download OOV words as CSV' : 'No out-of-vocabulary words to export'}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-1)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 9h8M6 1v6M3.5 4.5L6 7l2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            CSV
          </button>
          <a
            href="https://docs.rime.ai/"
            target="_blank"
            rel="noopener noreferrer"
            title="Rime documentation"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition hover:opacity-80"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-1)', textDecoration: 'none' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
              <line x1="3.5" y1="4.5" x2="8.5" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="3.5" y1="6.5" x2="8.5" y2="6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="3.5" y1="8.5" x2="6" y2="8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Docs
          </a>
        </div>
      </div>

      {/* Two-column layout — left: input + history | right: results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start p-6">

        {/* ── Left column: input card + history ── */}
        <div className="space-y-3">

          {/* Input card */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
          >
            {/* Generate from a use case */}
            <div className="p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-medium mb-2.5" style={{ color: 'var(--text-muted)' }}>
                Generate a sample script
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="describe your use case…"
                  value={useCase}
                  onChange={e => { setUseCase(e.target.value); setScriptError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                  disabled={isBusy}
                  className="flex-1 rounded-lg px-3 py-2 text-sm outline-none transition disabled:opacity-50"
                  style={{
                    minWidth: '180px',
                    backgroundColor: 'var(--surface-2)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-emphasis)',
                  }}
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleGenerate()}
                    disabled={!useCase.trim() || isBusy}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
                    style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)' }}
                  >
                    {generatingScript ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border-strong)', borderTopColor: 'var(--text-secondary)' }} />
                        Generating…
                      </>
                    ) : 'Generate'}
                  </button>
                  <button
                    onClick={handleLucky}
                    disabled={isBusy}
                    title="Pick a random use case and run coverage automatically"
                    className="rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
                    style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)' }}
                  >
                    Random
                  </button>
                </div>
              </div>
              {scriptError && (
                <p className="mt-2 text-xs" style={{ color: '#f87171' }}>{scriptError}</p>
              )}
            </div>

            {/* Textarea */}
            <div className="p-4 pb-3">
              <textarea
                className="w-full resize-none rounded-xl p-4 font-mono text-sm leading-relaxed outline-none transition placeholder:font-sans disabled:opacity-50"
                rows={10}
                placeholder="Paste a word list, script, or transcript…"
                value={text}
                onChange={e => handleTextChange(e.target.value)}
                disabled={isBusy}
                style={{
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-emphasis)',
                }}
              />
            </div>

            {/* Check Coverage — primary action */}
            <div
              className="flex items-center justify-between gap-4 px-4 py-3"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {wordCount > 0
                  ? `${wordCount.toLocaleString()} unique word${wordCount !== 1 ? 's' : ''}`
                  : 'Word lists, scripts, transcripts'}
              </span>
              <button
                onClick={handleCheck}
                disabled={wordCount === 0 || isBusy}
                className="flex shrink-0 items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: 'var(--text-emphasis)', color: 'var(--surface-0)' }}
              >
                {status === 'checking' && !generatingScript ? (
                  <>
                    <span
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                      style={{ borderColor: 'var(--surface-2)', borderTopColor: 'transparent' }}
                    />
                    Checking…
                  </>
                ) : 'Check Coverage'}
              </button>
            </div>
          </div>

          {/* History panel */}
          <HistoryPanel
            history={history}
            expanded={historyExpanded}
            onToggleExpanded={() => setHistoryExpanded(e => !e)}
            onRestore={handleRestore}
          />
        </div>

        {/* ── Right column: results ── */}
        <div>
          {/* Error */}
          {status === 'error' && (
            <div
              className="rounded-2xl px-4 py-3 text-sm mb-4"
              style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}
            >
              {error || scriptError}
            </div>
          )}

          {/* Loading skeleton */}
          {isBusy && (
            <div
              className="rounded-2xl p-6 animate-pulse"
              style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
            >
              <div className="flex items-center gap-8">
                <div className="shrink-0 text-center">
                  <div className="h-12 w-16 rounded-lg mb-2" style={{ backgroundColor: 'var(--surface-3)' }} />
                  <div className="h-3 w-12 rounded" style={{ backgroundColor: 'var(--surface-3)' }} />
                </div>
                <div className="h-16 w-px shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-4 rounded" style={{ backgroundColor: 'var(--surface-3)' }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--surface-3)' }} />
            </div>
          )}

          {/* Results */}
          {status === 'done' && results && !isBusy && (
            <div className="space-y-4">

              {/* Summary */}
              <div
                className="rounded-2xl p-6"
                style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
              >
                <div className="flex items-center gap-8">
                  <div className="shrink-0 text-center">
                    <div className={`text-5xl font-bold leading-none tabular-nums ${coverageColor}`}>
                      {results.coveragePct.toFixed(1)}
                      <span className="text-3xl font-semibold">%</span>
                    </div>
                    <div className="mt-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                      covered
                    </div>
                  </div>

                  <div className="h-16 w-px shrink-0" style={{ backgroundColor: 'var(--border-subtle)' }} />

                  <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    <Stat label="Total tokens" value={results.totalTokens.toLocaleString()} />
                    <Stat label="Unique words" value={results.uniqueWordCount.toLocaleString()} />
                    <Stat label="OOV words" value={results.oovWords.length.toLocaleString()} warn={results.oovWords.length > 0} />
                    <Stat label="OOV tokens" value={results.oovTokenCount.toLocaleString()} warn={results.oovTokenCount > 0} />
                  </dl>
                </div>

                <div className="mt-5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-4)' }}>
                  <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${results.coveragePct}%` }} />
                </div>
              </div>

              {/* OOV list */}
              {results.oovWords.length > 0 ? (
                <div
                  className="overflow-hidden rounded-2xl"
                  style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
                >
                  <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-emphasis)' }}>
                      Out-of-vocabulary words
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}
                      >
                        {results.oovWords.length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Rime will attempt to pronounce these. Hear how Rime says it, or try a suggested phonetic.
                    </p>
                  </div>

                  <div>
                    {results.oovWords.map(({ word, frequency }, i) => (
                      <OovRow
                        key={word}
                        word={word}
                        frequency={frequency}
                        isFirst={i === 0}
                        phonetic={phonetics[word]}
                        phoneticsLoading={phoneticsLoading && !phonetics[word]}
                        loadingAudio={loadingAudio}
                        playingAudio={playingAudio}
                        onPlay={handlePlay}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-2xl px-6 py-10 text-center"
                  style={{ backgroundColor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}
                >
                  <p className="text-lg font-semibold" style={{ color: '#34d399' }}>Full coverage</p>
                  <p className="mt-1 text-sm" style={{ color: 'rgba(52,211,153,0.7)' }}>
                    Every word in your input is in Rime's dictionary.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {status === 'idle' && !isBusy && (
            <div
              className="rounded-2xl px-6 py-12 text-center"
              style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
            >
              <div
                className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: 'var(--surface-3)' }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M9 1L2 4.5v5C2 13.5 5.1 16.8 9 17.5c3.9-.7 7-4 7-8v-5L9 1z" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinejoin="round"/>
                  <path d="M6 9l2 2 4-4" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                No results yet
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Generate a sample or paste your own text,<br />then run a coverage check.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── OovRow ───────────────────────────────────────────────────────────────────

function OovRow({
  word,
  frequency,
  isFirst,
  phonetic,
  phoneticsLoading,
  loadingAudio,
  playingAudio,
  onPlay,
}: {
  word: string
  frequency: number
  isFirst: boolean
  phonetic: PhoneticResult | undefined
  phoneticsLoading: boolean
  loadingAudio: string | null
  playingAudio: string | null
  onPlay: (key: string, fetchFn: () => Promise<string>) => void
}) {
  const defaultKey = `${word}:default`
  const suggestedKey = `${word}:suggested`
  const hasPhonetic = !!phonetic

  return (
    <div
      className="flex items-center gap-3 px-5 py-3 flex-wrap"
      style={{ borderTop: isFirst ? undefined : '1px solid var(--border-subtle)' }}
    >
      {/* Word */}
      <span className="font-mono text-sm font-medium" style={{ color: 'var(--text-emphasis)', minWidth: '6rem' }}>
        {word}
      </span>

      {/* Phonetic badges — IPA for readability, Rime encoding for copy/paste */}
      {phoneticsLoading ? (
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--surface-3)' }} />
          <div className="h-4 w-16 rounded animate-pulse" style={{ backgroundColor: 'var(--surface-3)' }} />
        </div>
      ) : hasPhonetic ? (
        <div className="flex items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5 text-xs"
            style={{
              backgroundColor: 'rgba(139,92,246,0.1)',
              border: '1px solid rgba(139,92,246,0.2)',
              color: '#a78bfa',
              fontFamily: 'Georgia, "Times New Roman", serif',
              letterSpacing: '0.01em',
            }}
            title="IPA pronunciation"
          >
            /{phonetic.ipa}/
          </span>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-xs"
            style={{
              backgroundColor: 'rgba(34,211,238,0.08)',
              border: '1px solid rgba(34,211,238,0.2)',
              color: '#67e8f9',
              userSelect: 'all',
            }}
            title="Rime phonetic encoding — click to select all"
          >
            {`{${phonetic.rime}}`}
          </span>
        </div>
      ) : null}

      {/* Frequency — pushed right */}
      <span
        className="ml-auto rounded-full px-2 py-0.5 text-xs tabular-nums"
        style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-muted)' }}
      >
        ×{frequency.toLocaleString()}
      </span>

      {/* Play buttons */}
      <PlayButton
        label="Current"
        isLoading={loadingAudio === defaultKey}
        isPlaying={playingAudio === defaultKey}
        title={`Hear Rime's current pronunciation of "${word}"`}
        onClick={() => onPlay(defaultKey, () => fetchWordAudio(word, RIME_API_KEY))}
      />

      {(hasPhonetic || phoneticsLoading) && (
        <PlayButton
          label="Suggested"
          isLoading={loadingAudio === suggestedKey}
          isPlaying={playingAudio === suggestedKey}
          disabled={!hasPhonetic}
          accent
          title={
            hasPhonetic
              ? `Hear Rime pronounce /${phonetic.ipa}/ (converted from IPA)`
              : 'Loading suggested pronunciation…'
          }
          onClick={() => {
            if (!phonetic) return
            onPlay(suggestedKey, () => fetchPhoneticAudio(phonetic.rime, RIME_API_KEY))
          }}
        />
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function PlayButton({
  label,
  isLoading,
  isPlaying,
  disabled,
  accent,
  title,
  onClick,
}: {
  label: string
  isLoading: boolean
  isPlaying: boolean
  disabled?: boolean
  accent?: boolean
  title?: string
  onClick: () => void
}) {
  const accentColor = '#a78bfa'
  return (
    <button
      onClick={onClick}
      disabled={isLoading || disabled}
      title={title}
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-80"
      style={{
        border: `1px solid ${accent ? 'rgba(139,92,246,0.3)' : 'var(--border-default)'}`,
        backgroundColor: accent ? 'rgba(139,92,246,0.08)' : 'var(--surface-3)',
        color: isPlaying ? (accent ? accentColor : '#fbbf24') : (accent ? accentColor : 'var(--text-secondary)'),
      }}
    >
      {isLoading ? (
        <>
          <span
            className="h-3 w-3 animate-spin rounded-full border-2"
            style={{ borderColor: 'var(--border-strong)', borderTopColor: accent ? accentColor : '#FF9300' }}
          />
          {label}
        </>
      ) : isPlaying ? (
        <>■ {label}</>
      ) : (
        <>▶ {label}</>
      )}
    </button>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd className="font-semibold tabular-nums" style={{ color: warn ? '#fbbf24' : 'var(--text-emphasis)' }}>
        {value}
      </dd>
    </>
  )
}

// ─── history ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function coverageBadgeStyle(pct: number): React.CSSProperties {
  if (pct >= 95) return { backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }
  if (pct >= 80) return { backgroundColor: 'rgba(251,191,36,0.12)', color: '#fbbf24' }
  return { backgroundColor: 'rgba(248,113,113,0.12)', color: '#f87171' }
}

function HistoryItem({ entry, onRestore }: { entry: HistoryEntry; onRestore: (e: HistoryEntry) => void }) {
  const [textExpanded, setTextExpanded] = useState(false)
  const PREVIEW_LEN = 120
  const preview = entry.text.slice(0, PREVIEW_LEN).replace(/\n/g, ' ')
  const isTruncated = entry.text.length > PREVIEW_LEN

  return (
    <div
      className="rounded-xl p-3"
      style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
          {entry.label}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
            style={coverageBadgeStyle(entry.results.coveragePct)}
          >
            {entry.results.coveragePct.toFixed(1)}%
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {timeAgo(entry.timestamp)}
          </span>
        </div>
      </div>

      {/* Text preview / full text */}
      <div
        className="rounded-lg px-3 py-2 mb-2 font-mono text-xs leading-relaxed"
        style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}
      >
        {textExpanded ? (
          <pre className="whitespace-pre-wrap break-words" style={{ fontFamily: 'inherit', margin: 0 }}>
            {entry.text}
          </pre>
        ) : (
          <span>{preview}{isTruncated ? '…' : ''}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {isTruncated && (
          <button
            onClick={() => setTextExpanded(e => !e)}
            className="text-xs transition hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
          >
            {textExpanded ? 'Collapse' : 'Show full text'}
          </button>
        )}
        <button
          onClick={() => onRestore(entry)}
          className="ml-auto text-xs font-medium transition hover:opacity-80"
          style={{ color: 'var(--text-secondary)' }}
        >
          Restore →
        </button>
      </div>
    </div>
  )
}

function HistoryPanel({
  history,
  expanded,
  onToggleExpanded,
  onRestore,
}: {
  history: HistoryEntry[]
  expanded: boolean
  onToggleExpanded: () => void
  onRestore: (e: HistoryEntry) => void
}) {
  const visible = expanded ? history : history.slice(0, 1)
  const hiddenCount = history.length - 1

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)', letterSpacing: '0.07em' }}>
          History
        </span>
        {history.length > 1 && (
          <button
            onClick={onToggleExpanded}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition hover:opacity-100"
            style={{
              color: 'var(--text-secondary)',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
              opacity: 0.75,
            }}
          >
            {expanded ? (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Show less
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {`+${hiddenCount} more`}
              </>
            )}
          </button>
        )}
      </div>

      {history.length === 0 ? (
        // Compact empty state — just a subtle hint, minimal vertical space
        <p className="text-xs px-0.5" style={{ color: 'var(--text-muted)' }}>
          Each coverage run is saved here so you can compare and restore previous inputs.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map(entry => (
            <HistoryItem key={entry.id} entry={entry} onRestore={onRestore} />
          ))}
        </div>
      )}
    </div>
  )
}
