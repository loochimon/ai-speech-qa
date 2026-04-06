import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback, useRef } from 'react'
import { fetchWordAudio, fetchPhoneticAudio } from '#/lib/api'

export const Route = createFileRoute('/annotation-management')({ component: AnnotationManagementPage })

const RIME_API_KEY = import.meta.env.VITE_RIME_API_KEY as string

// ─── types ────────────────────────────────────────────────────────────────────

interface Suggestion { ipa: string; rime: string; explanation: string }
interface ManagedWord {
  word: string; frequency: number; ipa: string; rime?: string; date: string
  status: 'Requested' | 'In Review' | 'Updated' | 'Rejected' | 'Approved'
  account: string; project: string; category: string; note: string; definition: string
  suggestions: Suggestion[]; recordingUrl?: string
}
interface Annotator { id: string; name: string; initials: string; color: string; words: ManagedWord[] }

// ─── mock data ────────────────────────────────────────────────────────────────

const SOFIA_WORDS: ManagedWord[] = [
  { word: 'Lisinopril', frequency: 18, ipa: 'lɪˈsɪnəprɪl', rime: 'l0Is1Inxpr0Il', date: 'Mar 27', status: 'Updated', account: 'Pfizer', project: 'Medication IVR', category: 'Pharma / Health', note: 'Used in medication reminders.', definition: 'An ACE inhibitor medication used to treat high blood pressure and heart failure.', recordingUrl: 'mock', suggestions: [{ ipa: 'lɪˈsɪnəprɪl', rime: 'l0Is1Inxpr0Il', explanation: 'Standard American — most common clinical usage' }, { ipa: 'lɪˈsɪnoʊprɪl', rime: 'l0Is1In0Upr0Il', explanation: 'Full vowel in 3rd syllable' }] },
  { word: 'Semaglutide', frequency: 5, ipa: 'sɛˌmæɡluːˈtaɪd', rime: 's0Em2@glu1tYd', date: 'Mar 27', status: 'Updated', account: 'Pfizer', project: 'Clinical Trials', category: 'Pharma / Health', note: '', definition: 'A GLP-1 receptor agonist used for type 2 diabetes management and weight loss.', suggestions: [{ ipa: 'sɛˌmæɡluːˈtaɪd', rime: 's0Em2@glu1tYd', explanation: 'Standard American — FDA-approved pronunciation' }] },
  { word: 'Ozempic', frequency: 8, ipa: 'oʊˈzɛmpɪk', rime: 'o1zEmIk', date: 'Mar 26', status: 'In Review', account: 'Pfizer', project: 'Patient Portal', category: 'Brand Names', note: 'Brand name — stress on second syllable confirmed.', definition: 'Brand name for semaglutide, a weekly injection for type 2 diabetes.', recordingUrl: 'mock', suggestions: [{ ipa: 'oʊˈzɛmpɪk', rime: 'o1zEmIk', explanation: 'Official brand — stress on 2nd syllable' }, { ipa: 'ˈoʊzɛmpɪk', rime: '1oUzEmIk', explanation: 'Stress on 1st syllable' }] },
  { word: 'Naranja', frequency: 23, ipa: 'naˈɾaŋxa', rime: 'na0r0aGxa', date: 'Mar 25', status: 'Rejected', account: 'Chase', project: 'Customer Support', category: 'Foreign Words', note: 'Spanish word for orange — used in bilingual IVR.', definition: 'Spanish word for "orange". Used in bilingual customer service scripts.', recordingUrl: 'mock', suggestions: [{ ipa: 'naˈɾaŋxa', rime: 'na0r0aGxa', explanation: 'Spanish native pronunciation' }] },
  { word: 'Metformin', frequency: 7, ipa: 'ˈmɛtfɔrmɪn', rime: 'm1Etf0OrmIn', date: 'Mar 23', status: 'Requested', account: 'CVS', project: 'Pharmacy Alerts', category: 'Pharma / Health', note: '', definition: 'First-line oral medication for type 2 diabetes.', suggestions: [{ ipa: 'ˈmɛtfɔrmɪn', rime: 'm1Etf0OrmIn', explanation: 'Standard American — MET-for-min' }] },
]

const MARCUS_WORDS: ManagedWord[] = [
  { word: 'Tylenol', frequency: 14, ipa: 'ˈtaɪlənɑl', rime: 't1Ylxnal', date: 'Mar 21', status: 'Updated', account: 'CVS', project: 'MinuteClinic', category: 'Brand Names', note: '', definition: 'Brand name for acetaminophen, an over-the-counter pain reliever and fever reducer.', suggestions: [{ ipa: 'ˈtaɪlənɑl', rime: 't1Ylxnal', explanation: 'Standard — TY-luh-nol' }] },
  { word: 'Omeprazole', frequency: 11, ipa: 'oʊˈmɛprəzoʊl', rime: 'o1Em0prxz0ol', date: 'Mar 20', status: 'Updated', account: 'Walgreens', project: 'Rx Notifications', category: 'Pharma / Health', note: '', definition: 'A proton pump inhibitor that reduces stomach acid. Generic form of Prilosec.', suggestions: [{ ipa: 'oʊˈmɛprəzoʊl', rime: 'o1Em0prxz0ol', explanation: 'Standard American — oh-MEP-ruh-zole' }] },
  { word: 'Pfizer', frequency: 41, ipa: 'ˈfaɪzər', rime: 'f1Yzxr', date: 'Mar 19', status: 'In Review', account: 'Pfizer', project: 'Medication IVR', category: 'Brand Names', note: 'Common mispronunciation: "Puh-fizer".', definition: 'American multinational pharmaceutical and biotechnology corporation.', recordingUrl: 'mock', suggestions: [{ ipa: 'ˈfaɪzər', rime: 'f1Yzxr', explanation: 'Correct — FY-zer ("P" is silent)' }] },
  { word: 'Autodraft', frequency: 11, ipa: 'ˈɔːtədræft', rime: '1OtxdrAft', date: 'Mar 25', status: 'Requested', account: 'Chase', project: 'Mobile Banking', category: 'FinTech', note: '', definition: 'Automatic recurring payment drafting from a bank account.', suggestions: [{ ipa: 'ˈɔːtədræft', rime: '1OtxdrAft', explanation: 'Standard American — AW-tuh-draft' }] },
]

const PRIYA_WORDS: ManagedWord[] = [
  { word: 'Wegovy', frequency: 3, ipa: 'ˈwiːɡoʊvi', rime: 'w1igoUvi', date: 'Mar 26', status: 'Updated', account: 'Pfizer', project: 'Patient Portal', category: 'Brand Names', note: '', definition: 'Brand name for higher-dose semaglutide, FDA-approved for chronic weight management.', suggestions: [{ ipa: 'ˈwiːɡoʊvi', rime: 'w1igoUvi', explanation: 'Standard — WEE-go-vee' }] },
  { word: 'QuickDeposit', frequency: 7, ipa: 'kwɪkdɪˈpɑzɪt', rime: 'kw0Ikd0Ip1azIt', date: 'Mar 24', status: 'Rejected', account: 'Chase', project: 'Mobile Banking', category: 'FinTech', note: 'Compound word — both syllables should be clear.', definition: 'Chase mobile feature for depositing checks by photographing them.', recordingUrl: 'mock', suggestions: [{ ipa: 'kwɪkdɪˈpɑzɪt', rime: 'kw0Ikd0Ip1azIt', explanation: 'Compound — equal weight on both parts' }] },
  { word: 'Zoloft', frequency: 9, ipa: 'ˈzoʊlɑft', rime: 'z1olaft', date: 'Mar 22', status: 'Requested', account: 'CVS', project: 'Pharmacy Alerts', category: 'Pharma / Health', note: 'Antidepressant brand. Rhymes with "so loft".', definition: 'Brand name for sertraline, an SSRI antidepressant.', suggestions: [{ ipa: 'ˈzoʊlɑft', rime: 'z1olaft', explanation: 'Official brand — ZOH-loft' }] },
]

const ANNOTATORS: Annotator[] = [
  { id: 'sofia',  name: 'Sofia Chen',  initials: 'SC', color: '#a78bfa', words: SOFIA_WORDS  },
  { id: 'marcus', name: 'Marcus Webb', initials: 'MW', color: '#34d399', words: MARCUS_WORDS },
  { id: 'priya',  name: 'Priya Nair',  initials: 'PN', color: '#fbbf24', words: PRIYA_WORDS  },
]

const STATUS_DOT: Record<string, string> = {
  Requested: '#a78bfa', 'In Review': '#fbbf24', Updated: '#34d399', Rejected: '#f87171', Approved: '#2dd4bf',
}

// ─── IPA tokens (for phoneme tooltip) ────────────────────────────────────────

const IPA_TOKENS: Array<{ ipa: string; rime: string; label: string }> = [
  { ipa: 'eɪ', rime: 'eI', label: 'face' }, { ipa: 'aɪ', rime: 'Y', label: 'price' },
  { ipa: 'ɔɪ', rime: 'OI', label: 'choice' }, { ipa: 'aʊ', rime: 'aU', label: 'mouth' },
  { ipa: 'oʊ', rime: 'oU', label: 'goat' }, { ipa: 'tʃ', rime: 'tS', label: 'chin' },
  { ipa: 'dʒ', rime: 'dZ', label: 'june' }, { ipa: 'æ', rime: '@', label: 'trap' },
  { ipa: 'ɑ', rime: 'a', label: 'lot' }, { ipa: 'ɔ', rime: 'O', label: 'thought' },
  { ipa: 'ə', rime: 'x', label: 'schwa' }, { ipa: 'ɛ', rime: 'E', label: 'dress' },
  { ipa: 'ɪ', rime: 'I', label: 'kit' }, { ipa: 'ʊ', rime: 'U', label: 'foot' },
  { ipa: 'ʌ', rime: 'V', label: 'strut' }, { ipa: 'ɝ', rime: 'xr', label: 'nurse' },
  { ipa: 'ɚ', rime: 'xr', label: 'letter' }, { ipa: 'i', rime: 'i', label: 'fleece' },
  { ipa: 'u', rime: 'u', label: 'goose' }, { ipa: 'e', rime: 'e', label: 'e' },
  { ipa: 'a', rime: 'a', label: 'a' }, { ipa: 'p', rime: 'p', label: 'p' },
  { ipa: 'b', rime: 'b', label: 'b' }, { ipa: 't', rime: 't', label: 't' },
  { ipa: 'd', rime: 'd', label: 'd' }, { ipa: 'k', rime: 'k', label: 'k' },
  { ipa: 'g', rime: 'g', label: 'g' }, { ipa: 'f', rime: 'f', label: 'f' },
  { ipa: 'v', rime: 'v', label: 'v' }, { ipa: 'θ', rime: 'T', label: 'thin' },
  { ipa: 'ð', rime: 'D', label: 'this' }, { ipa: 's', rime: 's', label: 's' },
  { ipa: 'z', rime: 'z', label: 'z' }, { ipa: 'ʃ', rime: 'S', label: 'she' },
  { ipa: 'ʒ', rime: 'Z', label: 'vision' }, { ipa: 'h', rime: 'h', label: 'h' },
  { ipa: 'm', rime: 'm', label: 'm' }, { ipa: 'n', rime: 'n', label: 'n' },
  { ipa: 'ŋ', rime: 'G', label: 'sing' }, { ipa: 'l', rime: 'l', label: 'l' },
  { ipa: 'r', rime: 'r', label: 'r' }, { ipa: 'ɹ', rime: 'r', label: 'r' },
  { ipa: 'ɾ', rime: 'r', label: 'flap' }, { ipa: 'w', rime: 'w', label: 'w' },
  { ipa: 'j', rime: 'y', label: 'yes' }, { ipa: 'x', rime: 'G', label: 'loch' },
  { ipa: 'ˈ', rime: '1', label: 'primary stress' }, { ipa: 'ˌ', rime: '2', label: 'secondary stress' },
]

function parseIpaToTokens(ipa: string) {
  const clean = ipa.replace(/[/\[\]]/g, '')
  const result: Array<{ ipa: string; rime: string; label: string }> = []
  let i = 0
  while (i < clean.length) {
    const two = clean.slice(i, i + 2)
    const matchTwo = IPA_TOKENS.find(t => t.ipa === two)
    if (matchTwo) { result.push(matchTwo); i += 2; continue }
    const one = clean[i]
    const matchOne = IPA_TOKENS.find(t => t.ipa === one)
    if (matchOne) { result.push(matchOne) }
    else if (one !== 'ː' && one !== ' ') { result.push({ ipa: one, rime: '', label: '' }) }
    i++
  }
  return result
}

function diffStrings(a: string, b: string): Array<{ char: string; type: 'same' | 'add' | 'remove' }> {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const ops: Array<{ char: string; type: 'same' | 'add' | 'remove' }> = []
  let i = a.length, j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { ops.unshift({ char: a[i - 1], type: 'same' }); i--; j-- }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { ops.unshift({ char: b[j - 1], type: 'add' }); j-- }
    else { ops.unshift({ char: a[i - 1], type: 'remove' }); i-- }
  }
  return ops
}

function generateContextSentences(word: string): [string, string, string] {
  const cap = word.charAt(0).toUpperCase() + word.slice(1)
  const low = word.toLowerCase()
  return [
    `${cap} is commonly used in this context.`,
    `The word ${low} appears in many sentences.`,
    `Here is an example using ${low}.`,
  ]
}

// ─── AnnotationManagementPage ─────────────────────────────────────────────────

function AnnotationManagementPage() {
  const [selectedAnnotatorId, setSelectedAnnotatorId] = useState<string | null>(null)
  const [annotatorWords, setAnnotatorWords] = useState<Record<string, ManagedWord[]>>(
    Object.fromEntries(ANNOTATORS.map(a => [a.id, a.words]))
  )

  const selectedAnnotator = selectedAnnotatorId ? ANNOTATORS.find(a => a.id === selectedAnnotatorId) : null

  if (selectedAnnotator) {
    return (
      <AnnotatorDetailView
        annotator={selectedAnnotator}
        words={annotatorWords[selectedAnnotator.id]}
        onBack={() => setSelectedAnnotatorId(null)}
        onApprove={(word) => setAnnotatorWords(prev => ({
          ...prev,
          [selectedAnnotator.id]: prev[selectedAnnotator.id].map(w => w.word === word ? { ...w, status: 'Approved' } : w)
        }))}
        onEdit={(word) => setAnnotatorWords(prev => ({
          ...prev,
          [selectedAnnotator.id]: prev[selectedAnnotator.id].map(w => w.word === word ? { ...w, status: 'In Review' } : w)
        }))}
        onApproveAll={() => setAnnotatorWords(prev => ({
          ...prev,
          [selectedAnnotator.id]: prev[selectedAnnotator.id].map(w => w.status === 'Updated' ? { ...w, status: 'Approved' } : w)
        }))}
      />
    )
  }

  return <AnnotatorOverview annotators={ANNOTATORS} wordsByAnnotator={annotatorWords} onSelect={setSelectedAnnotatorId} />
}

// ─── AnnotatorOverview ────────────────────────────────────────────────────────

function AnnotatorOverview({ annotators, wordsByAnnotator, onSelect }: {
  annotators: Annotator[]
  wordsByAnnotator: Record<string, ManagedWord[]>
  onSelect: (id: string) => void
}) {
  const totalWords = Object.values(wordsByAnnotator).flat().length
  const totalApproved = Object.values(wordsByAnnotator).flat().filter(w => w.status === 'Approved').length
  const totalSubmitted = Object.values(wordsByAnnotator).flat().filter(w => w.status === 'Updated' || w.status === 'Approved').length

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--surface-0)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-emphasis)', marginBottom: '4px' }}>Annotation Management</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Review and approve annotator work across all projects</div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'flex', gap: '1px', backgroundColor: 'var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
        {[
          { label: 'Total Words', value: totalWords, color: 'var(--text-emphasis)' },
          { label: 'Submitted', value: totalSubmitted, color: '#34d399' },
          { label: 'Approved', value: totalApproved, color: '#2dd4bf' },
          { label: 'Annotators', value: annotators.length, color: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, padding: '14px 24px', backgroundColor: 'var(--surface-1)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'monospace', color: s.color }}>{s.value}</span>
            <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Annotator cards */}
      <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {annotators.map(ann => {
          const words = wordsByAnnotator[ann.id]
          const submitted = words.filter(w => w.status === 'Updated' || w.status === 'Approved').length
          const approved = words.filter(w => w.status === 'Approved').length
          const rejected = words.filter(w => w.status === 'Rejected').length
          const pending = words.filter(w => w.status === 'Requested' || w.status === 'In Review').length
          const pct = words.length > 0 ? Math.round((submitted / words.length) * 100) : 0

          return (
            <div
              key={ann.id}
              style={{
                padding: '20px 24px', borderRadius: '8px',
                border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-1)',
                display: 'flex', alignItems: 'center', gap: '20px',
              }}
            >
              {/* Avatar */}
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: ann.color + '22', border: '1px solid ' + ann.color + '55', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: ann.color, flexShrink: 0, fontFamily: 'monospace' }}>
                {ann.initials}
              </div>

              {/* Name + progress */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-emphasis)', marginBottom: '6px' }}>{ann.name}</div>
                <div style={{ height: '4px', borderRadius: '2px', backgroundColor: 'var(--surface-3)', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ height: '100%', borderRadius: '2px', backgroundColor: ann.color, width: `${pct}%`, transition: 'width 0.3s' }} />
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {[
                    { label: 'Submitted', value: submitted, color: '#34d399' },
                    { label: 'Approved', value: approved, color: '#2dd4bf' },
                    { label: 'Rejected', value: rejected, color: '#f87171' },
                    { label: 'Pending', value: pending, color: 'var(--text-muted)' },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: s.color }}>{s.value}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* % complete */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'monospace', color: pct === 100 ? '#2dd4bf' : 'var(--text-emphasis)' }}>{pct}%</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{submitted}/{words.length} words</div>
              </div>

              {/* View button */}
              <button
                onClick={() => onSelect(ann.id)}
                style={{ padding: '9px 20px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-emphasis)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                View Work
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 5h6M5 2l3 3-3 3"/></svg>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── AnnotatorDetailView ──────────────────────────────────────────────────────

function AnnotatorDetailView({ annotator, words, onBack, onApprove, onEdit, onApproveAll }: {
  annotator: Annotator
  words: ManagedWord[]
  onBack: () => void
  onApprove: (word: string) => void
  onEdit: (word: string) => void
  onApproveAll: () => void
}) {
  const [allWords, setAllWords] = useState<ManagedWord[]>(words)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [doneHeight, setDoneHeight] = useState(160)

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: doneHeight }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      setDoneHeight(Math.max(40, Math.min(400, dragRef.current.startH + dragRef.current.startY - ev.clientY)))
    }
    const onUp = () => { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [doneHeight])

  const filtered = allWords.filter(w => {
    const matchSearch = !search || w.word.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'All' || w.status === statusFilter
    return matchSearch && matchStatus
  })

  const scrollToWord = useCallback((word: string) => {
    cardRefs.current.get(word)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleApprove = (word: string) => {
    setAllWords(prev => prev.map(w => w.word === word ? { ...w, status: 'Approved' } : w))
    onApprove(word)
  }

  const handleEdit = (word: string) => {
    setAllWords(prev => prev.map(w => w.word === word ? { ...w, status: 'In Review' } : w))
    onEdit(word)
  }

  const handleApproveAll = () => {
    setAllWords(prev => prev.map(w => w.status === 'Updated' ? { ...w, status: 'Approved' } : w))
    onApproveAll()
  }

  const pendingWords  = filtered.filter(w => w.status === 'Requested' || w.status === 'In Review')
  const submittedWords = filtered.filter(w => w.status === 'Updated' || w.status === 'Approved')
  const rejectedWords = filtered.filter(w => w.status === 'Rejected')
  const approvedCount = allWords.filter(w => w.status === 'Approved').length
  const submittedCount = allWords.filter(w => w.status === 'Updated' || w.status === 'Approved').length
  const hasUnapproved = allWords.some(w => w.status === 'Updated')

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--surface-0)', overflow: 'hidden' }}>

      {/* LEFT PANEL */}
      <div style={{ width: '240px', flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-1)' }}>

        {/* Back + annotator header */}
        <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <button
            onClick={onBack}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '11px', padding: '0 0 10px', marginBottom: '2px' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 5H2M5 2L2 5l3 3"/></svg>
            All Annotators
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: annotator.color + '22', border: '1px solid ' + annotator.color + '55', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: annotator.color, flexShrink: 0, fontFamily: 'monospace' }}>
              {annotator.initials}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-emphasis)' }}>{annotator.name}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{submittedCount}/{allWords.length} submitted</div>
            </div>
          </div>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={{ flex: 1, height: '3px', borderRadius: '2px', backgroundColor: 'var(--surface-3)' }}>
              <div style={{ height: '100%', borderRadius: '2px', backgroundColor: annotator.color, width: allWords.length > 0 ? `${(submittedCount / allWords.length) * 100}%` : '0%', transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{approvedCount}/{allWords.length}</span>
          </div>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '5px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)' }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}><circle cx="5" cy="5" r="4"/><line x1="8.5" y1="8.5" x2="11" y2="11"/></svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-emphasis)', flex: 1 }} />
          </div>
        </div>

        {/* Status filter */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ width: '100%', fontSize: '11px', padding: '4px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', outline: 'none' }}>
            <option value="All">All Status</option>
            <option value="Requested">Requested</option>
            <option value="In Review">In Review</option>
            <option value="Updated">Submitted</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        {/* Word lists */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
            Pending · {pendingWords.length}
          </div>
          {pendingWords.length > 0 ? pendingWords.map(w => {
            const i = filtered.indexOf(w)
            return <MgmtWordRow key={w.word} w={w} isSelected={i === selectedIndex} onClick={() => { setSelectedIndex(i); scrollToWord(w.word) }} />
          }) : <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No pending words</div>}
        </div>

        <div onMouseDown={handleDragStart} style={{ flexShrink: 0, height: '12px', cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
          <div style={{ width: '32px', height: '3px', borderRadius: '2px', backgroundColor: 'var(--text-muted)', opacity: 0.3 }} />
        </div>

        <div style={{ height: `${doneHeight}px`, flexShrink: 0, overflowY: 'auto' }}>
          <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
            Submitted · {submittedWords.length}
          </div>
          {submittedWords.length > 0 ? submittedWords.map(w => {
            const i = filtered.indexOf(w)
            return <MgmtWordRow key={w.word} w={w} isSelected={i === selectedIndex} onClick={() => { setSelectedIndex(i); scrollToWord(w.word) }} />
          }) : <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No submissions yet</div>}
        </div>

        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-subtle)', maxHeight: '140px', overflowY: 'auto' }}>
          <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
            Rejected · {rejectedWords.length}
          </div>
          {rejectedWords.length > 0 ? rejectedWords.map(w => {
            const i = filtered.indexOf(w)
            return <MgmtWordRow key={w.word} w={w} isSelected={i === selectedIndex} onClick={() => { setSelectedIndex(i); scrollToWord(w.word) }} />
          }) : <div style={{ padding: '12px 14px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No rejected words</div>}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div ref={rightPanelRef} style={{ flex: 1, overflowY: 'auto', padding: '0 0 80px' }}>
        {/* Sticky header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--surface-0)', borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-emphasis)' }}>
              {filtered.length} words
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <span style={{ color: '#2dd4bf', fontWeight: 700, fontFamily: 'monospace' }}>{approvedCount}</span>
                <span style={{ opacity: 0.4 }}> / </span>
                <span style={{ fontFamily: 'monospace' }}>{allWords.length}</span>
                {' '}approved
              </span>
              {hasUnapproved && (
                <button
                  onClick={handleApproveAll}
                  style={{ padding: '6px 16px', borderRadius: '5px', fontSize: '12px', fontWeight: 600, border: 'none', backgroundColor: '#2dd4bf', color: '#000', cursor: 'pointer' }}
                >
                  Approve All Submitted
                </button>
              )}
            </div>
          </div>
          <div style={{ height: '4px', borderRadius: '2px', backgroundColor: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: '2px', background: `linear-gradient(90deg, ${annotator.color}, #2dd4bf)`, transition: 'width 0.4s ease', width: allWords.length > 0 ? `${(approvedCount / allWords.length) * 100}%` : '0%' }} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '80px 40px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>No words match your filters</div>
        ) : (
          filtered.map((w, i) => (
            <ReviewWordCard
              key={`${w.word}-${i}`}
              word={w}
              isHighlighted={i === selectedIndex}
              cardRef={el => { if (el) cardRefs.current.set(w.word, el); else cardRefs.current.delete(w.word) }}
              onClick={() => setSelectedIndex(i)}
              onApprove={handleApprove}
              onEdit={handleEdit}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── MgmtWordRow ──────────────────────────────────────────────────────────────

function MgmtWordRow({ w, isSelected, onClick }: { w: ManagedWord; isSelected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', backgroundColor: isSelected ? 'var(--surface-2)' : 'transparent', transition: 'background-color 0.1s', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: STATUS_DOT[w.status] ?? 'var(--text-muted)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 400, color: 'var(--text-emphasis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.word}</div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{w.account}</div>
      </div>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>×{w.frequency}</span>
    </div>
  )
}

// ─── ReviewWordCard ───────────────────────────────────────────────────────────

function ReviewWordCard({ word, isHighlighted, cardRef, onClick, onApprove, onEdit }: {
  word: ManagedWord
  isHighlighted: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onClick: () => void
  onApprove: (word: string) => void
  onEdit: (word: string) => void
}) {
  const [playingIdx, setPlayingIdx] = useState<number | null>(null)
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null)
  const [hoveredIpaIdx, setHoveredIpaIdx] = useState<number | null>(null)
  const [playingRecording, setPlayingRecording] = useState(false)
  const [loadingRecording, setLoadingRecording] = useState(false)
  const [speedRate, setSpeedRate] = useState<1 | 0.75 | 0.5 | 0.25>(1)
  const [playingPreview, setPlayingPreview] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sentencePlaying, setSentencePlaying] = useState<boolean[]>([false, false, false])
  const [sentenceLoading, setSentenceLoading] = useState<boolean[]>([false, false, false])
  const sentenceAudioRefs = useRef<Array<HTMLAudioElement | null>>([null, null, null])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recordingAudioRef = useRef<HTMLAudioElement | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  const isDone = word.status === 'Updated' || word.status === 'Rejected' || word.status === 'Approved'
  const isApproved = word.status === 'Approved'
  const speedOptions: Array<1 | 0.75 | 0.5 | 0.25> = [1, 0.75, 0.5, 0.25]
  const pronunciation = word.rime ? `{${word.rime}}` : ''

  const handlePlayRecording = async () => {
    if (playingRecording) { recordingAudioRef.current?.pause(); setPlayingRecording(false); return }
    setLoadingRecording(true)
    try {
      const url = await fetchWordAudio(word.word, RIME_API_KEY, 'cove')
      const audio = new Audio(url); audio.playbackRate = speedRate
      recordingAudioRef.current = audio
      audio.onended = () => setPlayingRecording(false)
      await audio.play(); setPlayingRecording(true)
    } catch { /* fail silently */ } finally { setLoadingRecording(false) }
  }

  const handlePlaySuggestion = async (idx: number) => {
    if (playingIdx === idx) { audioRef.current?.pause(); setPlayingIdx(null); return }
    audioRef.current?.pause(); setLoadingIdx(idx)
    try {
      const url = await fetchWordAudio(word.word, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url); audio.playbackRate = speedRate
      audioRef.current = audio; audio.onended = () => setPlayingIdx(null)
      await audio.play(); setPlayingIdx(idx)
    } catch { /* fail silently */ } finally { setLoadingIdx(null) }
  }

  const handlePlay = async () => {
    const bare = pronunciation.trim()
    if (!bare) return
    if (playingPreview) { previewAudioRef.current?.pause(); setPlayingPreview(false); return }
    previewAudioRef.current?.pause(); setLoadingPreview(true)
    try {
      const url = await fetchPhoneticAudio(bare, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url); audio.playbackRate = speedRate
      previewAudioRef.current = audio; audio.onended = () => setPlayingPreview(false)
      await audio.play(); setPlayingPreview(true)
    } catch { /* fail silently */ } finally { setLoadingPreview(false) }
  }

  const handlePlaySentence = async (sentIdx: 0 | 1 | 2) => {
    if (sentencePlaying[sentIdx]) { sentenceAudioRefs.current[sentIdx]?.pause(); setSentencePlaying(prev => prev.map((v, i) => i === sentIdx ? false : v)); return }
    sentenceAudioRefs.current.forEach(a => a?.pause()); setSentencePlaying([false, false, false])
    setSentenceLoading(prev => prev.map((v, i) => i === sentIdx ? true : v))
    try {
      const sentences = generateContextSentences(word.word)
      const bare = pronunciation.trim().replace(/^\{|\}$/g, '')
      const text = sentences[sentIdx].replace(new RegExp(word.word, 'gi'), `{${bare}}`)
      const url = await fetchPhoneticAudio(text, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url); audio.playbackRate = speedRate
      sentenceAudioRefs.current[sentIdx] = audio
      audio.onended = () => setSentencePlaying(prev => prev.map((v, i) => i === sentIdx ? false : v))
      await audio.play(); setSentencePlaying(prev => prev.map((v, i) => i === sentIdx ? true : v))
    } catch { /* fail silently */ } finally { setSentenceLoading(prev => prev.map((v, i) => i === sentIdx ? false : v)) }
  }

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{ margin: '16px 32px', borderRadius: '8px', border: `1px solid ${isHighlighted ? 'rgba(139,92,246,0.4)' : 'var(--border-subtle)'}`, backgroundColor: isHighlighted ? 'rgba(139,92,246,0.03)' : 'var(--surface-1)', overflow: 'hidden', transition: 'border-color 0.15s', scrollMarginTop: '64px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-emphasis)' }}>{word.word}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>×{word.frequency}</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>{word.account}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '2px', borderRadius: '5px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            {speedOptions.map(s => (
              <button key={s} onClick={e => { e.stopPropagation(); setSpeedRate(s) }} style={{ padding: '2px 7px', borderRadius: '3px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', backgroundColor: speedRate === s ? 'var(--surface-3)' : 'transparent', color: speedRate === s ? 'var(--text-emphasis)' : 'var(--text-muted)' }}>{s}×</button>
            ))}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{word.date}</span>
          {isDone && (
            <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px', backgroundColor: isApproved ? 'rgba(45,212,191,0.1)' : word.status === 'Updated' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', color: isApproved ? '#2dd4bf' : word.status === 'Updated' ? '#34d399' : '#f87171', border: `1px solid ${isApproved ? 'rgba(45,212,191,0.3)' : word.status === 'Updated' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}` }}>{word.status}</span>
          )}
        </div>
      </div>

      {/* Definition + recording + note */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Definition</span>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(word.word)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={`Search "${word.word}" on Google`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '4px', border: '1px solid var(--border-subtle)', backgroundColor: 'transparent', color: 'var(--text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3M11 1L6 6"/></svg>
            </a>
          </div>
          {word.definition ? <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{word.definition}</p> : <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No definition available.</p>}
        </div>
        <div style={{ flex: 0.5, padding: '12px 20px', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '8px' }}>Recorded by annotator</div>
          {word.recordingUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
              <button onClick={e => { e.stopPropagation(); handlePlayRecording() }} style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, border: '1px solid var(--border-subtle)', backgroundColor: playingRecording ? 'rgba(251,191,36,0.1)' : 'var(--surface-2)', color: playingRecording ? '#fbbf24' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {loadingRecording ? <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} /> : playingRecording ? <svg width="7" height="8" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg> : <svg width="6" height="8" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>}
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1px', height: '20px' }}>
                  {Array.from({ length: 24 }, (_, i) => <div key={i} style={{ width: '2px', height: `${Math.max(3, Math.sin(i * 0.5 + 1) * 12 + 4)}px`, borderRadius: '1px', backgroundColor: playingRecording ? 'rgba(251,191,36,0.5)' : 'var(--text-muted)', opacity: playingRecording ? 0.8 : 0.25 }} />)}
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>Audio clip from annotator</span>
              </div>
            </div>
          ) : <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No recording.</div>}
        </div>
        <div style={{ flex: 0.6, padding: '12px 20px', backgroundColor: word.note ? 'rgba(139,92,246,0.06)' : 'transparent' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '8px' }}>Note from annotator</div>
          {word.note ? <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{word.note}</p> : <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No note.</div>}
        </div>
      </div>

      {/* AI Suggested Pronunciations */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '8px' }}>AI Suggested Pronunciations</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {word.suggestions.map((s, idx) => {
            const isPlaying = playingIdx === idx; const isLoading = loadingIdx === idx
            const ipaTokens = parseIpaToTokens(s.ipa)
            return (
              <div key={idx} style={{ flex: '1 1 0', minWidth: '200px', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
                <button onClick={e => { e.stopPropagation(); handlePlaySuggestion(idx) }} style={{ width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0, border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-3)', color: isPlaying ? '#fbbf24' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isLoading ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} /> : isPlaying ? <svg width="6" height="7" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg> : <svg width="5" height="7" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '10px', fontFamily: 'monospace', display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: '2px' }}>
                    <span style={{ color: '#a78bfa', position: 'relative', cursor: 'help', borderBottom: '1px dotted rgba(167,139,250,0.4)', display: 'inline-flex' }} onMouseEnter={e => { e.stopPropagation(); setHoveredIpaIdx(idx) }} onMouseLeave={() => setHoveredIpaIdx(null)}>
                      /{s.ipa}/
                      {hoveredIpaIdx === idx && ipaTokens.length > 0 && (
                        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, backgroundColor: '#1a1a1a', border: '1px solid var(--border-default)', borderRadius: '6px', padding: '8px 10px', zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: '160px', maxWidth: '260px' }}>
                          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '6px' }}>Phoneme breakdown</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {ipaTokens.map((tok, ti) => (
                              <div key={ti} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3px 5px', borderRadius: '3px', backgroundColor: tok.rime === '1' || tok.rime === '2' ? 'rgba(251,191,36,0.08)' : 'var(--surface-2)', border: `1px solid ${tok.rime === '1' || tok.rime === '2' ? 'rgba(251,191,36,0.2)' : 'var(--border-subtle)'}` }}>
                                <span style={{ fontSize: '11px', color: '#a78bfa', fontFamily: 'monospace', lineHeight: 1.2 }}>{tok.ipa}</span>
                                {tok.rime && <span style={{ fontSize: '9px', color: '#2dd4bf', fontFamily: 'monospace', lineHeight: 1.2, marginTop: '1px' }}>{tok.rime}</span>}
                                {tok.label && tok.label !== tok.ipa && <span style={{ fontSize: '8px', color: 'var(--text-muted)', lineHeight: 1.2 }}>{tok.label}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </span>
                    <span style={{ margin: '0 4px', color: 'var(--text-muted)', opacity: 0.3 }}>·</span>
                    <span style={{ color: '#2dd4bf' }}>{`{${s.rime}}`}</span>
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.3 }}>{s.explanation}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Review bar */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'var(--surface-2)', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        {isDone ? (
          <>
            {/* Pronunciation preview */}
            {pronunciation && (
              <div style={{ flexGrow: 1, flexShrink: 1, minWidth: '120px', position: 'relative' }}>
                <input readOnly value={pronunciation} style={{ width: '100%', padding: '8px 36px 8px 36px', borderRadius: '5px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-3)', fontFamily: 'monospace', fontSize: '12px', color: '#2dd4bf', outline: 'none', boxSizing: 'border-box' }} />
                <button onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handlePlay() }} style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%', border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-3)', color: playingPreview ? '#fbbf24' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {loadingPreview ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} /> : playingPreview ? <svg width="6" height="7" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg> : <svg width="5" height="7" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>}
                </button>
              </div>
            )}

            {/* In-context preview */}
            {pronunciation && (
              <div style={{ flexBasis: '100%', marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>In context</span>
                {generateContextSentences(word.word).map((sentence, sentIdx) => {
                  const positions = ['Start', 'Middle', 'End']
                  const isPlaying = sentencePlaying[sentIdx]; const isLoading = sentenceLoading[sentIdx]
                  const wordLower = word.word.toLowerCase()
                  const parts = sentence.split(new RegExp(`(${word.word})`, 'i'))
                  return (
                    <div key={sentIdx} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', borderRadius: '4px', backgroundColor: 'var(--surface-3)', border: '1px solid var(--border-subtle)' }}>
                      <button onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handlePlaySentence(sentIdx as 0 | 1 | 2) }} style={{ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)', color: isPlaying ? '#fbbf24' : '#2dd4bf', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isLoading ? <span style={{ width: '5px', height: '5px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} /> : isPlaying ? <svg width="5" height="6" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg> : <svg width="4" height="6" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>}
                      </button>
                      <span style={{ fontSize: '8px', color: 'var(--text-muted)', flexShrink: 0, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', width: '34px' }}>{positions[sentIdx]}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', flex: 1 }}>
                        {parts.map((part, pi) => part.toLowerCase() === wordLower ? <strong key={pi} style={{ color: 'var(--text-emphasis)', fontWeight: 700 }}>{part}</strong> : <span key={pi}>{part}</span>)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Status + action buttons */}
            <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
              <div style={{ padding: '8px 12px', borderRadius: '5px', fontSize: '12px', backgroundColor: isApproved ? 'rgba(45,212,191,0.06)' : word.status === 'Updated' ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)', border: `1px solid ${isApproved ? 'rgba(45,212,191,0.2)' : word.status === 'Updated' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`, color: isApproved ? '#2dd4bf' : word.status === 'Updated' ? '#34d399' : '#f87171' }}>
                {isApproved ? `✓ Approved: {${word.rime}}` : word.status === 'Updated' ? `Submitted: {${word.rime}}` : '✗ Rejected'}
              </div>
              {!isApproved && word.status === 'Updated' && (
                <button onClick={e => { e.stopPropagation(); onApprove(word.word) }} style={{ padding: '8px 20px', borderRadius: '5px', fontSize: '12px', fontWeight: 600, border: 'none', backgroundColor: '#2dd4bf', color: '#000', cursor: 'pointer', flexShrink: 0 }}>
                  Approve ✓
                </button>
              )}
              <button onClick={e => { e.stopPropagation(); onEdit(word.word) }} style={{ padding: '8px 16px', borderRadius: '5px', fontSize: '12px', fontWeight: 500, border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}>
                {isApproved ? 'Revoke' : 'Send Back'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Waiting for annotator to submit…
          </div>
        )}
      </div>
    </div>
  )
}
