import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  parseWords,
  fetchOov,
  fetchWordAudio,
  fetchPhoneticAudio,
  fetchWordPhonetics,
  fetchVoices,
  generateScript,
  type PhoneticResult,
  type VoiceEntry,
} from '#/lib/api'

export const Route = createFileRoute('/')({ component: ResearchPage })

// ─── constants ────────────────────────────────────────────────────────────────

const RIME_API_KEY = import.meta.env.VITE_RIME_API_KEY as string
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string
const DEFAULT_VOICE = 'lagoon'

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

interface OovWord { word: string; frequency: number }

interface Results {
  totalTokens: number
  uniqueWordCount: number
  oovWords: OovWord[]
  oovTokenCount: number
  coveragePct: number
}

interface Toast { id: string; message: string }

/**
 * Complete snapshot of one coverage run. Every piece of derived state lives
 * here so Restore is fully lossless. When adding new async data in future,
 * initialise as empty in `runCheck` and patch once it arrives (see `loadPhonetics`).
 */
interface HistoryEntry {
  id: string
  label: string
  text: string
  results: Results
  phonetics: Record<string, PhoneticResult>
  submittedWords: string[]
  voice: string
  timestamp: Date
}

// ─── component ────────────────────────────────────────────────────────────────

function ResearchPage() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState('')

  const [loadingAudio, setLoadingAudio] = useState<string | null>(null)
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const currentAudio = useRef<HTMLAudioElement | null>(null)

  const [useCase, setUseCase] = useState('')
  const [generatingScript, setGeneratingScript] = useState(false)
  const [scriptError, setScriptError] = useState('')

  const [phonetics, setPhonetics] = useState<Record<string, PhoneticResult>>({})
  const [phoneticsLoading, setPhonleticsLoading] = useState(false)

  const [submittedWords, setSubmittedWords] = useState<Set<string>>(new Set())
  const [correctionWord, setCorrectionWord] = useState<string | null>(null)

  const [toasts, setToasts] = useState<Toast[]>([])

  const [voices, setVoices] = useState<VoiceEntry[]>([])
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE)

  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const wordCount = useMemo(() => parseWords(text).size, [text])

  // Load voice catalogue once on mount
  useEffect(() => {
    fetchVoices()
      .then(setVoices)
      .catch(() => {}) // fail silently — lagoon always works as fallback
  }, [])

  // ── toast helpers ───────────────────────────────────────────────────────────

  const addToast = useCallback((message: string) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  // ── text / file helpers ─────────────────────────────────────────────────────

  const handleTextChange = useCallback((val: string) => {
    setText(val)
    setStatus('idle')
    setResults(null)
    setError('')
    setPhonetics({})
    setPhonleticsLoading(false)
    setSubmittedWords(new Set())
  }, [])

  const readFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'txt' || ext === 'csv') {
      const reader = new FileReader()
      reader.onload = e => handleTextChange(e.target?.result as string ?? '')
      reader.readAsText(file)
    } else {
      addToast(`PDF and DOCX upload coming soon — please paste the text directly`)
    }
  }, [handleTextChange, addToast])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) readFile(file)
    e.target.value = '' // allow re-selecting same file
  }, [readFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) readFile(file)
  }, [readFile])

  // ── core check ──────────────────────────────────────────────────────────────

  const runCheck = useCallback(async (textToCheck: string, label?: string): Promise<Results | null> => {
    const freq = parseWords(textToCheck)
    if (freq.size === 0) return null
    setStatus('checking')
    setResults(null)
    setError('')
    setPhonetics({})
    setPhonleticsLoading(false)
    setSubmittedWords(new Set())
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
      const coveragePct = uniqueWords.length > 0
        ? ((uniqueWords.length - oovWords.length) / uniqueWords.length) * 100
        : 100
      const newResults: Results = { totalTokens, uniqueWordCount: uniqueWords.length, oovWords, oovTokenCount, coveragePct }
      setResults(newResults)
      setStatus('done')
      const entryLabel = label?.trim() ||
        textToCheck.split('\n').find(l => l.trim())?.trim().slice(0, 72) ||
        'Untitled'
      setHistory(prev => [{
        id: crypto.randomUUID(),
        label: entryLabel,
        text: textToCheck,
        results: newResults,
        phonetics: {},
        submittedWords: [],
        voice: selectedVoice,
        timestamp: new Date(),
      }, ...prev])
      return newResults
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setStatus('error')
      return null
    }
  }, [selectedVoice])

  const loadPhonetics = useCallback((oovWords: OovWord[]) => {
    if (oovWords.length === 0) return
    setPhonleticsLoading(true)
    fetchWordPhonetics(oovWords.map(w => w.word), OPENAI_API_KEY)
      .then(p => {
        setPhonetics(p)
        setHistory(prev => {
          if (prev.length === 0) return prev
          const [latest, ...rest] = prev
          return [{ ...latest, phonetics: p }, ...rest]
        })
      })
      .catch(() => {})
      .finally(() => setPhonleticsLoading(false))
  }, [])

  const handleCheck = useCallback(async () => {
    const res = await runCheck(text)
    if (res) loadPhonetics(res.oovWords)
  }, [text, runCheck, loadPhonetics])

  // ── audio ───────────────────────────────────────────────────────────────────

  const handlePlay = useCallback(async (key: string, fetchFn: () => Promise<string>) => {
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
      audio.onended = () => { setPlayingAudio(null); currentAudio.current = null }
      await audio.play()
      setPlayingAudio(key)
    } catch { /* fail silently */ }
    finally { setLoadingAudio(null) }
  }, [playingAudio])

  // ── generate ────────────────────────────────────────────────────────────────

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

  // ── restore ─────────────────────────────────────────────────────────────────

  const handleRestore = useCallback((entry: HistoryEntry) => {
    setText(entry.text)
    setResults(entry.results)
    setPhonetics(entry.phonetics)
    setSubmittedWords(new Set(entry.submittedWords))
    setSelectedVoice(entry.voice)
    // Clear audio cache so the restored voice is used for fresh playback
    audioCache.current.clear()
    setPlayingAudio(null)
    setLoadingAudio(null)
    setStatus('done')
    setError('')
    setPhonleticsLoading(false)
  }, [])

  // ── correction requests ──────────────────────────────────────────────────────

  const handleSubmitCorrection = useCallback((word: string) => {
    setSubmittedWords(prev => new Set([...prev, word]))
    setHistory(h => {
      if (h.length === 0) return h
      const [latest, ...rest] = h
      return [{ ...latest, submittedWords: [...new Set([...latest.submittedWords, word])] }, ...rest]
    })
    setCorrectionWord(null)
    addToast(`Correction requested for "${word}" — the annotation team will be notified`)
  }, [addToast])

  // ── exports ─────────────────────────────────────────────────────────────────

  const canDownloadCsv = !!(results && results.oovWords.length > 0)
  const canExportPdf = !!results

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

  const handleExportPdf = useCallback(() => {
    if (!results) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210
    const margin = 15

    // ── Header bar ──
    doc.setFillColor(22, 22, 22)
    doc.rect(0, 0, W, 26, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Rime SpeechQA', margin, 11)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(180, 180, 180)
    doc.text('Research Report', margin, 18)
    doc.text(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      W - margin, 18, { align: 'right' }
    )

    let y = 36

    // ── Label ──
    const label = useCase.trim() ||
      text.split('\n').find(l => l.trim())?.trim().slice(0, 80) ||
      'Untitled'
    doc.setTextColor(120, 120, 120)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('USE CASE', margin, y)
    y += 4
    doc.setTextColor(30, 30, 30)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(label, margin, y)
    y += 10

    // ── Coverage score ──
    const pct = results.coveragePct
    const [r, g, b] = pct >= 95 ? [52, 211, 153] : pct >= 80 ? [217, 119, 6] : [220, 38, 38]
    doc.setTextColor(r, g, b)
    doc.setFontSize(40)
    doc.setFont('helvetica', 'bold')
    doc.text(`${pct.toFixed(1)}%`, margin, y + 12)
    doc.setTextColor(120, 120, 120)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text('coverage', margin + 34, y + 12)
    y += 22

    // ── Stats ──
    const stats = [
      ['Total tokens', results.totalTokens.toLocaleString()],
      ['Unique words', results.uniqueWordCount.toLocaleString()],
      ['OOV words', results.oovWords.length.toLocaleString()],
      ['OOV tokens', results.oovTokenCount.toLocaleString()],
    ]
    const colW = (W - 2 * margin) / 4
    stats.forEach(([lbl, val], i) => {
      const x = margin + i * colW
      doc.setTextColor(140, 140, 140)
      doc.setFontSize(7)
      doc.text(lbl.toUpperCase(), x, y)
      doc.setTextColor(30, 30, 30)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.text(val, x, y + 6)
      doc.setFont('helvetica', 'normal')
    })
    y += 18

    // ── OOV table ──
    if (results.oovWords.length > 0) {
      doc.setDrawColor(220, 220, 220)
      doc.line(margin, y, W - margin, y)
      y += 6
      doc.setTextColor(30, 30, 30)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Out-of-vocabulary words', margin, y)
      y += 4

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Word', 'Freq', 'IPA Pronunciation', 'Rime Phonetic', 'Status']],
        body: results.oovWords.map(({ word, frequency }) => {
          const p = phonetics[word]
          const submitted = submittedWords.has(word)
          return [
            word,
            frequency.toLocaleString(),
            p ? `/${p.ipa}/` : '—',
            p ? `{${p.rime}}` : '—',
            submitted ? 'Requested' : 'Pending',
          ]
        }),
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
          0: { fontStyle: 'bold' },
          4: { textColor: [120, 120, 120] },
        },
      })
    } else {
      doc.setFillColor(235, 253, 245)
      doc.roundedRect(margin, y, W - 2 * margin, 16, 3, 3, 'F')
      doc.setTextColor(22, 163, 74)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Full coverage — every word is in the Rime dictionary', W / 2, y + 10, { align: 'center' })
    }

    // ── Footer ──
    const pageH = doc.internal.pageSize.getHeight()
    doc.setTextColor(180, 180, 180)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('Generated by Rime SpeechQA · docs.rime.ai', W / 2, pageH - 8, { align: 'center' })

    doc.save(`rime-speechqa-${new Date().toISOString().slice(0, 10)}.pdf`)
  }, [results, phonetics, submittedWords, useCase, text])

  // ── derived ─────────────────────────────────────────────────────────────────

  const isBusy = generatingScript || status === 'checking'

  const coverageColor = !results ? 'text-white'
    : results.coveragePct >= 95 ? 'text-emerald-400'
    : results.coveragePct >= 80 ? 'text-amber-400'
    : 'text-red-400'

  const barColor = !results ? 'bg-[#3b3b3b]'
    : results.coveragePct >= 95 ? 'bg-emerald-500'
    : results.coveragePct >= 80 ? 'bg-amber-400'
    : 'bg-red-500'

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--surface-0)' }}>

      {/* ── Page header ── */}
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
          <button
            onClick={handleExportPdf}
            disabled={!canExportPdf}
            title={canExportPdf ? 'Export results as a shareable PDF report' : 'Run a coverage check to export a report'}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-1)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="1" width="8" height="10" rx="1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 4h4M4 6h4M4 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
            PDF
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

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start p-6">

        {/* ── Left column ── */}
        <div className="space-y-3">

          {/* Input card */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}
          >
            {/* Generate section */}
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
                  style={{ minWidth: '180px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-emphasis)' }}
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

            {/* Textarea with drag-and-drop + file upload */}
            <div className="p-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Script or word list</span>
                <label
                  className="flex items-center gap-1 text-xs font-medium cursor-pointer transition hover:opacity-80"
                  style={{ color: 'var(--text-muted)' }}
                  title="Upload a .txt or .csv file"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M1 8h9M5.5 1v6M3 3.5L5.5 1 8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Upload file
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv,.pdf,.docx"
                    className="sr-only"
                    onChange={handleFileInput}
                  />
                </label>
              </div>
              <div
                className="relative rounded-xl overflow-hidden transition-all"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{ outline: isDragging ? '2px dashed var(--text-muted)' : '2px solid transparent', outlineOffset: '-2px' }}
              >
                {isDragging && (
                  <div
                    className="absolute inset-0 flex items-center justify-center rounded-xl z-10"
                    style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
                  >
                    <span className="text-sm font-medium" style={{ color: 'var(--text-emphasis)' }}>
                      Drop file to import
                    </span>
                  </div>
                )}
                <textarea
                  className="w-full resize-none rounded-xl p-4 font-mono text-sm leading-relaxed outline-none transition placeholder:font-sans disabled:opacity-50"
                  rows={10}
                  placeholder="Paste a word list, script, or transcript…"
                  value={text}
                  onChange={e => handleTextChange(e.target.value)}
                  disabled={isBusy}
                  style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)', color: 'var(--text-emphasis)' }}
                />
              </div>
            </div>

            {/* Action bar: voice picker + word count + check coverage */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <VoicePicker
                voices={voices}
                selected={selectedVoice}
                onSelect={v => {
                  setSelectedVoice(v)
                  audioCache.current.clear() // flush cache so new voice is used
                }}
              />
              <span className="flex-1 text-xs text-right" style={{ color: 'var(--text-muted)' }}>
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
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2" style={{ borderColor: 'var(--surface-2)', borderTopColor: 'transparent' }} />
                    Checking…
                  </>
                ) : 'Check Coverage'}
              </button>
            </div>
          </div>

          {/* History */}
          <HistoryPanel
            history={history}
            expanded={historyExpanded}
            onToggleExpanded={() => setHistoryExpanded(e => !e)}
            onRestore={handleRestore}
          />
        </div>

        {/* ── Right column: results ── */}
        <div>
          {status === 'error' && (
            <div
              className="rounded-2xl px-4 py-3 text-sm mb-4"
              style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}
            >
              {error || scriptError}
            </div>
          )}

          {isBusy && (
            <div className="rounded-2xl p-6 animate-pulse" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
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

          {status === 'done' && results && !isBusy && (
            <div className="space-y-4">

              {/* Summary card */}
              <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-8">
                  <div className="shrink-0 text-center">
                    <div className={`text-5xl font-bold leading-none tabular-nums ${coverageColor}`}>
                      {results.coveragePct.toFixed(1)}<span className="text-3xl font-semibold">%</span>
                    </div>
                    <div className="mt-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>covered</div>
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
                <div className="overflow-hidden rounded-2xl" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
                  <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-emphasis)' }}>
                      Out-of-vocabulary words
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                        {results.oovWords.length}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Hear Rime's current attempt, or play the IPA-guided suggestion. Request a correction to have the annotation team add it to the dictionary.
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
                        selectedVoice={selectedVoice}
                        isSubmitted={submittedWords.has(word)}
                        onRequestFix={word => setCorrectionWord(word)}
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
                  <p className="mt-1 text-sm" style={{ color: 'rgba(52,211,153,0.7)' }}>Every word in your input is in Rime's dictionary.</p>
                </div>
              )}
            </div>
          )}

          {status === 'idle' && !isBusy && (
            <div className="rounded-2xl px-6 py-12 text-center" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--surface-3)' }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 1L2 4.5v5C2 13.5 5.1 16.8 9 17.5c3.9-.7 7-4 7-8v-5L9 1z" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M6 9l2 2 4-4" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No results yet</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                Generate a sample or paste your own text,<br />then run a coverage check.
              </p>
            </div>
          )}
        </div>

      </div>

      {/* ── Correction modal ── */}
      {correctionWord && (
        <CorrectionModal
          word={correctionWord}
          phonetic={phonetics[correctionWord]}
          onClose={() => setCorrectionWord(null)}
          onSubmit={() => handleSubmitCorrection(correctionWord)}
        />
      )}

      {/* ── Toasts ── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

// ─── VoicePicker ──────────────────────────────────────────────────────────────

function VoicePicker({
  voices,
  selected,
  onSelect,
}: {
  voices: VoiceEntry[]
  selected: string
  onSelect: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState<'all' | 'Male' | 'Female' | 'Non-binary'>('all')
  const [flagshipOnly, setFlagshipOnly] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) { setSearch(''); return }
    setTimeout(() => searchRef.current?.focus(), 50)
    const handle = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    return voices.filter(v => {
      if (genderFilter !== 'all' && v.gender !== genderFilter) return false
      if (flagshipOnly && !v.flagship) return false
      if (search) {
        const q = search.toLowerCase()
        return v.speaker.toLowerCase().includes(q) || v.dialect.toLowerCase().includes(q) || v.demographic.toLowerCase().includes(q)
      }
      return true
    })
  }, [voices, genderFilter, flagshipOnly, search])

  const selectedEntry = voices.find(v => v.speaker === selected)

  const genderOptions: { value: typeof genderFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Non-binary', label: 'Non-binary' },
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition hover:opacity-80"
        style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)', maxWidth: '140px' }}
        title="Select preview voice"
      >
        {/* Waveform icon */}
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
          <rect x="0" y="4" width="1.5" height="3" rx="0.75" fill="currentColor" opacity="0.5" />
          <rect x="2.5" y="2.5" width="1.5" height="6" rx="0.75" fill="currentColor" opacity="0.7" />
          <rect x="5" y="0" width="1.5" height="11" rx="0.75" fill="currentColor" />
          <rect x="7.5" y="2.5" width="1.5" height="6" rx="0.75" fill="currentColor" opacity="0.7" />
        </svg>
        <span className="truncate flex-1">{selected}</span>
        {selectedEntry?.flagship && <span style={{ color: '#fbbf24', fontSize: '9px' }}>★</span>}
        {/* Chevron */}
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <path d={open ? 'M1.5 6L4.5 3L7.5 6' : 'M1.5 3L4.5 6L7.5 3'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            zIndex: 100,
            width: '300px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border-default)',
            borderRadius: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
        >
          {/* Search */}
          <div className="p-2.5 pb-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ backgroundColor: 'var(--surface-3)', border: '1px solid var(--border-subtle)' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or accent…"
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: 'var(--text-emphasis)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ color: 'var(--text-muted)', lineHeight: 1 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1.5 px-2.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            {genderOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setGenderFilter(opt.value)}
                className="rounded-md px-2 py-0.5 text-xs font-medium transition hover:opacity-80"
                style={{
                  backgroundColor: genderFilter === opt.value ? 'var(--surface-4)' : 'transparent',
                  color: genderFilter === opt.value ? 'var(--text-emphasis)' : 'var(--text-muted)',
                  border: `1px solid ${genderFilter === opt.value ? 'var(--border-default)' : 'transparent'}`,
                }}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => setFlagshipOnly(f => !f)}
              className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium transition hover:opacity-80"
              style={{
                backgroundColor: flagshipOnly ? 'rgba(251,191,36,0.12)' : 'transparent',
                color: flagshipOnly ? '#fbbf24' : 'var(--text-muted)',
                border: `1px solid ${flagshipOnly ? 'rgba(251,191,36,0.3)' : 'transparent'}`,
              }}
            >
              ★ Flagship
            </button>
          </div>

          {/* Voice list */}
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>No voices match</p>
            ) : (
              filtered.map(v => (
                <button
                  key={v.speaker}
                  onClick={() => { onSelect(v.speaker); setOpen(false) }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition hover:opacity-80"
                  style={{
                    backgroundColor: v.speaker === selected ? 'var(--surface-3)' : 'transparent',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span
                    className="font-medium"
                    style={{ color: v.speaker === selected ? 'var(--text-emphasis)' : 'var(--text-secondary)', minWidth: '72px' }}
                  >
                    {v.speaker}
                  </span>
                  {v.flagship && <span style={{ color: '#fbbf24', fontSize: '9px', flexShrink: 0 }}>★</span>}
                  <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                    {v.dialect} · {v.gender} · {v.age}
                  </span>
                  {v.speaker === selected && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-auto shrink-0">
                      <path d="M2 5l2.5 2.5L8 3" stroke="var(--text-emphasis)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Count footer */}
          <div
            className="px-3 py-2 text-xs"
            style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            {filtered.length} voice{filtered.length !== 1 ? 's' : ''}
            {voices.length > 0 && filtered.length < voices.length ? ` of ${voices.length}` : ''}
          </div>
        </div>
      )}
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
  selectedVoice,
  isSubmitted,
  onRequestFix,
}: {
  word: string
  frequency: number
  isFirst: boolean
  phonetic: PhoneticResult | undefined
  phoneticsLoading: boolean
  loadingAudio: string | null
  playingAudio: string | null
  onPlay: (key: string, fetchFn: () => Promise<string>) => void
  selectedVoice: string
  isSubmitted: boolean
  onRequestFix: (word: string) => void
}) {
  const defaultKey = `${word}:default`
  const suggestedKey = `${word}:suggested`
  const hasPhonetic = !!phonetic

  return (
    <div
      style={{
        borderTop: isFirst ? undefined : '1px solid var(--border-subtle)',
        padding: '10px 20px',
      }}
    >
      {/* Row 1: word + controls — never wraps */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        {/* Word — shrinks before controls do */}
        <span
          style={{
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--text-emphasis)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={word}
        >
          {word}
        </span>

        {/* Controls — pushed right, never shrink or wrap */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span
            style={{
              borderRadius: '999px',
              padding: '1px 7px',
              fontSize: '11px',
              fontVariantNumeric: 'tabular-nums',
              backgroundColor: 'var(--surface-3)',
              color: 'var(--text-muted)',
            }}
          >
            ×{frequency.toLocaleString()}
          </span>

          <PlayButton
            label="Current"
            isLoading={loadingAudio === defaultKey}
            isPlaying={playingAudio === defaultKey}
            title={`Hear how "${word}" sounds with voice: ${selectedVoice}`}
            onClick={() => onPlay(defaultKey, () => fetchWordAudio(word, RIME_API_KEY, selectedVoice))}
          />
          {(hasPhonetic || phoneticsLoading) && (
            <PlayButton
              label="Suggested"
              isLoading={loadingAudio === suggestedKey}
              isPlaying={playingAudio === suggestedKey}
              disabled={!hasPhonetic}
              accent
              title={hasPhonetic ? `Hear Rime pronounce /${phonetic.ipa}/ with voice: ${selectedVoice}` : 'Loading…'}
              onClick={() => {
                if (!phonetic) return
                onPlay(suggestedKey, () => fetchPhoneticAudio(phonetic.rime, RIME_API_KEY, selectedVoice))
              }}
            />
          )}

          <button
            onClick={() => !isSubmitted && onRequestFix(word)}
            disabled={isSubmitted}
            title={isSubmitted ? 'Correction already requested' : 'Request pronunciation correction from the Rime annotation team'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              border: `1px solid ${isSubmitted ? 'rgba(52,211,153,0.3)' : 'var(--border-default)'}`,
              backgroundColor: isSubmitted ? 'rgba(52,211,153,0.08)' : 'var(--surface-3)',
              color: isSubmitted ? '#34d399' : 'var(--text-muted)',
              cursor: isSubmitted ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            {isSubmitted ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 9.5V7l4.5-5.5 1.5 1.5L3.5 8.5H2zM6.5 3l1.5-1 2 2-1 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 1l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Row 2: phonetic badges — shown below the word when available */}
      {(phoneticsLoading || hasPhonetic) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px' }}>
          {phoneticsLoading ? (
            <>
              <div style={{ height: '18px', width: '80px', borderRadius: '4px', backgroundColor: 'var(--surface-3)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <div style={{ height: '18px', width: '64px', borderRadius: '4px', backgroundColor: 'var(--surface-3)', animation: 'pulse 1.5s ease-in-out infinite' }} />
            </>
          ) : (
            <>
              <span
                style={{
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '11.5px',
                  backgroundColor: 'rgba(139,92,246,0.1)',
                  border: '1px solid rgba(139,92,246,0.2)',
                  color: '#a78bfa',
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  letterSpacing: '0.01em',
                  whiteSpace: 'nowrap',
                }}
                title="IPA pronunciation"
              >
                /{phonetic!.ipa}/
              </span>
              <span
                style={{
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '11.5px',
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  backgroundColor: 'rgba(34,211,238,0.08)',
                  border: '1px solid rgba(34,211,238,0.2)',
                  color: '#67e8f9',
                  userSelect: 'all',
                  whiteSpace: 'nowrap',
                }}
                title="Rime phonetic encoding — click to select all"
              >
                {`{${phonetic!.rime}}`}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── CorrectionModal ──────────────────────────────────────────────────────────

function CorrectionModal({
  word,
  phonetic,
  onClose,
  onSubmit,
}: {
  word: string
  phonetic: PhoneticResult | undefined
  onClose: () => void
  onSubmit: () => void
}) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-emphasis)' }}>
              Request pronunciation correction
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              The Rime annotation team will review and publish this to the dictionary.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Word display */}
        <div className="rounded-xl px-4 py-3 mb-4" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Word</p>
          <p className="font-mono text-base font-semibold" style={{ color: 'var(--text-emphasis)' }}>{word}</p>
          {phonetic ? (
            <div className="flex items-center gap-2 mt-2">
              <span
                className="rounded px-1.5 py-0.5 text-xs"
                style={{ backgroundColor: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa', fontFamily: 'Georgia, serif' }}
              >
                /{phonetic.ipa}/
              </span>
              <span
                className="rounded px-1.5 py-0.5 font-mono text-xs"
                style={{ backgroundColor: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', color: '#67e8f9' }}
              >
                {`{${phonetic.rime}}`}
              </span>
            </div>
          ) : (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>Phonetic suggestion still loading…</p>
          )}
        </div>

        {/* What will happen */}
        <div className="space-y-2 mb-5">
          {[
            { icon: '📬', text: 'The Rime annotation team will be alerted immediately' },
            { icon: '🎧', text: 'They will listen to the attempted pronunciation, review the suggested IPA, and publish a correction' },
            { icon: '⏱', text: 'Estimated turnaround: 1–3 business days' },
            { icon: '📊', text: 'You\'ll be able to track the status in the Monitoring section' },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-start gap-2.5">
              <span className="text-sm leading-none mt-0.5">{icon}</span>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{text}</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-80"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            style={{ backgroundColor: 'var(--text-emphasis)', color: 'var(--surface-0)' }}
          >
            Submit request →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toasts ───────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2" style={{ maxWidth: '360px' }}>
      {toasts.map(t => (
        <div
          key={t.id}
          className="flex items-start gap-3 rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-default)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', color: 'var(--text-secondary)' }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: '1px' }}>
            <circle cx="7" cy="7" r="5.5" stroke="#34d399" strokeWidth="1.3" />
            <path d="M4.5 7l2 2L9.5 5" stroke="#34d399" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="flex-1 text-xs leading-relaxed">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function PlayButton({
  label, isLoading, isPlaying, disabled, accent, title, onClick,
}: {
  label: string; isLoading: boolean; isPlaying: boolean
  disabled?: boolean; accent?: boolean; title?: string; onClick: () => void
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
          <span className="h-3 w-3 animate-spin rounded-full border-2" style={{ borderColor: 'var(--border-strong)', borderTopColor: accent ? accentColor : '#FF9300' }} />
          {label}
        </>
      ) : isPlaying ? <>■ {label}</> : <>▶ {label}</>}
    </button>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt style={{ color: 'var(--text-secondary)' }}>{label}</dt>
      <dd className="font-semibold tabular-nums" style={{ color: warn ? '#fbbf24' : 'var(--text-emphasis)' }}>{value}</dd>
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
    <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-xs font-medium leading-snug" style={{ color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>
          {entry.label}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums" style={coverageBadgeStyle(entry.results.coveragePct)}>
            {entry.results.coveragePct.toFixed(1)}%
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(entry.timestamp)}</span>
        </div>
      </div>
      <div className="rounded-lg px-3 py-2 mb-2 font-mono text-xs leading-relaxed" style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
        {textExpanded
          ? <pre className="whitespace-pre-wrap break-words" style={{ fontFamily: 'inherit', margin: 0 }}>{entry.text}</pre>
          : <span>{preview}{isTruncated ? '…' : ''}</span>}
      </div>
      <div className="flex items-center gap-3">
        {isTruncated && (
          <button onClick={() => setTextExpanded(e => !e)} className="text-xs transition hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
            {textExpanded ? 'Collapse' : 'Show full text'}
          </button>
        )}
        <button onClick={() => onRestore(entry)} className="ml-auto text-xs font-medium transition hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
          Restore →
        </button>
      </div>
    </div>
  )
}

function HistoryPanel({ history, expanded, onToggleExpanded, onRestore }: {
  history: HistoryEntry[]; expanded: boolean
  onToggleExpanded: () => void; onRestore: (e: HistoryEntry) => void
}) {
  const visible = expanded ? history : history.slice(0, 1)
  const hiddenCount = history.length - 1

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)', letterSpacing: '0.07em' }}>History</span>
        {history.length > 1 && (
          <button
            onClick={onToggleExpanded}
            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition hover:opacity-100"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)', opacity: 0.75 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
              <path d={expanded ? 'M2 6.5L5 3.5L8 6.5' : 'M2 3.5L5 6.5L8 3.5'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {expanded ? 'Show less' : `+${hiddenCount} more`}
          </button>
        )}
      </div>
      {history.length === 0 ? (
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
