import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef } from 'react'
import type { RequestedWord } from './index'
import { fetchWordAudio, fetchPhoneticAudio } from '#/lib/api'

export const Route = createFileRoute('/corrections')({ component: CorrectionsPage })

const RIME_API_KEY = import.meta.env.VITE_RIME_API_KEY as string

// ─── types + mock data ────────────────────────────────────────────────────────

interface Suggestion {
  ipa: string
  rime: string
  explanation: string
}

interface AnnotationWord extends RequestedWord {
  account: string
  project: string
  category: string
  note: string
  definition: string
  suggestions: Suggestion[]
  recordingUrl?: string
}

const CATEGORIES = ['All Categories', 'Pharma / Health', 'FinTech', 'Acronyms', 'Brand Names', 'Foreign Words']

const ACCOUNT_PROJECTS: Record<string, string[]> = {
  Pfizer:    ['Medication IVR', 'Patient Portal', 'Clinical Trials'],
  Chase:     ['Mobile Banking', 'Customer Support', 'Fraud Detection'],
  CVS:       ['Pharmacy Alerts', 'MinuteClinic', 'Rewards Program'],
  Walgreens: ['Rx Notifications', 'Store Locator'],
}

const MOCK_WORDS: AnnotationWord[] = [
  // ── 3 suggestions ──
  {
    word: 'Lisinopril', frequency: 18, ipa: 'lɪˈsɪnəprɪl', rime: 'l0Is1Inxpr0Il', date: 'Mar 27', status: 'Requested', account: 'Pfizer', project: 'Medication IVR', category: 'Pharma / Health',
    note: 'Used in medication reminders. Customer says current pronunciation sounds robotic.',
    definition: 'An ACE inhibitor medication used to treat high blood pressure and heart failure.',
    recordingUrl: 'mock',
    suggestions: [
      { ipa: 'lɪˈsɪnəprɪl',  rime: 'l0Is1Inxpr0Il',  explanation: 'Standard American — most common clinical usage' },
      { ipa: 'lɪˈsɪnoʊprɪl', rime: 'l0Is1In0Upr0Il', explanation: 'Full vowel in 3rd syllable — closer to Latin root' },
      { ipa: 'laɪˈsɪnəprɪl', rime: 'lY0s1Inxpr0Il',  explanation: 'Lay-SIN-oh-pril — common patient mispronunciation' },
    ],
  },
  {
    word: 'Semaglutide', frequency: 5, ipa: 'sɛˌmæɡluːˈtaɪd', rime: 's0Em2@glu1tYd', date: 'Mar 27', status: 'Requested', account: 'Pfizer', project: 'Clinical Trials', category: 'Pharma / Health',
    note: '',
    definition: 'A GLP-1 receptor agonist used for type 2 diabetes management and weight loss.',
    suggestions: [
      { ipa: 'sɛˌmæɡluːˈtaɪd', rime: 's0Em2@glu1tYd', explanation: 'Standard American — FDA-approved pronunciation' },
      { ipa: 'ˌsɛməˈɡluːtaɪd', rime: '2sEmx0glu1tYd', explanation: 'Alternative stress — secondary on first syllable' },
      { ipa: 'sɛˌmæɡluːˈtiːd', rime: 's0Em2@glu1tid',  explanation: 'British English variant — long "ee" ending' },
    ],
  },
  {
    word: 'Ozempic', frequency: 8, ipa: 'oʊˈzɛmpɪk', rime: 'o1zEmIk', date: 'Mar 26', status: 'Requested', account: 'Pfizer', project: 'Patient Portal', category: 'Brand Names',
    note: 'Brand name — stress on second syllable confirmed by Pfizer team.',
    definition: 'Brand name for semaglutide, a weekly injection for type 2 diabetes.',
    recordingUrl: 'mock',
    suggestions: [
      { ipa: 'oʊˈzɛmpɪk', rime: 'o1zEmIk',   explanation: 'Official brand — stress on 2nd syllable' },
      { ipa: 'ˈoʊzɛmpɪk', rime: '1oUzEmIk',  explanation: 'Stress on 1st syllable — common informal usage' },
      { ipa: 'oʊˈzæmpɪk', rime: 'o1z@mpIk',  explanation: 'Open "a" variant — regional accents' },
    ],
  },
  {
    word: 'Naranja', frequency: 23, ipa: 'naˈɾaŋxa', rime: 'na0r0aGxa', date: 'Mar 25', status: 'Requested', account: 'Chase', project: 'Customer Support', category: 'Foreign Words',
    note: 'Spanish word for orange — used in bilingual IVR flow.',
    definition: 'Spanish word for "orange" (the fruit). Used in bilingual customer service scripts.',
    recordingUrl: 'mock',
    suggestions: [
      { ipa: 'naˈɾaŋxa',  rime: 'na0r0aGxa', explanation: 'Spanish native — flap "r", velar fricative' },
      { ipa: 'nəˈɹɑːŋxə', rime: 'nx0r1aGxn', explanation: 'Anglicized — English "r", reduced vowels' },
      { ipa: 'naˈɾaŋha',  rime: 'na0r0anha', explanation: 'Mexican Spanish — "j" as "h"' },
    ],
  },
  {
    word: 'Metformin', frequency: 7, ipa: 'ˈmɛtfɔrmɪn', rime: 'm1Etf0OrmIn', date: 'Mar 23', status: 'Requested', account: 'CVS', project: 'Pharmacy Alerts', category: 'Pharma / Health',
    note: '',
    definition: 'First-line oral medication for type 2 diabetes; reduces glucose production in the liver.',
    suggestions: [
      { ipa: 'ˈmɛtfɔrmɪn',  rime: 'm1Etf0OrmIn',  explanation: 'Standard American — MET-for-min' },
      { ipa: 'ˈmɛtfɔːmɪn',  rime: 'm1Etf1OrmIn',  explanation: 'British English — longer "or" vowel' },
      { ipa: 'ˈmɛtfoʊrmɪn', rime: 'm1EtfoUrmIn', explanation: 'Informal — reduced middle syllable' },
    ],
  },
  {
    word: 'Tylenol', frequency: 14, ipa: 'ˈtaɪlənɑl', rime: 't1Ylxnal', date: 'Mar 21', status: 'Requested', account: 'CVS', project: 'MinuteClinic', category: 'Brand Names',
    note: '',
    definition: 'Brand name for acetaminophen, an over-the-counter pain reliever and fever reducer.',
    suggestions: [
      { ipa: 'ˈtaɪlənɑl', rime: 't1Ylxnal',  explanation: 'Standard — TY-luh-nol' },
      { ipa: 'ˈtaɪlənɔl', rime: 't1Ylxn0Ol', explanation: 'Cot-caught distinction — TY-luh-nawl' },
      { ipa: 'ˈtaɪlənol', rime: 't1Ylxnol',  explanation: 'Informal reduced — TY-luh-nole' },
    ],
  },
  {
    word: 'Omeprazole', frequency: 11, ipa: 'oʊˈmɛprəzoʊl', rime: 'o1Em0prxz0ol', date: 'Mar 20', status: 'Requested', account: 'Walgreens', project: 'Rx Notifications', category: 'Pharma / Health',
    note: '',
    definition: 'A proton pump inhibitor that reduces stomach acid. Generic form of Prilosec.',
    suggestions: [
      { ipa: 'oʊˈmɛprəzoʊl',  rime: 'o1Em0prxz0ol',  explanation: 'Standard American — oh-MEP-ruh-zole' },
      { ipa: 'oʊˈmɛprəzɒl',   rime: 'o1Em0prxz0al',  explanation: 'British English — shorter final vowel' },
      { ipa: 'ˌoʊmɛˈprəzoʊl', rime: '2oUmE0prxz0ol', explanation: 'Alternate stress — oh-mep-ruh-ZOLE' },
    ],
  },
  {
    word: 'Pfizer', frequency: 41, ipa: 'ˈfaɪzər', rime: 'f1Yzxr', date: 'Mar 19', status: 'Requested', account: 'Pfizer', project: 'Medication IVR', category: 'Brand Names',
    note: 'Common mispronunciation: "Puh-fizer". Correct: "Fy-zer".',
    definition: 'American multinational pharmaceutical and biotechnology corporation.',
    recordingUrl: 'mock',
    suggestions: [
      { ipa: 'ˈfaɪzər',    rime: 'f1Yzxr',    explanation: 'Correct — FY-zer ("P" is silent)' },
      { ipa: 'ˈfaɪzɛr',    rime: 'f1YzEr',    explanation: 'Full final vowel — clear "e"' },
      { ipa: 'pəˈfaɪzər',  rime: 'px0f1Yzxr', explanation: 'Common error — puh-FY-zer (avoid)' },
    ],
  },
  // ── 2 suggestions ──
  {
    word: 'Wegovy', frequency: 3, ipa: 'ˈwiːɡoʊvi', rime: 'w1igoUvi', date: 'Mar 26', status: 'In Review', account: 'Pfizer', project: 'Patient Portal', category: 'Brand Names',
    note: '',
    definition: 'Brand name for higher-dose semaglutide, FDA-approved for chronic weight management.',
    suggestions: [
      { ipa: 'ˈwiːɡoʊvi', rime: 'w1igoUvi', explanation: 'Standard — WEE-go-vee' },
      { ipa: 'ˈwɛɡoʊvi',  rime: 'w1EgoUvi', explanation: 'Short "e" variant — WEH-go-vee' },
    ],
  },
  {
    word: 'Autodraft', frequency: 11, ipa: 'ˈɔːtədræft', rime: '1OtxdrAft', date: 'Mar 25', status: 'Requested', account: 'Chase', project: 'Mobile Banking', category: 'FinTech',
    note: '',
    definition: 'Automatic recurring payment drafting from a bank account.',
    suggestions: [
      { ipa: 'ˈɔːtədræft', rime: '1OtxdrAft', explanation: 'Standard American — AW-tuh-draft' },
      { ipa: 'ˈɑːtodræft', rime: '1atUdrAft', explanation: 'Cot-caught merged — AH-toh-draft' },
    ],
  },
  {
    word: 'QuickDeposit', frequency: 7, ipa: 'kwɪkdɪˈpɑzɪt', rime: 'kw0Ikd0Ip1azIt', date: 'Mar 24', status: 'Requested', account: 'Chase', project: 'Mobile Banking', category: 'FinTech',
    note: 'Compound word — both syllables should be clear.',
    definition: 'Chase mobile feature for depositing checks by photographing them.',
    recordingUrl: 'mock',
    suggestions: [
      { ipa: 'kwɪkdɪˈpɑzɪt', rime: 'kw0Ikd0Ip1azIt', explanation: 'Compound — equal weight on both parts' },
      { ipa: 'ˈkwɪkdɪpɑzɪt', rime: '1kw0Ikd0IpazIt', explanation: 'Single primary stress on "Quick"' },
    ],
  },
  {
    word: 'Zoloft', frequency: 9, ipa: 'ˈzoʊlɑft', rime: 'z1olaft', date: 'Mar 22', status: 'In Review', account: 'CVS', project: 'Pharmacy Alerts', category: 'Pharma / Health',
    note: 'Antidepressant brand. Rhymes with "so loft".',
    definition: 'Brand name for sertraline, an SSRI antidepressant used to treat depression and anxiety.',
    suggestions: [
      { ipa: 'ˈzoʊlɑft', rime: 'z1olaft',  explanation: 'Official brand — ZOH-loft' },
      { ipa: 'ˈzoʊlɔft', rime: 'z1ol0Oft', explanation: 'Cot-caught distinction — ZOH-lawft' },
    ],
  },
]

const ACCOUNTS = ['All Accounts', 'Pfizer', 'Chase', 'CVS', 'Walgreens']

const STATUS_DOT: Record<string, string> = {
  Requested:   '#a78bfa',
  'In Review': '#fbbf24',
  Updated:     '#34d399',
  Rejected:    '#f87171',
}

// ─── IPA → Rime phoneme lookup (for phoneme breakdown tooltip) ────────────────

const IPA_TOKENS: Array<{ ipa: string; rime: string; label: string }> = [
  // Diphthongs (must check before monophthongs)
  { ipa: 'eɪ', rime: 'eI', label: 'face' },
  { ipa: 'aɪ', rime: 'Y',  label: 'price' },
  { ipa: 'ɔɪ', rime: 'OI', label: 'choice' },
  { ipa: 'aʊ', rime: 'aU', label: 'mouth' },
  { ipa: 'oʊ', rime: 'oU', label: 'goat' },
  { ipa: 'tʃ', rime: 'tS', label: 'chin' },
  { ipa: 'dʒ', rime: 'dZ', label: 'june' },
  // Monophthongs
  { ipa: 'æ',  rime: '@',  label: 'trap' },
  { ipa: 'ɑ',  rime: 'a',  label: 'lot' },
  { ipa: 'ɔ',  rime: 'O',  label: 'thought' },
  { ipa: 'ə',  rime: 'x',  label: 'schwa' },
  { ipa: 'ɛ',  rime: 'E',  label: 'dress' },
  { ipa: 'ɪ',  rime: 'I',  label: 'kit' },
  { ipa: 'ʊ',  rime: 'U',  label: 'foot' },
  { ipa: 'ʌ',  rime: 'V',  label: 'strut' },
  { ipa: 'ɝ',  rime: 'xr', label: 'nurse' },
  { ipa: 'ɚ',  rime: 'xr', label: 'letter' },
  { ipa: 'i',  rime: 'i',  label: 'fleece' },
  { ipa: 'u',  rime: 'u',  label: 'goose' },
  { ipa: 'e',  rime: 'e',  label: 'e' },
  { ipa: 'a',  rime: 'a',  label: 'a' },
  // Consonants
  { ipa: 'p',  rime: 'p',  label: 'p' },
  { ipa: 'b',  rime: 'b',  label: 'b' },
  { ipa: 't',  rime: 't',  label: 't' },
  { ipa: 'd',  rime: 'd',  label: 'd' },
  { ipa: 'k',  rime: 'k',  label: 'k' },
  { ipa: 'g',  rime: 'g',  label: 'g' },
  { ipa: 'f',  rime: 'f',  label: 'f' },
  { ipa: 'v',  rime: 'v',  label: 'v' },
  { ipa: 'θ',  rime: 'T',  label: 'thin' },
  { ipa: 'ð',  rime: 'D',  label: 'this' },
  { ipa: 's',  rime: 's',  label: 's' },
  { ipa: 'z',  rime: 'z',  label: 'z' },
  { ipa: 'ʃ',  rime: 'S',  label: 'she' },
  { ipa: 'ʒ',  rime: 'Z',  label: 'vision' },
  { ipa: 'h',  rime: 'h',  label: 'h' },
  { ipa: 'm',  rime: 'm',  label: 'm' },
  { ipa: 'n',  rime: 'n',  label: 'n' },
  { ipa: 'ŋ',  rime: 'G',  label: 'sing' },
  { ipa: 'l',  rime: 'l',  label: 'l' },
  { ipa: 'r',  rime: 'r',  label: 'r' },
  { ipa: 'ɹ',  rime: 'r',  label: 'r' },
  { ipa: 'ɾ',  rime: 'r',  label: 'flap' },
  { ipa: 'w',  rime: 'w',  label: 'w' },
  { ipa: 'j',  rime: 'y',  label: 'yes' },
  { ipa: 'x',  rime: 'G',  label: 'loch' },
  // Stress marks
  { ipa: 'ˈ',  rime: '1',  label: 'primary stress' },
  { ipa: 'ˌ',  rime: '2',  label: 'secondary stress' },
]

function parseIpaToTokens(ipa: string): Array<{ ipa: string; rime: string; label: string }> {
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

// ─── Simple char-level diff ───────────────────────────────────────────────────

function diffStrings(a: string, b: string): Array<{ char: string; type: 'same' | 'add' | 'remove' }> {
  // Build LCS table
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])

  // Backtrack
  const result: Array<{ char: string; type: 'same' | 'add' | 'remove' }> = []
  let i = a.length, j = b.length
  const ops: Array<{ char: string; type: 'same' | 'add' | 'remove' }> = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ char: a[i - 1], type: 'same' }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ char: b[j - 1], type: 'add' }); j--
    } else {
      ops.unshift({ char: a[i - 1], type: 'remove' }); i--
    }
  }
  return ops.length ? ops : result
}

// ─── CorrectionsPage ──────────────────────────────────────────────────────────

function CorrectionsPage() {
  const [allWords, setAllWords] = useState<AnnotationWord[]>(MOCK_WORDS)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('All Accounts')
  const [projectFilter, setProjectFilter] = useState('All Projects')
  const [statusFilter, setStatusFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All Categories')
  const [showBanner, setShowBanner] = useState(true)

  // Refs for scrolling right panel to a word card
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const rightPanelRef = useRef<HTMLDivElement>(null)

  // Drag handle for pending/done split
  const [doneHeight, setDoneHeight] = useState(160)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: doneHeight }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      setDoneHeight(Math.max(40, Math.min(500, dragRef.current.startH + delta)))
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [doneHeight])

  // Merge localStorage words on mount
  useEffect(() => {
    try {
      const stored: RequestedWord[] = JSON.parse(localStorage.getItem('rime_requested_words') ?? '[]')
      const mockSet = new Set(MOCK_WORDS.map(w => w.word.toLowerCase()))
      const extra: AnnotationWord[] = stored
        .filter(w => !mockSet.has(w.word.toLowerCase()))
        .map(w => ({ ...w, account: 'Unknown', project: 'Unknown', category: 'Uncategorized', note: '', definition: '', suggestions: [] }))
      if (extra.length > 0) setAllWords([...MOCK_WORDS, ...extra])
    } catch { /* ignore */ }
  }, [])

  // Derive available projects for the selected account
  const availableProjects = accountFilter !== 'All Accounts'
    ? ACCOUNT_PROJECTS[accountFilter] ?? []
    : []

  const filtered = allWords.filter(w => {
    const matchSearch = !search || w.word.toLowerCase().includes(search.toLowerCase())
    const matchAccount = accountFilter === 'All Accounts' || w.account === accountFilter
    const matchProject = projectFilter === 'All Projects' || w.project === projectFilter
    const matchStatus = statusFilter === 'All' || w.status === statusFilter
    const matchCategory = categoryFilter === 'All Categories' || w.category === categoryFilter
    return matchSearch && matchAccount && matchProject && matchStatus && matchCategory
  })

  // Clamp selected index when filter changes
  useEffect(() => {
    setSelectedIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  // Scroll right panel to selected card when selectedIndex changes via keyboard
  const scrollToWord = useCallback((word: string) => {
    const el = cardRefs.current.get(word)
    if (el && rightPanelRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  useEffect(() => {
    const w = filtered[selectedIndex]
    if (w) scrollToWord(w.word)
  }, [selectedIndex, scrollToWord])

  // Arrow key navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered.length])

  const handleSubmit = useCallback((word: string, pronunciation: string) => {
    setAllWords(prev => prev.map(w => w.word === word ? { ...w, status: 'Updated', rime: pronunciation } : w))
    setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
  }, [filtered.length])

  const handleReject = useCallback((word: string) => {
    setAllWords(prev => prev.map(w => w.word === word ? { ...w, status: 'Rejected' } : w))
    setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
  }, [filtered.length])

  const handleEdit = useCallback((word: string) => {
    setAllWords(prev => prev.map(w => w.word === word ? { ...w, status: 'In Review' } : w))
  }, [])

  const done    = filtered.filter(w => w.status === 'Updated' || w.status === 'Rejected').length
  const pending = filtered.length - done

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--surface-0)', overflow: 'hidden' }}>

      {/* ── LEFT: word queue ── */}
      <div style={{ width: '240px', flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-1)' }}>

        {/* Header + progress */}
        <div style={{ padding: '18px 14px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-emphasis)', marginBottom: '10px' }}>
            Requested Words
          </div>
          {/* Progress bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <div style={{ flex: 1, height: '3px', borderRadius: '2px', backgroundColor: 'var(--surface-3)' }}>
              <div style={{ height: '100%', borderRadius: '2px', backgroundColor: '#34d399', transition: 'width 0.3s', width: filtered.length > 0 ? `${(done / filtered.length) * 100}%` : '0%' }} />
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{done}/{filtered.length}</span>
          </div>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '5px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)' }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <circle cx="5" cy="5" r="4" /><line x1="8.5" y1="8.5" x2="11" y2="11" />
            </svg>
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setSelectedIndex(0) }}
              placeholder="Search…"
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-emphasis)', flex: 1 }} />
          </div>
        </div>

        {/* Filters */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ display: 'flex', gap: '5px' }}>
            <select value={accountFilter} onChange={e => { setAccountFilter(e.target.value); setProjectFilter('All Projects'); setSelectedIndex(0) }}
              style={{ flex: 1, fontSize: '11px', padding: '4px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', outline: 'none' }}>
              {ACCOUNTS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setSelectedIndex(0) }}
              style={{ flex: 1, fontSize: '11px', padding: '4px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', outline: 'none' }}>
              <option value="All">All Status</option>
              <option value="Requested">Requested</option>
              <option value="In Review">In Review</option>
              <option value="Updated">Updated</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setSelectedIndex(0) }}
            style={{ width: '100%', fontSize: '11px', padding: '4px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', outline: 'none' }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {accountFilter !== 'All Accounts' && availableProjects.length > 0 && (
            <select value={projectFilter} onChange={e => { setProjectFilter(e.target.value); setSelectedIndex(0) }}
              style={{ width: '100%', fontSize: '11px', padding: '4px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', outline: 'none' }}>
              <option value="All Projects">All Projects</option>
              {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
        </div>

        {(() => {
          const pendingWords = filtered.filter(w => w.status === 'Requested' || w.status === 'In Review')
          const doneWords = filtered.filter(w => w.status === 'Updated' || w.status === 'Rejected')
          return (
            <>
              {/* Pending — takes remaining space */}
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
                  Pending · {pendingWords.length}
                </div>
                {pendingWords.length > 0 ? (
                  pendingWords.map(w => {
                    const i = filtered.indexOf(w)
                    return <WordListRow key={w.word} w={w} isSelected={i === selectedIndex} onClick={() => { setSelectedIndex(i); scrollToWord(w.word) }} />
                  })
                ) : filtered.length === 0 ? (
                  <div style={{ padding: '32px 14px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>No words match filters</div>
                ) : (
                  <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>All done!</div>
                )}
              </div>

              {/* Drag handle */}
              <div
                onMouseDown={handleDragStart}
                style={{
                  flexShrink: 0, height: '12px', cursor: 'row-resize',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)',
                  backgroundColor: 'var(--surface-2)',
                }}
              >
                <div style={{ width: '32px', height: '3px', borderRadius: '2px', backgroundColor: 'var(--text-muted)', opacity: 0.3 }} />
              </div>

              {/* Done — resizable via drag */}
              <div style={{ height: `${doneHeight}px`, flexShrink: 0, overflowY: 'auto' }}>
                <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
                  Done · {doneWords.length}
                </div>
                {doneWords.length > 0 ? (
                  doneWords.map(w => {
                    const i = filtered.indexOf(w)
                    return <WordListRow key={w.word} w={w} isSelected={i === selectedIndex} onClick={() => { setSelectedIndex(i); scrollToWord(w.word) }} />
                  })
                ) : (
                  <div style={{ padding: '16px 14px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No words completed yet</div>
                )}
              </div>
            </>
          )
        })()}

        {/* Keyboard hint */}
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {['↑','↓'].map(k => (
            <kbd key={k} style={{ padding: '1px 5px', borderRadius: '3px', fontSize: '10px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-default)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{k}</kbd>
          ))}
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>navigate · scroll to word</span>
        </div>
      </div>

      {/* ── RIGHT: all words expanded ── */}
      <div ref={rightPanelRef} style={{ flex: 1, overflowY: 'auto', padding: '0 0 80px' }}>

        {/* New words banner */}
        {showBanner && (
          <div style={{
            margin: '12px 32px 0', padding: '10px 16px', borderRadius: '8px',
            backgroundColor: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>📥</span>
              <span style={{ fontSize: '12px', color: 'var(--text-emphasis)' }}>
                <strong>5 new words</strong> requested by <strong>ramona@rime.ai</strong> · Pfizer — Medication IVR
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>just now</span>
            </div>
            <button
              onClick={() => setShowBanner(false)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', padding: '2px', display: 'flex', fontSize: '16px', lineHeight: 1,
              }}
            >×</button>
          </div>
        )}

        {/* Sticky header with progress */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--surface-0)', borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-emphasis)' }}>
              {filtered.length} words
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <span style={{ color: '#34d399', fontWeight: 700, fontFamily: 'monospace' }}>{done}</span>
                <span style={{ opacity: 0.4 }}> / </span>
                <span style={{ fontFamily: 'monospace' }}>{filtered.length}</span>
                {' '}completed
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', color: filtered.length > 0 ? '#34d399' : 'var(--text-muted)' }}>
                {filtered.length > 0 ? Math.round((done / filtered.length) * 100) : 0}%
              </span>
            </div>
          </div>
          <div style={{ height: '4px', borderRadius: '2px', backgroundColor: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '2px',
              background: 'linear-gradient(90deg, #34d399, #2dd4bf)',
              transition: 'width 0.4s ease',
              width: filtered.length > 0 ? `${(done / filtered.length) * 100}%` : '0%',
            }} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '80px 40px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
            No words match your filters
          </div>
        ) : (
          filtered.map((w, i) => (
            <WordCard
              key={`${w.word}-${i}`}
              word={w}
              isHighlighted={i === selectedIndex}
              cardRef={(el) => { if (el) cardRefs.current.set(w.word, el); else cardRefs.current.delete(w.word) }}
              onSubmit={handleSubmit}
              onReject={handleReject}
              onEdit={handleEdit}
              onClick={() => setSelectedIndex(i)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── WordListRow ──────────────────────────────────────────────────────────────

function WordListRow({ w, isSelected, onClick }: { w: AnnotationWord; isSelected: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
      backgroundColor: isSelected ? 'var(--surface-2)' : 'transparent',
      borderLeft: isSelected ? '2px solid #a78bfa' : '2px solid transparent',
      transition: 'background-color 0.1s', display: 'flex', alignItems: 'center', gap: '8px',
    }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: STATUS_DOT[w.status] ?? 'var(--text-muted)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 400, color: 'var(--text-emphasis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.word}</div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{w.account}</div>
      </div>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>×{w.frequency}</span>
    </div>
  )
}

// ─── WordCard — expanded annotation card ──────────────────────────────────────

function WordCard({ word, isHighlighted, cardRef, onSubmit, onReject, onEdit, onClick }: {
  word: AnnotationWord
  isHighlighted: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onSubmit: (word: string, pronunciation: string) => void
  onReject: (word: string) => void
  onEdit: (word: string) => void
  onClick: () => void
}) {
  const [pronunciation, setPronunciation] = useState(word.rime ? `{${word.rime}}` : '')
  const [playingIdx, setPlayingIdx] = useState<number | null>(null)
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null)
  const [usedIdx, setUsedIdx] = useState<number | null>(null)
  const [inputFocused, setInputFocused] = useState(false)
  const [playingRecording, setPlayingRecording] = useState(false)
  const [loadingRecording, setLoadingRecording] = useState(false)
  const [playingPreview, setPlayingPreview] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const [playMode, setPlayMode] = useState<'word' | 'sentence'>('word')
  const [annotatorRecordState, setAnnotatorRecordState] = useState<'idle' | 'recording' | 'recorded'>('idle')
  const [annotatorRecordedUrl, setAnnotatorRecordedUrl] = useState<string | null>(null)
  const [playingAnnotatorRec, setPlayingAnnotatorRec] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recordingAudioRef = useRef<HTMLAudioElement | null>(null)
  const annotatorMediaRef = useRef<MediaRecorder | null>(null)
  const annotatorAudioRef = useRef<HTMLAudioElement | null>(null)

  // ── Feature 1: Speed control ──────────────────────────────────────────────
  const [speedRate, setSpeedRate] = useState<0.75 | 1 | 1.25>(1)

  // ── Feature 2: In-context preview — shares playingPreview state via playMode ─

  // ── Feature 3: Comments per word ─────────────────────────────────────────
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')

  // ── Feature 4: Phoneme breakdown ─────────────────────────────────────────
  const [hoveredIpaIdx, setHoveredIpaIdx] = useState<number | null>(null)

  // ── Feature 6: Version history ───────────────────────────────────────────
  const [pronunciationHistory, setPronunciationHistory] = useState<string[]>([])

  const isDone = word.status === 'Updated' || word.status === 'Rejected'

  // ── Feature 5: Diff view — computed from current vs original ─────────────
  const originalRime = word.rime ?? ''
  const currentBare = pronunciation.trim().replace(/^\{|\}$/g, '')
  const hasDiff = currentBare.length > 0 && currentBare !== originalRime && originalRime.length > 0
  const diffTokens = hasDiff ? diffStrings(originalRime, currentBare) : []

  const handleAnnotatorRecord = async () => {
    if (annotatorRecordState === 'recording') {
      annotatorMediaRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      mr.ondataavailable = e => chunks.push(e.data)
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setAnnotatorRecordedUrl(URL.createObjectURL(blob))
        setAnnotatorRecordState('recorded')
      }
      mr.start()
      annotatorMediaRef.current = mr
      setAnnotatorRecordState('recording')
    } catch { /* mic access denied */ }
  }

  const handlePlayAnnotatorRec = () => {
    if (!annotatorRecordedUrl) return
    if (playingAnnotatorRec) { annotatorAudioRef.current?.pause(); setPlayingAnnotatorRec(false); return }
    const audio = new Audio(annotatorRecordedUrl)
    annotatorAudioRef.current = audio
    audio.onended = () => setPlayingAnnotatorRec(false)
    audio.play(); setPlayingAnnotatorRec(true)
  }

  const handlePlayRecording = async () => {
    if (playingRecording) { recordingAudioRef.current?.pause(); setPlayingRecording(false); return }
    setLoadingRecording(true)
    try {
      const url = await fetchWordAudio(word.word, RIME_API_KEY, 'cove')
      const audio = new Audio(url)
      audio.playbackRate = speedRate
      recordingAudioRef.current = audio
      audio.onended = () => setPlayingRecording(false)
      await audio.play(); setPlayingRecording(true)
    } catch { /* fail silently */ }
    finally { setLoadingRecording(false) }
  }

  // Unified play handler — behaviour depends on playMode toggle
  const handlePlay = async () => {
    const bare = pronunciation.trim()
    if (!bare) return
    if (playingPreview) { previewAudioRef.current?.pause(); setPlayingPreview(false); return }
    if (previewAudioRef.current) previewAudioRef.current.pause()
    setLoadingPreview(true)
    try {
      let url: string
      if (playMode === 'sentence') {
        // Embed current pronunciation inside a natural sentence
        const sentence = `Please take your ${bare} as directed. ${bare} should be taken daily.`
        url = await fetchPhoneticAudio(sentence, RIME_API_KEY, 'lagoon')
      } else {
        url = await fetchPhoneticAudio(bare, RIME_API_KEY, 'lagoon')
      }
      const audio = new Audio(url)
      audio.playbackRate = speedRate
      previewAudioRef.current = audio
      audio.onended = () => setPlayingPreview(false)
      await audio.play(); setPlayingPreview(true)
    } catch { /* fail silently */ }
    finally { setLoadingPreview(false) }
  }

  const handlePlaySuggestion = async (idx: number) => {
    if (playingIdx === idx) { audioRef.current?.pause(); setPlayingIdx(null); return }
    if (audioRef.current) { audioRef.current.pause() }
    setLoadingIdx(idx)
    try {
      const url = await fetchWordAudio(word.word, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url)
      audio.playbackRate = speedRate
      audioRef.current = audio
      audio.onended = () => setPlayingIdx(null)
      await audio.play(); setPlayingIdx(idx)
    } catch { /* fail silently */ }
    finally { setLoadingIdx(null) }
  }

  const handleUseSuggestion = (idx: number, rime: string) => {
    // Push current pronunciation to history before switching
    if (pronunciation.trim()) {
      setPronunciationHistory(prev => {
        const next = [pronunciation.trim(), ...prev.filter(p => p !== pronunciation.trim())]
        return next.slice(0, 8) // cap at 8
      })
    }
    setPronunciation(`{${rime}}`)
    setUsedIdx(idx)
  }

  const handleRestoreHistory = (entry: string) => {
    if (pronunciation.trim()) {
      setPronunciationHistory(prev => {
        const next = [pronunciation.trim(), ...prev.filter(p => p !== pronunciation.trim() && p !== entry)]
        return next.slice(0, 8)
      })
    }
    setPronunciation(entry)
  }

  const handleSubmit = () => {
    const bare = pronunciation.trim().replace(/^\{|\}$/g, '')
    if (!bare) return
    onSubmit(word.word, bare)
  }

  // Speed toggle chips
  const speedOptions: Array<0.75 | 1 | 1.25> = [0.75, 1, 1.25]

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        margin: '16px 32px',
        borderRadius: '8px',
        border: `1px solid ${isHighlighted ? 'rgba(139,92,246,0.4)' : 'var(--border-subtle)'}`,
        backgroundColor: isHighlighted ? 'rgba(139,92,246,0.03)' : 'var(--surface-1)',
        overflow: 'hidden',
        transition: 'border-color 0.15s, background-color 0.15s',
        scrollMarginTop: '64px',
      }}
    >
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-emphasis)' }}>{word.word}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>×{word.frequency}</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>{word.account}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Feature 1: Speed control */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '2px', borderRadius: '5px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            {speedOptions.map(s => (
              <button
                key={s}
                onClick={e => { e.stopPropagation(); setSpeedRate(s) }}
                style={{
                  padding: '2px 7px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'background-color 0.1s',
                  backgroundColor: speedRate === s ? 'var(--surface-3)' : 'transparent',
                  color: speedRate === s ? 'var(--text-emphasis)' : 'var(--text-muted)',
                }}
              >{s}×</button>
            ))}
          </div>
          {/* Comment toggle */}
          <button
            onClick={e => { e.stopPropagation(); setShowComment(v => !v) }}
            title="Annotator note"
            style={{
              padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 500,
              border: '1px solid var(--border-subtle)',
              backgroundColor: showComment || comment ? 'rgba(139,92,246,0.08)' : 'transparent',
              color: comment ? '#a78bfa' : 'var(--text-muted)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1h10v7H7l-3 3V8H1V1z"/>
            </svg>
            Note{comment ? ' ·' : ''}
          </button>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{word.date}</span>
          {isDone && (
            <span style={{
              fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px',
              backgroundColor: word.status === 'Updated' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
              color: word.status === 'Updated' ? '#34d399' : '#f87171',
              border: `1px solid ${word.status === 'Updated' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
            }}>{word.status}</span>
          )}
        </div>
      </div>

      {/* Context row — definition + recording + note */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border-subtle)' }}>
          <FieldLabel>Definition</FieldLabel>
          {word.definition ? (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{word.definition}</p>
          ) : (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No definition available.</p>
          )}
        </div>
        <div style={{ flex: 0.5, padding: '12px 20px', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
          <FieldLabel>Recorded by requester</FieldLabel>
          {word.recordingUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
              <button
                onClick={e => { e.stopPropagation(); handlePlayRecording() }}
                style={{
                  width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                  border: '1px solid var(--border-subtle)', backgroundColor: playingRecording ? 'rgba(251,191,36,0.1)' : 'var(--surface-2)',
                  color: playingRecording ? '#fbbf24' : 'var(--text-muted)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {loadingRecording
                  ? <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
                  : playingRecording
                    ? <svg width="7" height="8" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg>
                    : <svg width="6" height="8" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>
                }
              </button>
              <div style={{ flex: 1 }}>
                {/* Waveform visualization placeholder */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1px', height: '20px' }}>
                  {Array.from({ length: 24 }, (_, i) => {
                    const h = Math.max(3, Math.sin(i * 0.5 + 1) * 12 + Math.random() * 6)
                    return <div key={i} style={{ width: '2px', height: `${h}px`, borderRadius: '1px', backgroundColor: playingRecording ? 'rgba(251,191,36,0.5)' : 'var(--text-muted)', opacity: playingRecording ? 0.8 : 0.25 }} />
                  })}
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>Audio clip from requester</span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No recording.</div>
          )}
        </div>
        <div style={{ flex: 0.6, padding: '12px 20px', backgroundColor: word.note ? 'rgba(139,92,246,0.06)' : 'transparent' }}>
          <FieldLabel>Note from requester</FieldLabel>
          {word.note ? (
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{word.note}</p>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No note.</div>
          )}
        </div>
      </div>

      {/* AI Suggested — full width row */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <FieldLabel>AI Suggested Pronunciations</FieldLabel>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {word.suggestions.map((s, idx) => {
            const isPlaying = playingIdx === idx
            const isLoading = loadingIdx === idx
            const isUsed    = usedIdx === idx
            // Feature 4: parse IPA for phoneme breakdown tooltip
            const ipaTokens = parseIpaToTokens(s.ipa)
            return (
              <div
                key={idx}
                style={{
                  flex: '1 1 0', minWidth: '200px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px', borderRadius: '6px',
                  border: `1px solid ${isUsed ? 'rgba(139,92,246,0.4)' : 'var(--border-subtle)'}`,
                  backgroundColor: isUsed ? 'rgba(139,92,246,0.06)' : 'var(--surface-2)',
                  transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                <button
                  onClick={e => { e.stopPropagation(); handlePlaySuggestion(idx) }}
                  style={{
                    width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                    border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-3)',
                    color: isPlaying ? '#fbbf24' : 'var(--text-muted)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {isLoading
                    ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} />
                    : isPlaying
                      ? <svg width="6" height="7" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg>
                      : <svg width="5" height="7" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>
                  }
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Feature 4: IPA with phoneme breakdown tooltip */}
                  <div style={{ fontSize: '10px', fontFamily: 'monospace', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0', marginBottom: '2px' }}>
                    <span
                      style={{ color: '#a78bfa', position: 'relative', cursor: 'help', borderBottom: '1px dotted rgba(167,139,250,0.4)', display: 'inline-flex' }}
                      onMouseEnter={e => { e.stopPropagation(); setHoveredIpaIdx(idx) }}
                      onMouseLeave={() => setHoveredIpaIdx(null)}
                    >
                      /{s.ipa}/
                      {/* Phoneme breakdown tooltip */}
                      {hoveredIpaIdx === idx && ipaTokens.length > 0 && (
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', bottom: 'calc(100% + 6px)', left: '0',
                            backgroundColor: '#1a1a1a', border: '1px solid var(--border-default)',
                            borderRadius: '6px', padding: '8px 10px', zIndex: 50,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.4)', minWidth: '160px', maxWidth: '260px',
                          }}
                        >
                          <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '6px' }}>Phoneme breakdown</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                            {ipaTokens.map((tok, ti) => (
                              <div key={ti} style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                padding: '3px 5px', borderRadius: '3px',
                                backgroundColor: tok.rime === '1' || tok.rime === '2' ? 'rgba(251,191,36,0.08)' : 'var(--surface-2)',
                                border: `1px solid ${tok.rime === '1' || tok.rime === '2' ? 'rgba(251,191,36,0.2)' : 'var(--border-subtle)'}`,
                              }}>
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
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                    {s.explanation}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleUseSuggestion(idx, s.rime) }}
                  disabled={isDone}
                  style={{
                    padding: '4px 10px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                    border: `1px solid ${isUsed ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)'}`,
                    backgroundColor: isUsed ? 'rgba(255,255,255,0.08)' : 'transparent',
                    color: isUsed ? 'var(--text-emphasis)' : 'var(--text-secondary)',
                    cursor: isDone ? 'default' : 'pointer',
                    opacity: isDone ? 0.4 : 1, flexShrink: 0, whiteSpace: 'nowrap',
                  }}
                >
                  {isUsed ? '✓ Used' : 'Use'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Action bar — pronunciation input + submit/reject */}
      <div style={{
        padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '10px',
        backgroundColor: isDone ? 'rgba(52,211,153,0.02)' : 'rgba(45,212,191,0.04)',
        borderTop: '1px solid var(--border-subtle)',
        flexWrap: 'wrap',
      }}>
        {!isDone ? (
          <>
            <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', flexShrink: 0 }}>Pronunciation</span>

            {/* Pronunciation input + W/S mode toggle + play button */}
            <div style={{ flexGrow: 1, flexShrink: 1, minWidth: '120px', position: 'relative' }}>
              <input
                value={pronunciation}
                onChange={e => setPronunciation(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); handleSubmit() } }}
                onClick={e => e.stopPropagation()}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="{r0ImxfOn0xt0Ik}"
                style={{
                  width: '100%', padding: '8px 66px 8px 12px', borderRadius: '5px',
                  border: `1px solid ${inputFocused ? 'rgba(45,212,191,0.5)' : 'var(--border-default)'}`,
                  backgroundColor: 'var(--surface-2)', fontFamily: 'monospace',
                  fontSize: '12px', color: '#2dd4bf', outline: 'none', boxSizing: 'border-box',
                }}
              />
              {/* W / S mode toggle */}
              <div
                style={{
                  position: 'absolute', right: '36px', top: '50%', transform: 'translateY(-50%)',
                  display: 'flex', borderRadius: '3px', overflow: 'hidden',
                  border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-0)',
                }}
              >
                {(['word', 'sentence'] as const).map(mode => (
                  <button
                    key={mode}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setPlayMode(mode) }}
                    title={mode === 'word' ? 'Play word pronunciation' : 'Play word in a sentence'}
                    style={{
                      padding: '3px 6px', fontSize: '9px', fontWeight: 700, letterSpacing: '0.04em',
                      border: 'none', cursor: 'pointer', lineHeight: 1,
                      backgroundColor: playMode === mode ? 'var(--surface-3)' : 'transparent',
                      color: playMode === mode ? 'var(--text-emphasis)' : 'var(--text-muted)',
                      transition: 'background-color 0.1s, color 0.1s',
                    }}
                  >{mode === 'word' ? 'W' : 'S'}</button>
                ))}
              </div>
              {/* Play button */}
              <button
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handlePlay() }}
                disabled={!pronunciation.trim()}
                title={playMode === 'word' ? 'Preview pronunciation' : 'Hear in a sentence'}
                style={{
                  position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                  width: '24px', height: '24px', borderRadius: '50%',
                  border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-3)',
                  color: playingPreview ? '#fbbf24' : playMode === 'sentence' ? '#2dd4bf' : 'var(--text-muted)',
                  cursor: pronunciation.trim() ? 'pointer' : 'default',
                  opacity: pronunciation.trim() ? 1 : 0.3,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {loadingPreview ? (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} />
                ) : playingPreview ? (
                  <svg width="6" height="7" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg>
                ) : (
                  <svg width="5" height="7" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>
                )}
              </button>
            </div>

            {/* Feature 5: Diff indicator — inline pill when there's a change */}
            {hasDiff && (
              <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '2px', marginTop: '-4px' }}>
                <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0 }}>vs original</span>
                <div style={{ fontFamily: 'monospace', fontSize: '10px', display: 'flex', flexWrap: 'wrap', gap: '0' }}>
                  {diffTokens.map((tok, ti) => (
                    <span
                      key={ti}
                      style={{
                        color: tok.type === 'add' ? '#34d399' : tok.type === 'remove' ? '#f87171' : 'var(--text-muted)',
                        textDecoration: tok.type === 'remove' ? 'line-through' : 'none',
                        backgroundColor: tok.type === 'add' ? 'rgba(52,211,153,0.08)' : tok.type === 'remove' ? 'rgba(248,113,113,0.08)' : 'transparent',
                        padding: '0 0.5px',
                      }}
                    >{tok.char}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Feature 6: Version history — inline chips */}
            {pronunciationHistory.length > 0 && (
              <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '2px', marginTop: '-4px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', flexShrink: 0 }}>Tried</span>
                {pronunciationHistory.map((entry, hi) => (
                  <div key={hi} style={{ display: 'flex', alignItems: 'center', gap: '0', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
                    <button
                      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleRestoreHistory(entry) }}
                      title="Restore this pronunciation"
                      style={{
                        padding: '3px 7px', fontSize: '10px', fontFamily: 'monospace',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', lineHeight: 1.4,
                      }}
                    >{entry}</button>
                    <button
                      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setPronunciationHistory(prev => prev.filter((_, i) => i !== hi)) }}
                      title="Discard"
                      style={{
                        padding: '3px 5px 3px 2px', fontSize: '11px', lineHeight: 1,
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', opacity: 0.5,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Record button */}
            <button
              onClick={e => {
                e.stopPropagation()
                if (annotatorRecordState === 'recorded' && !playingAnnotatorRec) handlePlayAnnotatorRec()
                else if (annotatorRecordState === 'recorded' && playingAnnotatorRec) handlePlayAnnotatorRec()
                else handleAnnotatorRecord()
              }}
              title={annotatorRecordState === 'recording' ? 'Stop recording' : annotatorRecordState === 'recorded' ? 'Play recording' : 'Record pronunciation'}
              style={{
                padding: '8px 14px', borderRadius: '5px', fontSize: '12px', fontWeight: 500, flexShrink: 0,
                border: `1px solid ${annotatorRecordState === 'recording' ? 'rgba(248,113,113,0.5)' : 'var(--border-default)'}`,
                backgroundColor: annotatorRecordState === 'recording' ? 'rgba(248,113,113,0.1)' : 'transparent',
                color: annotatorRecordState === 'recording' ? '#f87171' : annotatorRecordState === 'recorded' ? '#34d399' : 'var(--text-secondary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {annotatorRecordState === 'recording' ? (
                <>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1.5"/></svg>
                  Stop
                </>
              ) : annotatorRecordState === 'recorded' ? (
                <>
                  {playingAnnotatorRec
                    ? <svg width="7" height="8" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg>
                    : <svg width="6" height="8" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>
                  }
                  {playingAnnotatorRec ? 'Playing' : 'Play'}
                </>
              ) : (
                <>
                  <svg width="10" height="13" viewBox="0 0 10 14" fill="none">
                    <rect x="2.5" y="0.5" width="5" height="7" rx="2.5" fill="currentColor" opacity="0.8"/>
                    <path d="M0.5 6.5c0 2.5 2 4.5 4.5 4.5s4.5-2 4.5-4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
                    <line x1="5" y1="11" x2="5" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
                  </svg>
                  Record
                </>
              )}
            </button>
            {annotatorRecordState === 'recorded' && (
              <button onClick={e => { e.stopPropagation(); setAnnotatorRecordState('idle'); setAnnotatorRecordedUrl(null) }}
                title="Re-record"
                style={{
                  padding: '8px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 500, flexShrink: 0,
                  border: '1px solid var(--border-default)', backgroundColor: 'transparent',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}>Redo</button>
            )}
            <button onClick={e => { e.stopPropagation(); onReject(word.word) }} style={{
              padding: '8px 18px', borderRadius: '5px', fontSize: '12px', fontWeight: 500,
              border: '1px solid var(--border-default)', backgroundColor: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
            }}>Reject</button>
            <button onClick={e => { e.stopPropagation(); handleSubmit() }} disabled={!pronunciation.trim()} style={{
              padding: '8px 24px', borderRadius: '5px', fontSize: '12px', fontWeight: 600,
              border: 'none', backgroundColor: '#ffffff', color: '#000000',
              cursor: 'pointer', opacity: pronunciation.trim() ? 1 : 0.4, flexShrink: 0,
            }}>Submit →</button>
          </>
        ) : (
          <>
            <div style={{
              padding: '8px 12px', borderRadius: '5px', fontSize: '12px',
              backgroundColor: word.status === 'Updated' ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
              border: `1px solid ${word.status === 'Updated' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
              color: word.status === 'Updated' ? '#34d399' : '#f87171',
            }}>
              {word.status === 'Updated' ? `✓ Submitted: {${word.rime}}` : '✗ Rejected'}
            </div>
            <button
              onClick={e => { e.stopPropagation(); onEdit(word.word) }}
              style={{
                padding: '8px 16px', borderRadius: '5px', fontSize: '12px', fontWeight: 500,
                border: '1px solid var(--border-default)', backgroundColor: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
              }}
            >Edit</button>
          </>
        )}
      </div>

      {/* Feature 3: Annotator comment section */}
      {showComment && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', backgroundColor: 'rgba(139,92,246,0.03)' }}>
          <FieldLabel>Annotator Note</FieldLabel>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder="Leave a note for another annotator — e.g. stress pattern confirmed by client, or flagging ambiguity…"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px', borderRadius: '5px',
              border: '1px solid var(--border-default)',
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text-emphasis)', fontSize: '12px', lineHeight: 1.5,
              resize: 'vertical', outline: 'none', fontFamily: 'inherit',
            }}
            onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'rgba(139,92,246,0.4)' }}
            onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--border-default)' }}
          />
          {comment && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{comment.length} chars</span>
              <button
                onClick={e => { e.stopPropagation(); setComment('') }}
                style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
              >Clear</button>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '8px' }}>
      {children}
    </div>
  )
}
