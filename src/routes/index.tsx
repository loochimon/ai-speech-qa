import { createFileRoute, useNavigate } from '@tanstack/react-router'
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
  transcribeAudio,
  type PhoneticResult,
  type VoiceEntry,
} from '#/lib/api'

export const Route = createFileRoute('/')({ component: ResearchPage })

// ─── constants ────────────────────────────────────────────────────────────────

const RIME_API_KEY = import.meta.env.VITE_RIME_API_KEY as string
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string
const DEFAULT_VOICE = 'lagoon'

const RANDOM_USE_CASES = [
  // Healthcare & pharma
  'pharmacy prescription refill and drug interaction check',
  'hospital patient intake and insurance verification',
  'medical device company fielding a compliance question',
  'oncology clinic scheduling a chemotherapy infusion appointment',
  'mental health crisis line de-escalation and referral',
  'dental office handling an emergency toothache after hours',
  'optometry practice confirming a contact lens prescription',
  'home health aide dispatch for a post-surgical patient',
  'pharmaceutical rep detailing a new formulary addition to a physician',
  'urgent care clinic triaging a patient with chest pain symptoms',

  // Financial services
  'wealth management portfolio review call',
  'insurance claim intake after a car accident',
  'mortgage lender walking a first-time buyer through loan options',
  'credit card fraud investigation and card replacement',
  'student loan servicer explaining income-driven repayment options',
  'cryptocurrency exchange verifying identity for a large withdrawal',
  'small business bank resolving an ACH payment failure',
  'tax preparation service handling an audit notice inquiry',
  'annuity provider explaining surrender charges to a retiree',
  'venture capital firm conducting an initial LP onboarding call',

  // Telecom & tech
  'telecom troubleshooting a fiber outage',
  'SaaS technical support for an API integration issue',
  'cloud provider handling a production database outage escalation',
  'cybersecurity firm notifying a client of a breach and remediation steps',
  'ISP walking a customer through router firmware update',
  'enterprise software vendor negotiating a renewal contract',
  'IoT platform supporting a developer integrating a smart sensor',
  'data center coordinating emergency power failover procedures',

  // Travel & logistics
  'airline rebooking after a flight cancellation',
  'hotel concierge arranging accessible room accommodations',
  'car rental company handling a vehicle breakdown mid-trip',
  'freight brokerage tracking a delayed LTL shipment',
  'cruise line handling a medical evacuation from a ship',
  'corporate travel agent managing a last-minute international visa issue',
  'rideshare driver support resolving a disputed fare',

  // Utilities & energy
  'utility company handling a billing dispute',
  'solar installer explaining net metering credits to a homeowner',
  'natural gas company responding to a reported leak',
  'EV charging network helping a driver with a failed charge session',
  'water authority notifying a business of a boil-water advisory',

  // Automotive & manufacturing
  'automotive dealership scheduling a recall repair',
  'heavy equipment manufacturer assisting a technician with hydraulic diagnostics',
  'auto insurance adjuster appraising hail damage on a fleet vehicle',
  'tire retailer handling a road hazard warranty claim',

  // Retail & e-commerce
  'e-commerce retailer processing a high-value return fraud investigation',
  'luxury brand authenticating a product and arranging a repair',
  'grocery delivery service resolving a substitution complaint',
  'marketplace seller support disputing a buyer protection claim',

  // Government & public services
  'DMV agent walking a caller through commercial driver license renewal',
  'veterans affairs benefits specialist explaining disability rating appeal',
  'unemployment office handling an overpayment recoupment notice',
  'city permitting office clarifying zoning requirements for a renovation',

  // Education & non-profit
  'university financial aid office resolving a missing document hold',
  'K-12 school district special education coordinator arranging an IEP meeting',
  'non-profit disaster relief intake registering displaced families',
]

// ─── types ────────────────────────────────────────────────────────────────────

export interface RequestedWord {
  word: string
  frequency: number
  ipa: string
  rime: string
  date: string
  status: 'Requested' | 'In Review' | 'Updated' | 'Rejected'
}

interface OovWord { word: string; frequency: number }

interface Results {
  totalTokens: number
  uniqueWordCount: number
  oovWords: OovWord[]
  oovTokenCount: number
  coveragePct: number
  wordSentences: Record<string, string[]>
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
  flaggedWords: string[]
  voice: string
  timestamp: Date
}

// ─── component ────────────────────────────────────────────────────────────────

const RESEARCH_STORAGE_KEY = 'rime_research_session'
const CUSTOM_PRONUNCIATIONS_KEY = 'rime_custom_pronunciations'

function loadCustomPronunciations(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PRONUNCIATIONS_KEY) ?? '{}') }
  catch { return {} }
}

function loadSession(): { text: string; results: Results | null; phonetics: Record<string, PhoneticResult>; submittedWords: string[]; flaggedWords: string[] } | null {
  try {
    const raw = sessionStorage.getItem(RESEARCH_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function ResearchPage() {
  const _session = loadSession()
  const [text, setText] = useState(_session?.text ?? '')
  const [status, setStatus] = useState<'idle' | 'checking' | 'done' | 'error'>(_session?.results ? 'done' : 'idle')
  const [results, setResults] = useState<Results | null>(_session?.results ?? null)
  const [error, setError] = useState('')

  const [loadingAudio, setLoadingAudio] = useState<string | null>(null)
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const audioCache = useRef(new Map<string, string>())
  const currentAudio = useRef<HTMLAudioElement | null>(null)

  const [useCase, setUseCase] = useState('')
  const [generatingScript, setGeneratingScript] = useState(false)
  const [scriptError, setScriptError] = useState('')

  const [phonetics, setPhonetics] = useState<Record<string, PhoneticResult>>(_session?.phonetics ?? {})
  const [phoneticsLoading, setPhonleticsLoading] = useState(false)

  const [submittedWords, setSubmittedWords] = useState<Set<string>>(new Set(_session?.submittedWords ?? []))
  const [flaggedWords, setFlaggedWords] = useState<Set<string>>(new Set(_session?.flaggedWords ?? []))

  const [toasts, setToasts] = useState<Toast[]>([])

  const [voices, setVoices] = useState<VoiceEntry[]>([])
  const [selectedVoice, setSelectedVoice] = useState(DEFAULT_VOICE)

  const [customPronunciations, setCustomPronunciations] = useState<Record<string, string>>(
    () => loadCustomPronunciations()
  )
  const [pronunciationPanelExpanded, setPronunciationPanelExpanded] = useState(false)

  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [textareaHeight, setTextareaHeight] = useState(280)
  const dragBarRef = useRef<{ startY: number; startH: number } | null>(null)
  const [resultsStale, setResultsStale] = useState(false)

  // Persist session so navigating away and back restores state
  useEffect(() => {
    try {
      sessionStorage.setItem(RESEARCH_STORAGE_KEY, JSON.stringify({
        text,
        results,
        phonetics,
        submittedWords: Array.from(submittedWords),
        flaggedWords: Array.from(flaggedWords),
      }))
    } catch { /* quota exceeded — ignore */ }
  }, [text, results, phonetics, submittedWords, flaggedWords, resultsStale])

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_PRONUNCIATIONS_KEY, JSON.stringify(customPronunciations)) }
    catch { /* quota exceeded */ }
  }, [customPronunciations])

  const handleDragBarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragBarRef.current = { startY: e.clientY, startH: textareaHeight }
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - dragBarRef.current!.startY
      setTextareaHeight(Math.max(80, dragBarRef.current!.startH + delta))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragBarRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [showRequestConfirm, setShowRequestConfirm] = useState(false)
  const [showGeneratePopover, setShowGeneratePopover] = useState(false)
  const generateRef = useRef<HTMLDivElement>(null)

  const navigate = useNavigate()
  const wordCount = useMemo(() => parseWords(text).size, [text])

  // Load voice catalogue once on mount
  useEffect(() => {
    fetchVoices()
      .then(setVoices)
      .catch(() => {}) // fail silently — lagoon always works as fallback
  }, [])

  // Close generate popover on outside click
  useEffect(() => {
    if (!showGeneratePopover) return
    const handle = (e: MouseEvent) => {
      if (!generateRef.current?.contains(e.target as Node)) setShowGeneratePopover(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showGeneratePopover])

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
    setError('')
    // Keep existing results visible but mark as stale so user knows to re-run
    setResultsStale(true)
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
    setFlaggedWords(new Set())
    try {
      const uniqueWords = Array.from(freq.keys())
      // TODO: remove mock fallback once OOV API is deployed
      let oovList: string[]
      try {
        oovList = await fetchOov(uniqueWords, RIME_API_KEY)
      } catch {
        // API still down — surface every word that looks domain-specific as OOV
        const mockOov = ['Lisinopril','Semaglutide','Ozempic','Metformin','Wegovy',
          'Omeprazole','Atorvastatin','Trazodone','Gabapentin','Escitalopram',
          'Sertraline','Furosemide','Amlodipine','Losartan','Pantoprazole']
        oovList = uniqueWords.filter(w =>
          mockOov.some(m => m.toLowerCase() === w.toLowerCase()) ||
          w.length > 9
        )
      }
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
      // Build word → sentences map
      const sentences = textToCheck
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean)
      const wordSentences: Record<string, string[]> = {}
      for (const oovWord of oovWords) {
        const key = oovWord.word.toLowerCase()
        wordSentences[oovWord.word] = sentences.filter(s =>
          s.toLowerCase().split(/\W+/).includes(key)
        )
      }
      const newResults: Results = { totalTokens, uniqueWordCount: uniqueWords.length, oovWords, oovTokenCount, coveragePct, wordSentences }
      setResults(newResults)
      setStatus('done')
      setResultsStale(false)
      const entryLabel = label?.trim() ||
        textToCheck.split('\n').find(l => l.trim())?.trim().slice(0, 72) ||
        'Untitled'
      setFlaggedWords(new Set())
      setHistory(prev => [{
        id: crypto.randomUUID(),
        label: entryLabel,
        text: textToCheck,
        results: newResults,
        phonetics: {},
        submittedWords: [],
        flaggedWords: [],
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
    setFlaggedWords(new Set(entry.flaggedWords ?? []))
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

  // Toggle a word's "flagged for correction" state (before submission)
  const handleFlag = useCallback((word: string) => {
    setFlaggedWords(prev => {
      const next = new Set(prev)
      if (next.has(word)) { next.delete(word) } else { next.add(word) }
      return next
    })
    setHistory(h => {
      if (h.length === 0) return h
      const [latest, ...rest] = h
      const cur = new Set(latest.flaggedWords ?? [])
      if (cur.has(word)) { cur.delete(word) } else { cur.add(word) }
      return [{ ...latest, flaggedWords: [...cur] }, ...rest]
    })
  }, [])

  // Submit all OOV words — save to localStorage and show confirmation
  const handleSubmitFlagged = useCallback(() => {
    if (!results || results.oovWords.length === 0) return
    const oovWords = results.oovWords
    const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const existing: RequestedWord[] = (() => { try { return JSON.parse(localStorage.getItem('rime_requested_words') ?? '[]') } catch { return [] } })()
    const existingSet = new Set(existing.map(w => w.word.toLowerCase()))
    const newEntries: RequestedWord[] = oovWords
      .filter(w => !existingSet.has(w.word.toLowerCase()))
      .map(w => ({
        word: w.word, frequency: w.frequency,
        ipa: phonetics[w.word]?.ipa ?? '', rime: phonetics[w.word]?.rime ?? '',
        date: dateLabel, status: 'Requested' as const,
      }))
    localStorage.setItem('rime_requested_words', JSON.stringify([...newEntries, ...existing]))
    setShowRequestConfirm(true)
  }, [results, phonetics])

  // Cancel a submitted correction (returns word to unflagged state)
  const handleCancelFix = useCallback((word: string) => {
    setSubmittedWords(prev => { const next = new Set(prev); next.delete(word); return next })
    setHistory(h => {
      if (h.length === 0) return h
      const [latest, ...rest] = h
      return [{ ...latest, submittedWords: latest.submittedWords.filter(w => w !== word) }, ...rest]
    })
  }, [])

  const handleCancelAllFixes = useCallback(() => {
    setSubmittedWords(new Set())
    setHistory(h => {
      if (h.length === 0) return h
      const [latest, ...rest] = h
      return [{ ...latest, submittedWords: [] }, ...rest]
    })
  }, [])

  const handleSaveCustomPronunciation = useCallback((word: string, rime: string) => {
    setCustomPronunciations(prev => ({ ...prev, [word]: rime }))
    addToast(`Saved pronunciation for "${word}"`)
  }, [addToast])

  const handleClearCustomPronunciation = useCallback((word: string) => {
    setCustomPronunciations(prev => { const n = { ...prev }; delete n[word]; return n })
    addToast(`Cleared pronunciation for "${word}"`)
  }, [addToast])

  // ── exports ─────────────────────────────────────────────────────────────────

  const canDownloadCsv = !!(results && results.oovWords.length > 0)
  const canExportPdf = !!results

  const handleDownloadCsv = useCallback(() => {
    if (!results || results.oovWords.length === 0) return
    const rows = [
      ['Word', 'Frequency', 'IPA Pronunciation', 'Rime Phonetic', 'Status'],
      ...results.oovWords.map(({ word, frequency }) => {
        const p = phonetics[word]
        const status = submittedWords.has(word) ? 'Fix requested'
          : flaggedWords.has(word) ? 'Flagged'
          : 'Not in dictionary'
        return [word, String(frequency), p?.ipa ?? '', p ? `{${p.rime}}` : '', status]
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
  }, [results, phonetics, submittedWords, flaggedWords])

  const handleExportPdf = useCallback(() => {
    if (!results) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const W = 210
    const H = doc.internal.pageSize.getHeight()
    const margin = 16
    const contentW = W - 2 * margin
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const pct = results.coveragePct
    const [cr, cg, cb] = pct >= 95 ? [22, 163, 74] : pct >= 80 ? [180, 83, 9] : [185, 28, 28]
    const oovCount = results.oovWords.length
    const requestedCount = results.oovWords.filter(w => submittedWords.has(w.word)).length
    const flaggedCount = results.oovWords.filter(w => flaggedWords.has(w.word)).length

    // ── helpers ──────────────────────────────────────────────────────────────
    const addFooter = (pageNum: number, totalPages: number) => {
      doc.setTextColor(180, 180, 180)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.line(margin, H - 14, W - margin, H - 14)
      doc.text('Rime SpeechQA  ·  docs.rime.ai', margin, H - 9)
      doc.text(`Page ${pageNum} of ${totalPages}`, W - margin, H - 9, { align: 'right' })
      doc.setDrawColor(220, 220, 220)
    }

    const addPageHeader = () => {
      doc.setFillColor(18, 18, 18)
      doc.rect(0, 0, W, 22, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Rime SpeechQA', margin, 10)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(160, 160, 160)
      doc.text('Coverage Report', margin, 17)
      doc.text(`Voice: ${selectedVoice}  ·  ${dateStr}`, W - margin, 17, { align: 'right' })
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 — EXECUTIVE SUMMARY
    // ════════════════════════════════════════════════════════════════════════
    addPageHeader()
    let y = 32

    // ── Use case label ──
    const label = useCase.trim() || text.trim().split('\n').find(l => l.trim())?.slice(0, 100) || 'Untitled'
    doc.setTextColor(100, 100, 100)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text('USE CASE', margin, y)
    y += 4.5
    doc.setTextColor(20, 20, 20)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    const labelLines = doc.splitTextToSize(label, contentW) as string[]
    doc.text(labelLines, margin, y)
    y += labelLines.length * 6 + 4

    // ── Verdict banner ──
    const verdictText = pct >= 95
      ? 'Production ready — dictionary coverage meets the recommended threshold.'
      : pct >= 80
      ? 'Review recommended — most words are covered, but a few gaps may affect quality.'
      : 'Needs attention — significant gaps in dictionary coverage detected.'
    const [vr, vg, vb] = pct >= 95 ? [240, 253, 244] : pct >= 80 ? [255, 251, 235] : [254, 242, 242]
    const [tbr, tbg, tbb] = pct >= 95 ? [21, 128, 61] : pct >= 80 ? [146, 64, 14] : [153, 27, 27]
    doc.setFillColor(vr, vg, vb)
    doc.roundedRect(margin, y, contentW, 11, 2, 2, 'F')
    doc.setTextColor(tbr, tbg, tbb)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.text(verdictText, margin + 4, y + 7.5)
    y += 17

    // ── Coverage % + progress bar ──
    doc.setTextColor(cr, cg, cb)
    doc.setFontSize(48)
    doc.setFont('helvetica', 'bold')
    doc.text(`${pct.toFixed(1)}%`, margin, y + 14)
    doc.setTextColor(110, 110, 110)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text('dictionary coverage', margin + 44, y + 10)
    // Progress bar
    const barY = y + 13
    doc.setFillColor(230, 230, 230)
    doc.roundedRect(margin + 44, barY, contentW - 44, 4, 2, 2, 'F')
    doc.setFillColor(cr, cg, cb)
    doc.roundedRect(margin + 44, barY, (contentW - 44) * (pct / 100), 4, 2, 2, 'F')
    y += 24

    // ── Stats grid ──
    const stats: [string, string][] = [
      ['Total tokens', results.totalTokens.toLocaleString()],
      ['Unique words', results.uniqueWordCount.toLocaleString()],
      ['OOV words', oovCount.toLocaleString()],
      ['OOV tokens', results.oovTokenCount.toLocaleString()],
    ]
    const colW = contentW / 4
    doc.setDrawColor(235, 235, 235)
    stats.forEach(([lbl, val], i) => {
      const x = margin + i * colW
      if (i > 0) doc.line(x, y, x, y + 12)
      doc.setTextColor(130, 130, 130)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(lbl.toUpperCase(), x + (i === 0 ? 0 : 4), y + 3)
      const isOov = i >= 2
      doc.setTextColor(isOov && Number(val) > 0 ? cr : 20, isOov && Number(val) > 0 ? cg : 20, isOov && Number(val) > 0 ? cb : 20)
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(val, x + (i === 0 ? 0 : 4), y + 11)
      doc.setFont('helvetica', 'normal')
    })
    y += 20

    // ── Narrative summary ──
    doc.setDrawColor(220, 220, 220)
    doc.line(margin, y, W - margin, y)
    y += 7
    const inVocab = results.uniqueWordCount - oovCount
    const narrativeParts: string[] = [
      `This ${useCase ? `"${label}" ` : ''}script contains ${results.totalTokens.toLocaleString()} total tokens across ${results.uniqueWordCount.toLocaleString()} unique words.`,
      oovCount === 0
        ? `Every word is present in Rime's dictionary — no action required before deployment.`
        : `${oovCount.toLocaleString()} word${oovCount !== 1 ? 's' : ''} (${(100 - pct).toFixed(1)}% gap) ${oovCount !== 1 ? 'are' : 'is'} not yet in Rime's dictionary, accounting for ${results.oovTokenCount.toLocaleString()} token occurrence${results.oovTokenCount !== 1 ? 's' : ''}.`,
    ]
    if (oovCount > 0 && (requestedCount > 0 || flaggedCount > 0)) {
      const parts: string[] = []
      if (requestedCount > 0) parts.push(`${requestedCount} fix${requestedCount !== 1 ? 'es' : ''} submitted`)
      if (flaggedCount > 0) parts.push(`${flaggedCount} flagged`)
      narrativeParts.push(`${parts.join(', ')}.`)
    }
    const narrative = narrativeParts.join(' ')
    const narrativeLines = doc.splitTextToSize(narrative, contentW) as string[]
    doc.setTextColor(50, 50, 50)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(narrativeLines, margin, y)
    y += narrativeLines.length * 5.5 + 8

    // ── OOV table ──
    if (oovCount > 0) {
      doc.setTextColor(20, 20, 20)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Out-of-vocabulary words', margin, y)
      y += 6

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        tableWidth: contentW,
        head: [['Word', 'Freq', 'Rime Phonetic', 'Status']],
        body: results.oovWords.map(({ word, frequency }) => {
          const p = phonetics[word]
          const status = submittedWords.has(word) ? 'Fix requested'
            : flaggedWords.has(word) ? 'Flagged'
            : 'Not in dictionary'
          return [
            word,
            `x${frequency.toLocaleString()}`,
            p ? `{${p.rime}}` : '—',
            status,
          ]
        }),
        styles: { fontSize: 8.5, cellPadding: 3 },
        headStyles: { fillColor: [25, 25, 25], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 38 },
          1: { cellWidth: 14, halign: 'right', textColor: [120, 120, 120] },
          2: { cellWidth: 90 },
          3: { cellWidth: 36, halign: 'center' },
        },
        didParseCell: (data) => {
          if (data.column.index === 3 && data.section === 'body') {
            const val = data.cell.raw as string
            data.cell.styles.textColor = val === 'Fix requested' || val === 'Flagged'
              ? [22, 163, 74] : [120, 120, 120]
            data.cell.styles.fontStyle = 'bold'
          }
        },
      })
    } else {
      doc.setFillColor(240, 253, 244)
      doc.roundedRect(margin, y, contentW, 16, 3, 3, 'F')
      doc.setTextColor(21, 128, 61)
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.text('Full coverage — every word is in the Rime dictionary', W / 2, y + 10, { align: 'center' })
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — FULL INPUT TEXT
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage()
    addPageHeader()
    y = 32

    doc.setTextColor(20, 20, 20)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Analyzed Script', margin, y)
    doc.setTextColor(120, 120, 120)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(`${results.totalTokens.toLocaleString()} tokens · ${results.uniqueWordCount.toLocaleString()} unique words · voice: ${selectedVoice}`, margin, y + 6)
    y += 14

    doc.setDrawColor(220, 220, 220)
    doc.line(margin, y, W - margin, y)
    y += 7

    // Render full text with page breaks
    const inputLines = doc.splitTextToSize(text.trim(), contentW) as string[]
    doc.setTextColor(35, 35, 35)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const lineH = 5.2
    const pageBottomY = H - 20
    let pageNum = 2

    for (const line of inputLines) {
      if (y + lineH > pageBottomY) {
        addFooter(pageNum, 3)
        doc.addPage()
        addPageHeader()
        pageNum++
        y = 32
      }
      doc.text(line, margin, y)
      y += lineH
    }

    // Add footers
    const totalPages = doc.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p)
      addFooter(p, totalPages)
    }

    doc.save(`rime-speechqa-${new Date().toISOString().slice(0, 10)}.pdf`)
  }, [results, phonetics, submittedWords, flaggedWords, useCase, text])

  // ── derived ─────────────────────────────────────────────────────────────────

  const isBusy = generatingScript || status === 'checking'

  const coverageColor = !results ? 'text-white'
    : results.coveragePct > 50 ? 'text-emerald-400'
    : 'text-red-400'

  const barColor = !results ? 'bg-[#3b3b3b]'
    : results.coveragePct >= 95 ? 'bg-emerald-500'
    : results.coveragePct >= 80 ? 'bg-amber-400'
    : 'bg-red-500'

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0D0D0D' }}>

      {/* ── Title row ── */}
      <div style={{ padding: '24px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
        <h1 style={{ fontWeight: 700, fontSize: '24px', color: '#FFFFFF', margin: 0, letterSpacing: '-0.01em' }}>
          Check Coverage
        </h1>
        <a
          href="https://docs.rime.ai/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            backgroundColor: '#161616', border: '0.5px solid #434343',
            padding: '8px 16px', borderRadius: '5px',
            display: 'flex', alignItems: 'center', gap: '8px',
            textDecoration: 'none', fontSize: '13px', color: '#FFFFFF',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4.5 4.5h5M4.5 6.5h5M4.5 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          Documentation
        </a>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '11px',
        padding: '12px 26px',
        borderBottom: '0.5px solid #383838',
      }}>
        {/* Search input — matches left panel width */}
        <div style={{ width: '200px', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '6px 10px',
            backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px',
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
              <circle cx="6" cy="6" r="4.5" stroke="#A5A5A5" strokeWidth="1.2" />
              <path d="M9.5 9.5L12.5 12.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              placeholder="Search words…"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                color: '#FFFFFF', fontSize: '12px', fontFamily: 'Inter, sans-serif',
              }}
            />
          </div>
        </div>
        {/* Filter dropdowns */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Voice */}
          <div style={{ flexShrink: 0 }}>
            <VoicePicker
              voices={voices}
              selected={selectedVoice}
              onSelect={v => { setSelectedVoice(v); audioCache.current.clear() }}
              label="Voice"
            />
          </div>
          {/* Language */}
          <div style={{ width: '140px', flexShrink: 0 }}>
            <div style={{
              padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px',
              fontSize: '12px', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            }}>
              <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Language</span>
              <span>All</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
          {/* Time */}
          <div style={{ width: '130px', flexShrink: 0 }}>
            <div style={{
              padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px',
              fontSize: '12px', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            }}>
              <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Time</span>
              <span>All Time</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content: left panel + divider + right panel ── */}
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 240px)', alignItems: 'stretch' }}>

        {/* ── Left panel ── */}
        <div style={{ width: '398px', flexShrink: 0, padding: '16px 26px' }}>

          {/* Script label + AI Generate + Upload */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
            <span style={{ fontWeight: 600, fontSize: '15px', color: '#FFFFFF' }}>Script</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div ref={generateRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowGeneratePopover(p => !p)}
                  disabled={isBusy}
                  title="AI Generate"
                  style={{
                    backgroundColor: '#161616', borderRadius: '5px', padding: '5px 7px',
                    border: '0.5px solid #434343', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: '#A5A5A5',
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 0l1.8 4.2L12 6l-4.2 1.8L6 12l-1.8-4.2L0 6l4.2-1.8z" />
                  </svg>
                </button>
                {showGeneratePopover && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 50,
                    width: '300px', padding: '12px',
                    backgroundColor: '#1a1a1a', border: '1px solid #383838', borderRadius: '8px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}>
                    <input
                      type="text"
                      placeholder="Describe your use case…"
                      value={useCase}
                      onChange={e => { setUseCase(e.target.value); setScriptError('') }}
                      onKeyDown={e => { if (e.key === 'Enter') { handleGenerate(); setShowGeneratePopover(false) } }}
                      autoFocus
                      style={{
                        width: '100%', padding: '8px 10px', borderRadius: '5px',
                        backgroundColor: '#161616', border: '0.5px solid #434343',
                        color: '#FFFFFF', fontSize: '13px', outline: 'none', marginBottom: '8px',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => { handleGenerate(); setShowGeneratePopover(false) }}
                        disabled={!useCase.trim() || isBusy}
                        style={{
                          flex: 1, padding: '6px 12px', borderRadius: '5px', border: 'none',
                          backgroundColor: '#FE8D58', color: '#D7D7D7', fontSize: '12px', fontWeight: 500,
                          cursor: 'pointer', opacity: (!useCase.trim() || isBusy) ? 0.4 : 1,
                        }}
                      >
                        {generatingScript ? 'Generating…' : 'Generate'}
                      </button>
                      <button
                        onClick={() => { handleLucky(); setShowGeneratePopover(false) }}
                        disabled={isBusy}
                        style={{
                          padding: '6px 12px', borderRadius: '5px',
                          border: '0.5px solid #434343', backgroundColor: '#161616',
                          color: '#A5A5A5', fontSize: '12px', cursor: 'pointer',
                          opacity: isBusy ? 0.4 : 1,
                        }}
                      >
                        Random
                      </button>
                    </div>
                    {scriptError && <p style={{ fontSize: '11px', color: '#f87171', marginTop: '6px' }}>{scriptError}</p>}
                  </div>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
                title="Upload file"
                style={{
                  backgroundColor: '#161616', borderRadius: '5px', padding: '5px 7px',
                  border: '0.5px solid #434343', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#A5A5A5',
                  opacity: isBusy ? 0.5 : 1,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 10V3M4 6l3-3 3 3"/>
                  <path d="M2 12h10"/>
                </svg>
              </button>
              <input ref={fileInputRef} type="file" accept=".txt,.csv,.pdf,.docx" style={{ display: 'none' }} onChange={handleFileInput} />
            </div>
          </div>

          {/* Textarea */}
          <div
            style={{ position: 'relative' }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragging && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', zIndex: 10,
              }}>
                <span style={{ fontSize: '13px', fontWeight: 500, color: '#FFFFFF' }}>Drop file to import</span>
              </div>
            )}
            <textarea
              placeholder=""
              value={text}
              onChange={e => handleTextChange(e.target.value)}
              disabled={isBusy}
              spellCheck={false}
              autoCorrect="off"
              autoComplete="off"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              style={{
                width: '100%', resize: 'none', boxSizing: 'border-box',
                height: `${textareaHeight}px`,
                backgroundColor: 'transparent',
                border: 'none',
                color: '#FFFFFF', fontSize: '14px',
                padding: '8px 0', outline: 'none', lineHeight: '1.5',
                opacity: isBusy ? 0.5 : 1,
                position: 'relative', zIndex: 1,
              }}
            />
            {/* Styled empty state — shown when textarea is empty */}
            {!text && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                padding: '8px 0', pointerEvents: 'none', zIndex: 0,
              }}>
                <p style={{ fontSize: '14px', color: '#555', margin: '0 0 20px', lineHeight: 1.5 }}>
                  Paste a script or enter words to check…
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {[
                    { icon: '↵', text: 'One word per line' },
                    { icon: ',', text: 'Comma-separated' },
                    { icon: '↑', text: 'Drag & drop a file' },
                  ].map(tip => (
                    <span key={tip.text} style={{
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                      padding: '3px 8px', borderRadius: '4px',
                      backgroundColor: '#1a1a1a', border: '0.5px solid #2a2a2a',
                      fontSize: '11px', color: '#555',
                    }}>
                      <span style={{ fontFamily: 'monospace', color: '#444' }}>{tip.icon}</span>
                      {tip.text}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Word count + Check Coverage button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ color: '#BBBBBB', fontSize: '12px' }}>
              {wordCount} words
            </span>
            <button
              onClick={handleCheck}
              disabled={wordCount === 0 || isBusy}
              style={{
                backgroundColor: '#FFFFFF', color: '#000000', borderRadius: '5px',
                padding: '5px 12px', border: 'none', fontSize: '12px',
                cursor: 'pointer',
                opacity: (wordCount === 0 || isBusy) ? 0.4 : 1,
              }}
            >
              {status === 'checking' && !generatingScript ? 'Checking…' : resultsStale && results ? 'Re-check Coverage' : 'Check Coverage'}
            </button>
          </div>

          {/* Drag-to-resize bar — bleeds full panel width */}
          <div
            onMouseDown={handleDragBarMouseDown}
            style={{
              height: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'ns-resize', userSelect: 'none', flexShrink: 0,
              borderTop: '0.5px solid #2A2A2A', borderBottom: '0.5px solid #2A2A2A',
              margin: '0 -26px',
            }}
          >
            <div style={{ width: '48px', height: '3px', borderRadius: '99px', backgroundColor: '#383838' }} />
          </div>

          {/* History section */}
          <div style={{ marginTop: '24px' }}>
            <HistoryPanel
              history={history}
              expanded={historyExpanded}
              onToggleExpanded={() => setHistoryExpanded(e => !e)}
              onRestore={handleRestore}
            />
          </div>

          {/* Custom pronunciations panel */}
          <div style={{ marginTop: '24px' }}>
            <PronunciationPanel
              pronunciations={customPronunciations}
              expanded={pronunciationPanelExpanded}
              onToggleExpanded={() => setPronunciationPanelExpanded(e => !e)}
              onClear={handleClearCustomPronunciation}
              onCopy={() => addToast('Copied to clipboard')}
            />
          </div>
        </div>

        {/* Vertical divider */}
        <div style={{ width: '0.5px', backgroundColor: '#383838', flexShrink: 0, alignSelf: 'stretch' }} />

        {/* ── Right panel ── */}
        <div style={{ flex: 1, padding: '0 26px 40px', minWidth: 0 }}>

          {/* Tabs + action buttons */}
          <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-between', gap: '12px', flexWrap: 'nowrap', borderBottom: '0.5px solid #2A2A2A', marginBottom: '0', margin: '0 -26px', padding: '0 26px' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: '20px', flexShrink: 0 }}>
              <span style={{
                fontSize: '15px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap',
                paddingTop: '16px', paddingBottom: '16px',
              }}>
                Not in dictionary{results ? ` (${results.oovWords.length})` : ''}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={handleSubmitFlagged}
                disabled={status !== 'done' || !results || results.oovWords.length === 0}
                style={{
                  borderRadius: '5px', padding: '5px 12px', border: 'none',
                  fontSize: '12px', cursor: 'pointer',
                  backgroundColor: '#FFFFFF', color: '#000000',
                  opacity: (status !== 'done' || !results || results.oovWords.length === 0) ? 0.4 : 1,
                }}
              >
                Request Pronunciation
              </button>
              <button
                onClick={() => window.open('/shared', '_blank')}
                disabled={status !== 'done' || !results || results.oovWords.length === 0}
                style={{
                  borderRadius: '5px', padding: '5px 12px',
                  border: '0.5px solid #434343',
                  backgroundColor: 'transparent',
                  color: '#9C9C9C', fontSize: '12px', cursor: 'pointer',
                  opacity: (status !== 'done' || !results || results.oovWords.length === 0) ? 0.4 : 1,
                }}
              >
                Share
              </button>
            </div>
          </div>


          {status === 'error' && (
            <div
              className="rounded-[5px] px-4 py-3 text-sm mb-4"
              style={{ backgroundColor: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}
            >
              {error || scriptError}
            </div>
          )}

          {isBusy && (
            <div className="rounded-[5px] p-6 animate-pulse" style={{ backgroundColor: '#141414', border: '1px solid #2A2A2A' }}>
              <div className="flex items-center gap-8">
                <div className="shrink-0 text-center">
                  <div className="h-12 w-16 rounded-lg mb-2" style={{ backgroundColor: '#1f1f1f' }} />
                  <div className="h-3 w-12 rounded" style={{ backgroundColor: '#1f1f1f' }} />
                </div>
                <div className="h-16 w-px shrink-0" style={{ backgroundColor: '#383838' }} />
                <div className="flex-1 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="h-4 rounded" style={{ backgroundColor: '#1f1f1f' }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-5 h-1.5 rounded-full" style={{ backgroundColor: '#1f1f1f' }} />
            </div>
          )}

          {status === 'done' && results && !isBusy && (
            <div>

              {/* Compact stats strip */}
              <div style={{ display: 'flex', gap: '40px', padding: '16px 26px', margin: '0 -26px 4px', borderBottom: '0.5px solid #383838', backgroundColor: '#141414' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Total words</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{results.totalTokens.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Not in dictionary</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{results.oovWords.length.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>In dictionary</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{(results.uniqueWordCount - results.oovWords.length).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Coverage</div>
                  <div className={`text-lg font-bold tabular-nums ${coverageColor}`}>{results.coveragePct.toFixed(1)}%</div>
                </div>
              </div>

              {/* OOV list */}
              {results.oovWords.length > 0 ? (
                <div style={{ margin: '0 -26px' }}>
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
                      isFlagged={flaggedWords.has(word)}
                      onFlag={handleFlag}
                      onCancelFix={handleCancelFix}
                      addToast={addToast}
                      sentences={results.wordSentences?.[word] ?? []}
                      customPronunciation={customPronunciations[word]}
                      onSaveCustomPronunciation={handleSaveCustomPronunciation}
                      onClearCustomPronunciation={handleClearCustomPronunciation}
                    />
                  ))}
                </div>
              ) : (
                <div className="px-6 py-10 text-center">
                  <p className="text-lg font-semibold" style={{ color: '#FFFFFF' }}>Full coverage</p>
                  <p className="mt-1 text-sm" style={{ color: '#7C7C7C' }}>Every word in your input is in Rime's dictionary.</p>
                </div>
              )}
            </div>
          )}

          {status === 'idle' && !isBusy && (
            <div className="rounded-[5px] px-6 py-12 text-center" style={{ backgroundColor: '#141414', border: '1px solid #2A2A2A', marginTop: '24px' }}>
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-[5px]" style={{ backgroundColor: '#1f1f1f' }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M9 1L2 4.5v5C2 13.5 5.1 16.8 9 17.5c3.9-.7 7-4 7-8v-5L9 1z" stroke="#A5A5A5" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M6 9l2 2 4-4" stroke="#A5A5A5" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium" style={{ color: '#BBBBBB' }}>No results yet</p>
              <p className="mt-1 text-xs" style={{ color: '#A5A5A5' }}>
                Generate a sample or paste your own text,<br />then run a coverage check.
              </p>
            </div>
          )}
        </div>

      </div>


{/* ── Toasts ── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ── Request Confirmation Modal ── */}
      {showRequestConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '100%', maxWidth: '520px', borderRadius: '10px', padding: '32px',
            backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)',
            textAlign: 'center',
          }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%', margin: '0 auto 16px',
              backgroundColor: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M5 10l3.5 3.5L15 7" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-emphasis)', marginBottom: '8px' }}>
              Words Requested
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.5 }}>
              {results?.oovWords.length} word{(results?.oovWords.length ?? 0) !== 1 ? 's' : ''} sent to the annotation team for pronunciation review.
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button
                onClick={() => setShowRequestConfirm(false)}
                style={{ padding: '8px 24px', borderRadius: '5px', fontSize: '13px', whiteSpace: 'nowrap', border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                Back to Check Coverage
              </button>
              <button
                onClick={() => { setShowRequestConfirm(false); navigate({ to: '/my-words' }) }}
                style={{ padding: '8px 24px', borderRadius: '5px', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', border: 'none', backgroundColor: '#ffffff', color: '#000000', cursor: 'pointer' }}
              >
                View My Words →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── VoicePicker ──────────────────────────────────────────────────────────────

function uniqueVals(voices: VoiceEntry[], key: keyof VoiceEntry): string[] {
  const vals = new Set<string>()
  for (const v of voices) {
    const val = v[key]
    if (Array.isArray(val)) {
      for (const item of val) {
        for (const part of item.split(',').map((s: string) => s.trim())) {
          if (part) vals.add(part)
        }
      }
    } else if (typeof val === 'string' && val) {
      vals.add(val)
    }
  }
  return [...vals].sort()
}

function VoicePicker({
  voices,
  selected,
  onSelect,
  label,
}: {
  voices: VoiceEntry[]
  selected: string
  onSelect: (v: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [genderFilter, setGenderFilter] = useState<'all' | 'Male' | 'Female' | 'Non-binary'>('all')
  const [flagshipOnly, setFlagshipOnly] = useState(false)
  const [langFilter, setLangFilter] = useState('')
  const [ageFilter, setAgeFilter] = useState('')
  const [dialectFilter, setDialectFilter] = useState('')
  const [demographicFilter, setDemographicFilter] = useState('')
  const [genreFilter, setGenreFilter] = useState('')
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

  const opts = useMemo(() => ({
    language: uniqueVals(voices, 'language'),
    age: uniqueVals(voices, 'age'),
    dialect: uniqueVals(voices, 'dialect'),
    demographic: uniqueVals(voices, 'demographic'),
    genre: uniqueVals(voices, 'genre'),
  }), [voices])

  const filtered = useMemo(() => {
    return voices.filter(v => {
      if (genderFilter !== 'all' && v.gender !== genderFilter) return false
      if (flagshipOnly && !v.flagship) return false
      if (langFilter && v.language !== langFilter) return false
      if (ageFilter && v.age !== ageFilter) return false
      if (dialectFilter && v.dialect !== dialectFilter) return false
      if (demographicFilter && v.demographic !== demographicFilter) return false
      if (genreFilter) {
        const genres = v.genre.flatMap(g => g.split(',').map(s => s.trim()))
        if (!genres.includes(genreFilter)) return false
      }
      if (search) {
        const q = search.toLowerCase()
        return (
          v.speaker.toLowerCase().includes(q) ||
          v.dialect.toLowerCase().includes(q) ||
          v.demographic.toLowerCase().includes(q) ||
          v.language.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [voices, genderFilter, flagshipOnly, langFilter, ageFilter, dialectFilter, demographicFilter, genreFilter, search])

  const selectedEntry = voices.find(v => v.speaker === selected)
  const hasFilters = langFilter || ageFilter || dialectFilter || demographicFilter || genreFilter || flagshipOnly || genderFilter !== 'all'

  const genderOptions: { value: typeof genderFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Non-binary', label: 'NB' },
  ]

  const selectStyle: React.CSSProperties = {
    backgroundColor: 'var(--surface-3)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)',
    borderRadius: '6px',
    padding: '2px 4px',
    fontSize: '11px',
    outline: 'none',
    minWidth: 0,
    flex: '1 1 0',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 10px', borderRadius: '5px',
          backgroundColor: '#161616', border: '0.5px solid #434343',
          color: '#FFFFFF', fontSize: '12px', cursor: 'pointer',
        }}
        title="Select preview voice"
      >
        {label && <span style={{ color: '#A5A5A5', flexShrink: 0 }}>{label}</span>}
        <span style={{ fontWeight: 500, flexShrink: 0 }}>{selected}</span>
        <span style={{ color: '#A5A5A5', fontSize: '11px', whiteSpace: 'nowrap' }}>
          {selectedEntry ? `${selectedEntry.dialect} · ${selectedEntry.gender} · ${selectedEntry.country}` : ''}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
          <path d={open ? 'M2 6.5L5 3.5L8 6.5' : 'M2 3.5L5 6.5L8 3.5'} stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 100,
            width: '360px',
            backgroundColor: '#1a1a1a',
            border: '1px solid #383838',
            borderRadius: '8px',
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
                placeholder="Search by name, accent, language…"
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

          {/* Gender + flagship row */}
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

          {/* Dropdown filters row */}
          <div className="px-2.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="flex gap-1.5 flex-wrap">
              <select value={langFilter} onChange={e => setLangFilter(e.target.value)} style={selectStyle}>
                <option value="">Language</option>
                {opts.language.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={ageFilter} onChange={e => setAgeFilter(e.target.value)} style={selectStyle}>
                <option value="">Age</option>
                {opts.age.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={dialectFilter} onChange={e => setDialectFilter(e.target.value)} style={selectStyle}>
                <option value="">Dialect</option>
                {opts.dialect.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={demographicFilter} onChange={e => setDemographicFilter(e.target.value)} style={selectStyle}>
                <option value="">Demographic</option>
                {opts.demographic.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)} style={selectStyle}>
                <option value="">Genre</option>
                {opts.genre.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {hasFilters && (
              <button
                onClick={() => {
                  setGenderFilter('all')
                  setFlagshipOnly(false)
                  setLangFilter('')
                  setAgeFilter('')
                  setDialectFilter('')
                  setDemographicFilter('')
                  setGenreFilter('')
                }}
                className="mt-1.5 text-xs transition hover:opacity-70"
                style={{ color: 'var(--text-muted)' }}
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Voice list */}
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>No voices match</p>
            ) : (
              filtered.map((v, i) => (
                <button
                  key={`${v.speaker}-${i}`}
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
                    {[v.language, v.dialect, v.gender, v.age].filter(Boolean).join(' · ')}
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
  isFlagged,
  onFlag,
  onCancelFix,
  addToast,
  sentences,
  customPronunciation,
  onSaveCustomPronunciation,
  onClearCustomPronunciation,
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
  isFlagged: boolean
  onFlag: (word: string) => void
  onCancelFix: (word: string) => void
  addToast: (msg: string) => void
  sentences: string[]
  customPronunciation?: string
  onSaveCustomPronunciation: (word: string, rime: string) => void
  onClearCustomPronunciation: (word: string) => void
}) {
  const defaultKey = `${word}:default`
  const hasPhonetic = !!phonetic

  // Editable rime phonetic — null means "unedited"; stored value is the full display text
  // including any curly brackets the user types (e.g. "{J1es2xn}", "spell(ATS)", etc.)
  const [editedRime, setEditedRime] = useState<string | null>(null)

  // What we show in the input box: default to {rime} so brackets are visible
  const defaultDisplay = phonetic ? `{${phonetic.rime}}` : ''
  const activeRimeDisplay = editedRime ?? defaultDisplay

  // Normalise the display text into what the API actually receives.
  // • Has { or spell( → send as-is (user is being explicit)
  // • Plain text, no brackets → wrap in {} so phonemizeBetweenBrackets handles it
  const rimeToApiText = (raw: string) => {
    const t = raw.trim()
    if (!t) return ''
    if (t.includes('{') || t.includes('spell(')) return t
    return `{${t}}`
  }
  const activeRimeApiText = rimeToApiText(activeRimeDisplay)

  const isEdited = editedRime !== null && editedRime !== defaultDisplay

  // Key includes the full display text so cache is invalidated on every edit
  const suggestedKey = `${word}:${activeRimeDisplay}`

  // Custom pronunciation save state
  const isSaved = customPronunciation !== undefined
  const activeRimeBare = activeRimeDisplay.replace(/^\{|\}$/g, '')
  const hasPendingChange = activeRimeBare.length > 0 && activeRimeBare !== customPronunciation

  // Reset when the underlying phonetic changes (e.g. re-run check)
  const prevPhoneticRef = useRef(phonetic?.rime)
  useEffect(() => {
    if (phonetic?.rime !== prevPhoneticRef.current) {
      setEditedRime(null)
      prevPhoneticRef.current = phonetic?.rime
    }
  }, [phonetic?.rime])

  // Pre-populate input with saved pronunciation on first mount (if no local edit yet)
  useEffect(() => {
    if (customPronunciation !== undefined && editedRime === null)
      setEditedRime(`{${customPronunciation}}`)
  }, [customPronunciation]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── custom pronunciation expand state ────────────────────────────────────────
  const [showCustomInput, setShowCustomInput] = useState(false)

  // ── note state ───────────────────────────────────────────────────────────────
  const [showNote, setShowNote] = useState(false)
  const [noteText, setNoteText] = useState('')

  // ── recording state ─────────────────────────────────────────────────────────
  type RecState = 'idle' | 'recording' | 'analyzing' | 'done'
  const [recState, setRecState] = useState<RecState>('idle')
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null)
  const [recordingPlayback, setRecordingPlayback] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analysisTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (analysisTimerRef.current) clearTimeout(analysisTimerRef.current)
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMicClick = async () => {
    if (recState === 'recording') {
      // Stop recording
      mediaRecorderRef.current?.stop()
      return
    }
    if (recState === 'analyzing' || recState === 'done') {
      // Reset
      streamRef.current?.getTracks().forEach(t => t.stop())
      if (recordedUrl) URL.revokeObjectURL(recordedUrl)
      setRecordedUrl(null)
      setRecState('idle')
      return
    }
    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const chunks: BlobPart[] = []
      const mr = new MediaRecorder(stream)
      mediaRecorderRef.current = mr
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => { void (async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setRecordedUrl(URL.createObjectURL(blob))
        setRecState('analyzing')
        try {
          // Whisper → what the user said (prompt biases toward the OOV word)
          const spoken = await transcribeAudio(blob, OPENAI_API_KEY, word)
          const lookupWord = spoken.toLowerCase().trim() || word.toLowerCase()
          // fetchWordPhonetics → IPA → Rime for the spoken form
          const map = await fetchWordPhonetics([lookupWord], OPENAI_API_KEY)
          const result = map[lookupWord] ?? map[Object.keys(map)[0]]
          if (result) {
            setEditedRime(`{${result.rime}}`)
            addToast('Rime phonetic populated from your recording — press Save to keep it')
          } else {
            addToast('Could not infer phonetic — edit the Rime field manually')
          }
        } catch {
          addToast('Recording done — phonetic inference failed, edit manually')
        }
        setRecState('done')
      })() }
      mr.start()
      setRecState('recording')
    } catch {
      addToast('Microphone access denied — allow mic permissions to use this feature')
    }
  }

  const handlePlayRecording = () => {
    if (!recordedUrl || recordingPlayback) return
    const audio = new Audio(recordedUrl)
    setRecordingPlayback(true)
    audio.onended = () => setRecordingPlayback(false)
    audio.play().catch(() => setRecordingPlayback(false))
  }

  const micTitle = recState === 'idle' ? `Record your pronunciation of "${word}" to suggest a correction`
    : recState === 'recording' ? 'Stop recording'
    : recState === 'analyzing' ? 'Getting pronunciation… (click to cancel)'
    : 'Recording captured — click to discard'

  const pipe = <div style={{ width: '0.5px', height: '14px', backgroundColor: '#2A2A2A', flexShrink: 0 }} />

  return (
    <div
      style={{
        borderTop: isFirst ? undefined : '0.5px solid #2A2A2A',
        padding: sentences.length > 0 ? '13px 26px 8px' : '13px 26px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
      {/* Word + frequency — fixed width so all buttons align */}
      <div style={{ width: '200px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '13px',
            fontWeight: 700,
            color: '#FFFFFF',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 1,
          }}
          title={word}
        >
          {word}
        </span>
        <span style={{ fontSize: '11px', color: '#7C7C7C', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          ×{frequency.toLocaleString()}
        </span>
      </div>

      {pipe}

      {/* Current play — small dark circle */}
      <button
        onClick={() => onPlay(defaultKey, () => fetchWordAudio(word, RIME_API_KEY, selectedVoice))}
        title={`Hear current pronunciation of "${word}"`}
        style={{
          width: '22px', height: '22px', borderRadius: '50%',
          border: '0.5px solid #383838', backgroundColor: '#161616',
          color: playingAudio === defaultKey ? '#FFFFFF' : '#7C7C7C',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        {loadingAudio === defaultKey
          ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', border: '1px solid #383838', borderTop: '1px solid #9C9C9C', animation: 'spin 0.8s linear infinite', display: 'block' }} />
          : <svg width="7" height="8" viewBox="0 0 9 10" fill="currentColor"><path d="M1 1.5v7l6.5-3.5L1 1.5z"/></svg>
        }
      </button>

      {/* Suggested play button */}
      <PlayButton
        label={isSaved ? 'Custom' : isEdited ? 'Preview edit' : 'Suggested'}
        isLoading={phoneticsLoading || loadingAudio === suggestedKey}
        isPlaying={playingAudio === suggestedKey}
        disabled={!hasPhonetic}
        accent={!isEdited && !isSaved}
        title={
          hasPhonetic ? `Hear Rime pronounce ${activeRimeDisplay} with voice: ${selectedVoice}`
          : phoneticsLoading ? 'Loading…'
          : 'No phonetic available'
        }
        onClick={() => {
          if (!hasPhonetic) return
          onPlay(suggestedKey, () => fetchPhoneticAudio(activeRimeApiText, RIME_API_KEY, selectedVoice))
        }}
      />

      {pipe}

      {/* IPA — always shown, dash when not loaded */}
      <span style={{ fontSize: '11px', color: '#7C7C7C', flexShrink: 0 }}>IPA</span>
      <span style={{ fontSize: '11px', color: '#9C9C9C', fontFamily: 'Georgia, "Times New Roman", serif', flexShrink: 0 }}>
        {hasPhonetic ? `/${phonetic!.ipa}/` : '/–/'}
      </span>

      <span style={{ fontSize: '11px', color: '#383838', flexShrink: 0 }}>·</span>

      {/* Rime — read-only display in main row */}
      <span style={{ fontSize: '11px', color: '#7C7C7C', flexShrink: 0 }}>Rime</span>
      <span style={{ fontSize: '11px', color: isSaved ? '#34d399' : '#9C9C9C', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
        {hasPhonetic ? activeRimeDisplay : '{–}'}
      </span>
      {isSaved && (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0 }}>
          <path d="M1.5 4l2 2L6.5 2" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}

      {/* Right side — pushed right */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0', flexShrink: 0 }}>
        {/* Add custom pronunciation / Saved toggle */}
        <button
          onClick={() => setShowCustomInput(v => !v)}
          title={isSaved ? 'Edit or clear saved pronunciation' : 'Add a custom pronunciation for this word'}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            fontSize: '11px', padding: '4px 10px',
            borderRadius: '5px',
            border: isSaved
              ? '0.5px solid rgba(52,211,153,0.35)'
              : `0.5px solid ${showCustomInput ? '#5C5C5C' : '#383838'}`,
            backgroundColor: isSaved
              ? 'rgba(52,211,153,0.07)'
              : showCustomInput ? 'rgba(255,255,255,0.04)' : 'transparent',
            color: isSaved ? '#34d399' : showCustomInput ? '#CFCFCF' : '#7C7C7C',
            cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          {isSaved ? (
            <>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 4l2 2L6.5 2" stroke="#34d399" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Saved
            </>
          ) : (
            <>
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <line x1="4.5" y1="1" x2="4.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <line x1="1" y1="4.5" x2="8" y2="4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Add pronunciation
            </>
          )}
        </button>

        {/* Pipe + note icon */}
        <div style={{ width: '0.5px', height: '14px', backgroundColor: '#2A2A2A', flexShrink: 0, margin: '0 10px' }} />
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowNote(v => !v)}
            title="Add note"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', borderRadius: '5px',
              border: `1px solid ${showNote || noteText ? 'rgba(139,92,246,0.4)' : 'var(--border-subtle)'}`,
              backgroundColor: showNote ? 'rgba(139,92,246,0.08)' : 'transparent',
              color: showNote || noteText ? '#a78bfa' : '#7C7C7C', cursor: 'pointer',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1"/>
              <line x1="3.5" y1="4.5" x2="7.5" y2="4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              <line x1="3.5" y1="6.5" x2="7.5" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              <line x1="3.5" y1="8.5" x2="6" y2="8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          </button>

          {showNote && (
            <div style={{
              position: 'absolute', right: 0, top: '30px', zIndex: 50,
              width: '280px', borderRadius: '8px',
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '10px',
            }}>
              <textarea
                autoFocus
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note about this word…"
                rows={3}
                style={{
                  width: '100%', resize: 'none', outline: 'none',
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '5px', padding: '8px 10px',
                  fontSize: '12px', color: 'var(--text-emphasis)', lineHeight: 1.5,
                  boxSizing: 'border-box', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => setShowNote(false)}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px',
                    fontWeight: 500, cursor: 'pointer',
                    border: '1px solid var(--border-default)',
                    backgroundColor: 'transparent', color: 'var(--text-secondary)',
                  }}
                >Cancel</button>
                <button
                  onClick={() => setShowNote(false)}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px',
                    fontWeight: 600, cursor: 'pointer',
                    border: 'none', backgroundColor: '#ffffff', color: '#000000',
                  }}
                >Save</button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Expanded custom pronunciation row */}
      {showCustomInput && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '8px',
            padding: '10px 12px',
            borderRadius: '7px',
            backgroundColor: '#111111',
            border: '0.5px solid #2E2E2E',
          }}
        >
          {/* Rime text input with play button inside */}
          <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
            <input
              autoFocus
              value={activeRimeDisplay}
              onChange={e => setEditedRime(e.target.value)}
              spellCheck={false}
              placeholder="{phonetic} or spell(word)"
              title="Rime phonetic encoding — use {} for phonemes or spell() for spelling"
              style={{
                width: '100%',
                fontSize: '12px',
                fontFamily: 'ui-monospace, monospace',
                backgroundColor: '#1A1A1A',
                border: '0.5px solid #383838',
                borderRadius: '5px',
                color: '#FFFFFF',
                padding: '6px 38px 6px 10px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {/* Round play button — inside the input, right side */}
            <button
              onClick={() => {
                if (!hasPhonetic && !editedRime) return
                onPlay(suggestedKey, () => fetchPhoneticAudio(activeRimeApiText, RIME_API_KEY, selectedVoice))
              }}
              disabled={!hasPhonetic && !editedRime}
              title={`Preview: ${activeRimeDisplay}`}
              style={{
                position: 'absolute', right: '7px', top: '50%', transform: 'translateY(-50%)',
                width: '22px', height: '22px', borderRadius: '50%',
                border: '0.5px solid #383838', backgroundColor: '#161616',
                color: loadingAudio === suggestedKey || playingAudio === suggestedKey ? '#FFFFFF' : '#7C7C7C',
                cursor: !hasPhonetic && !editedRime ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                opacity: !hasPhonetic && !editedRime ? 0.35 : 1,
                flexShrink: 0,
              }}
            >
              {loadingAudio === suggestedKey
                ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', border: '1px solid #383838', borderTop: '1px solid #9C9C9C', animation: 'spin 0.8s linear infinite', display: 'block' }} />
                : <svg width="7" height="8" viewBox="0 0 9 10" fill="currentColor"><path d="M1 1.5v7l6.5-3.5L1 1.5z"/></svg>
              }
            </button>
          </div>

          {/* Reset to original */}
          {isEdited && (
            <button
              onClick={() => setEditedRime(null)}
              title="Reset to original"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '5px', border: '0.5px solid #383838', backgroundColor: 'transparent', color: '#7C7C7C', cursor: 'pointer', flexShrink: 0 }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M5.5 1A4.5 4.5 0 1 0 10 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M7.5 1h2.5v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          {/* Play back recording (shown when recording captured) */}
          {recState === 'done' && recordedUrl && (
            <button
              onClick={handlePlayRecording}
              title="Play back your recording"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '26px', height: '26px', borderRadius: '5px',
                border: '0.5px solid #383838', backgroundColor: 'transparent',
                color: recordingPlayback ? '#FFFFFF' : '#7C7C7C', cursor: 'pointer', flexShrink: 0,
              }}
            >
              {recordingPlayback
                ? <span style={{ width: '6px', height: '6px', borderRadius: '1px', backgroundColor: '#FFFFFF', display: 'block' }} />
                : <svg width="8" height="9" viewBox="0 0 9 10" fill="currentColor"><path d="M1 1.5v7l6.5-3.5L1 1.5z"/></svg>
              }
            </button>
          )}

          {/* Record button */}
          <button
            onClick={handleMicClick}
            title={micTitle}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              fontSize: '11px', padding: '4px 9px',
              borderRadius: '5px',
              border: `0.5px solid ${recState === 'idle' ? '#383838' : recState === 'recording' ? 'rgba(239,68,68,0.5)' : '#7C7C7C'}`,
              backgroundColor: recState === 'recording' ? 'rgba(239,68,68,0.08)' : 'transparent',
              color: recState === 'idle' ? '#7C7C7C' : recState === 'recording' ? '#ef4444' : '#CFCFCF',
              cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >
            {recState === 'analyzing' ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="11 6" strokeLinecap="round"/>
              </svg>
            ) : recState === 'recording' ? (
              <span style={{ width: '6px', height: '6px', borderRadius: '1px', backgroundColor: '#ef4444', display: 'block' }} />
            ) : recState === 'done' ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2L8 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="3.5" y="1" width="3" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M1.5 5a3.5 3.5 0 0 0 7 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <line x1="5" y1="8.5" x2="5" y2="9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
            )}
            {recState === 'idle' ? 'Record' : recState === 'recording' ? 'Stop' : recState === 'analyzing' ? 'Analyzing…' : 'Redo'}
          </button>

          <div style={{ width: '0.5px', height: '14px', backgroundColor: '#2E2E2E', flexShrink: 0 }} />

          {/* Save button */}
          {hasPendingChange ? (
            <button
              onClick={() => {
                onSaveCustomPronunciation(word, activeRimeBare)
                setShowCustomInput(false)
              }}
              title="Save this pronunciation"
              style={{
                fontSize: '11px', padding: '4px 10px', borderRadius: '5px',
                border: '0.5px solid rgba(52,211,153,0.45)',
                backgroundColor: 'rgba(52,211,153,0.1)',
                color: '#34d399', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: 600,
              }}
            >
              Save
            </button>
          ) : isSaved ? (
            <button
              onClick={() => {
                onClearCustomPronunciation(word)
              }}
              title="Clear saved pronunciation"
              style={{
                fontSize: '11px', padding: '4px 10px', borderRadius: '5px',
                border: '0.5px solid rgba(239,68,68,0.3)',
                backgroundColor: 'rgba(239,68,68,0.07)',
                color: '#f87171', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              Clear
            </button>
          ) : null}

          {/* Close × */}
          <button
            onClick={() => setShowCustomInput(false)}
            title="Close"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', borderRadius: '4px',
              border: 'none', backgroundColor: 'transparent',
              color: '#5C5C5C', cursor: 'pointer', flexShrink: 0, fontSize: '16px', lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Sentence context */}
      {sentences.length > 0 && (
        <div style={{ paddingBottom: '10px', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {sentences.map((s, i) => {
            const parts = s.split(new RegExp(`(${word})`, 'gi'))
            const wordLower = word.toLowerCase()
            return (
              <div key={i} style={{ fontSize: '11px', color: '#5C5C5C', lineHeight: 1.5 }}>
                {sentences.length > 1 && (
                  <span style={{ color: '#3C3C3C', fontVariantNumeric: 'tabular-nums', marginRight: '6px' }}>
                    [{i + 1}]
                  </span>
                )}
                {parts.map((part, j) =>
                  part.toLowerCase() === wordLower
                    ? <span key={j} style={{ color: '#FFFFFF', fontWeight: 600 }}>{part}</span>
                    : <span key={j}>{part}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── BulkCorrectionModal ──────────────────────────────────────────────────────

function BulkCorrectionModal({
  words,
  onClose,
  onSubmit,
}: {
  words: string[]
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
              Request corrections for all words
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              The Rime annotation team will review and publish each correction to the dictionary.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 transition hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Word list */}
        <div className="rounded-[5px] px-4 py-3 mb-4" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{words.length} word{words.length !== 1 ? 's' : ''}</p>
          <div className="flex flex-wrap gap-1.5">
            {words.map(w => (
              <span key={w} className="rounded px-2 py-0.5 font-mono text-xs" style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-emphasis)' }}>{w}</span>
            ))}
          </div>
        </div>

        {/* What will happen */}
        <div className="space-y-2 mb-5">
          {[
            { icon: '📬', text: 'The Rime annotation team will be alerted immediately' },
            { icon: '🎧', text: 'They will listen to each attempted pronunciation, review the suggested IPA, and publish corrections' },
            { icon: '⏱', text: 'Estimated turnaround: 1–3 business days per word' },
            { icon: '📊', text: 'You\'ll be able to track status in the Monitoring section' },
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
            Submit {words.length} request{words.length !== 1 ? 's' : ''} →
          </button>
        </div>
      </div>
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
        <div className="rounded-[5px] px-4 py-3 mb-4" style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
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
  if (pct > 50) return { backgroundColor: 'rgba(52,211,153,0.12)', color: '#34d399' }
  return { backgroundColor: 'rgba(248,113,113,0.12)', color: '#f87171' }
}

function HistoryItem({ entry, onRestore }: { entry: HistoryEntry; onRestore: (e: HistoryEntry) => void }) {
  const [textExpanded, setTextExpanded] = useState(false)
  const PREVIEW_LEN = 120
  const preview = entry.text.slice(0, PREVIEW_LEN).replace(/\n/g, ' ')
  const isTruncated = entry.text.length > PREVIEW_LEN

  return (
    <div className="rounded-[5px] p-3" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)' }}>
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
      <div className="px-3 py-2 mb-2 font-mono text-xs leading-relaxed" style={{ borderRadius: '2px', backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
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
        <span style={{ fontWeight: 600, fontSize: '15px', color: '#FFFFFF' }}>Project</span>
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

// ─── PronunciationPanel ───────────────────────────────────────────────────────

function PronunciationPanel({ pronunciations, expanded, onToggleExpanded, onClear, onCopy }: {
  pronunciations: Record<string, string>
  expanded: boolean
  onToggleExpanded: () => void
  onClear: (word: string) => void
  onCopy: () => void
}) {
  const entries = Object.entries(pronunciations)
  const json = JSON.stringify({ vocabId: 'default', pronunciations: Object.fromEntries(entries.map(([w, r]) => [w, `{${r}}`])) }, null, 2)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '15px', color: '#FFFFFF' }}>
          Custom Pronunciations
          {entries.length > 0 && <span style={{ marginLeft: '5px', fontSize: '11px', color: '#7C7C7C', fontWeight: 400 }}>({entries.length})</span>}
        </span>
        {entries.length > 0 && (
          <button onClick={onToggleExpanded} style={{ fontSize: '11px', color: '#7C7C7C', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p style={{ fontSize: '11px', color: '#7C7C7C', margin: 0 }}>
          Edit a word's Rime phonetic and press Save to build your custom map.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: expanded ? '10px' : 0 }}>
            {entries.map(([w, r]) => (
              <span key={w} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', border: '0.5px solid rgba(52,211,153,0.25)', backgroundColor: 'rgba(52,211,153,0.06)', color: '#34d399' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{w}</span>
                <span style={{ color: 'rgba(52,211,153,0.4)' }}>→</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', color: '#7C7C7C' }}>{`{${r}}`}</span>
                <button onClick={() => onClear(w)} title={`Clear saved pronunciation for "${w}"`} style={{ marginLeft: '1px', color: 'rgba(52,211,153,0.4)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 1, fontSize: '12px' }}>×</button>
              </span>
            ))}
          </div>

          {expanded && (
            <div style={{ borderRadius: '5px', backgroundColor: '#141414', border: '0.5px solid #2A2A2A', padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '10px', color: '#7C7C7C', fontFamily: 'ui-monospace, monospace' }}>rime_custom_pronunciations</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(json).catch(() => {}); onCopy() }}
                  style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', border: '0.5px solid #383838', backgroundColor: '#1f1f1f', color: '#9C9C9C', cursor: 'pointer' }}
                >
                  Copy JSON
                </button>
              </div>
              <pre style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace', color: '#9C9C9C', margin: 0, whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>{json}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
