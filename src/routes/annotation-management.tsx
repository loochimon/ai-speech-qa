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
  annotatorId: string
}
interface Annotator { id: string; name: string; initials: string; color: string }

// ─── mock data ────────────────────────────────────────────────────────────────

const ANNOTATORS: Annotator[] = [
  { id: 'sofia',   name: 'Sofia Chen',    initials: 'SC', color: '#9990CC' },
  { id: 'marcus',  name: 'Marcus Webb',   initials: 'MW', color: '#BA82C0' },
  { id: 'priya',   name: 'Priya Nair',    initials: 'PN', color: '#7FA8CC' },
  { id: 'alex',    name: 'Alex Kim',      initials: 'AK', color: '#4DD4C4' },
  { id: 'jordan',  name: 'Jordan Lee',    initials: 'JL', color: '#7DC87A' },
  { id: 'casey',   name: 'Casey Park',    initials: 'CP', color: '#B8D87A' },
  { id: 'mia',     name: 'Mia Santos',    initials: 'MS', color: '#D4A07A' },
  { id: 'riley',   name: 'Riley Chen',    initials: 'RC', color: '#D480BC' },
]

const ALL_WORDS: ManagedWord[] = [
  { annotatorId: 'sofia',  word: 'Lisinopril',   frequency: 18, ipa: 'lɪˈsɪnəprɪl',      rime: 'l0Is1Inxpr0Il',   date: 'Mar 27', status: 'Updated',   account: 'Pfizer',    project: 'Medication IVR',  category: 'Pharma / Health', note: 'Used in medication reminders. Customer says current pronunciation sounds robotic.', definition: 'An ACE inhibitor medication used to treat high blood pressure and heart failure.',      recordingUrl: 'mock', suggestions: [{ ipa: 'lɪˈsɪnəprɪl',      rime: 'l0Is1Inxpr0Il',   explanation: 'Standard American — most common clinical usage' }, { ipa: 'lɪˈsɪnoʊprɪl', rime: 'l0Is1In0Upr0Il', explanation: 'Full vowel in 3rd syllable — closer to Latin root' }] },
  { annotatorId: 'sofia',  word: 'Semaglutide',  frequency: 5,  ipa: 'sɛˌmæɡluːˈtaɪd',  rime: 's0Em2@glu1tYd',   date: 'Mar 27', status: 'Updated',   account: 'Pfizer',    project: 'Clinical Trials', category: 'Pharma / Health', note: '', definition: 'A GLP-1 receptor agonist used for type 2 diabetes management and weight loss.',               suggestions: [{ ipa: 'sɛˌmæɡluːˈtaɪd',  rime: 's0Em2@glu1tYd',   explanation: 'Standard American — FDA-approved pronunciation' }] },
  { annotatorId: 'sofia',  word: 'Ozempic',      frequency: 8,  ipa: 'oʊˈzɛmpɪk',        rime: 'o1zEmIk',         date: 'Mar 26', status: 'In Review', account: 'Pfizer',    project: 'Patient Portal',  category: 'Brand Names',     note: 'Brand name — stress on second syllable confirmed.', definition: 'Brand name for semaglutide, a weekly injection for type 2 diabetes.',                            recordingUrl: 'mock', suggestions: [{ ipa: 'oʊˈzɛmpɪk',        rime: 'o1zEmIk',         explanation: 'Official brand — stress on 2nd syllable' }] },
  { annotatorId: 'sofia',  word: 'Naranja',      frequency: 23, ipa: 'naˈɾaŋxa',          rime: 'na0r0aGxa',       date: 'Mar 25', status: 'Rejected',  account: 'Chase',     project: 'Customer Support', category: 'Foreign Words',   note: 'Spanish word — used in bilingual IVR.', definition: 'Spanish word for "orange". Used in bilingual customer service scripts.',                             recordingUrl: 'mock', suggestions: [{ ipa: 'naˈɾaŋxa',          rime: 'na0r0aGxa',       explanation: 'Spanish native pronunciation' }] },
  { annotatorId: 'sofia',  word: 'Metformin',    frequency: 7,  ipa: 'ˈmɛtfɔrmɪn',       rime: 'm1Etf0OrmIn',     date: 'Mar 23', status: 'Requested', account: 'CVS',       project: 'Pharmacy Alerts', category: 'Pharma / Health', note: '', definition: 'First-line oral medication for type 2 diabetes.',                                                          suggestions: [{ ipa: 'ˈmɛtfɔrmɪn',       rime: 'm1Etf0OrmIn',     explanation: 'Standard American — MET-for-min' }] },
  { annotatorId: 'marcus', word: 'Tylenol',      frequency: 14, ipa: 'ˈtaɪlənɑl',         rime: 't1Ylxnal',        date: 'Mar 21', status: 'Updated',   account: 'CVS',       project: 'MinuteClinic',    category: 'Brand Names',     note: '', definition: 'Brand name for acetaminophen, an over-the-counter pain reliever and fever reducer.',              suggestions: [{ ipa: 'ˈtaɪlənɑl',         rime: 't1Ylxnal',        explanation: 'Standard — TY-luh-nol' }] },
  { annotatorId: 'marcus', word: 'Omeprazole',   frequency: 11, ipa: 'oʊˈmɛprəzoʊl',     rime: 'o1Em0prxz0ol',    date: 'Mar 20', status: 'Updated',   account: 'Walgreens', project: 'Rx Notifications', category: 'Pharma / Health', note: '', definition: 'A proton pump inhibitor that reduces stomach acid.',                                                      suggestions: [{ ipa: 'oʊˈmɛprəzoʊl',     rime: 'o1Em0prxz0ol',    explanation: 'Standard American — oh-MEP-ruh-zole' }] },
  { annotatorId: 'marcus', word: 'Pfizer',       frequency: 41, ipa: 'ˈfaɪzər',           rime: 'f1Yzxr',          date: 'Mar 19', status: 'In Review', account: 'Pfizer',    project: 'Medication IVR',  category: 'Brand Names',     note: 'Common mispronunciation: "Puh-fizer".', definition: 'American multinational pharmaceutical and biotechnology corporation.',                            recordingUrl: 'mock', suggestions: [{ ipa: 'ˈfaɪzər',           rime: 'f1Yzxr',          explanation: 'Correct — FY-zer ("P" is silent)' }] },
  { annotatorId: 'marcus', word: 'Autodraft',    frequency: 11, ipa: 'ˈɔːtədræft',        rime: '1OtxdrAft',       date: 'Mar 25', status: 'Requested', account: 'Chase',     project: 'Mobile Banking',  category: 'FinTech',         note: '', definition: 'Automatic recurring payment drafting from a bank account.',                                            suggestions: [{ ipa: 'ˈɔːtədræft',        rime: '1OtxdrAft',       explanation: 'Standard American — AW-tuh-draft' }] },
  { annotatorId: 'priya',  word: 'Wegovy',       frequency: 3,  ipa: 'ˈwiːɡoʊvi',         rime: 'w1igoUvi',        date: 'Mar 26', status: 'Updated',   account: 'Pfizer',    project: 'Patient Portal',  category: 'Brand Names',     note: '', definition: 'Brand name for higher-dose semaglutide, FDA-approved for chronic weight management.',          suggestions: [{ ipa: 'ˈwiːɡoʊvi',         rime: 'w1igoUvi',        explanation: 'Standard — WEE-go-vee' }] },
  { annotatorId: 'priya',  word: 'QuickDeposit', frequency: 7,  ipa: 'kwɪkdɪˈpɑzɪt',     rime: 'kw0Ikd0Ip1azIt',  date: 'Mar 24', status: 'Rejected',  account: 'Chase',     project: 'Mobile Banking',  category: 'FinTech',         note: 'Compound word — both syllables should be clear.', definition: 'Chase mobile feature for depositing checks by photographing them.',                              recordingUrl: 'mock', suggestions: [{ ipa: 'kwɪkdɪˈpɑzɪt',     rime: 'kw0Ikd0Ip1azIt',  explanation: 'Compound — equal weight on both parts' }] },
  { annotatorId: 'priya',  word: 'Zoloft',       frequency: 9,  ipa: 'ˈzoʊlɑft',          rime: 'z1olaft',         date: 'Mar 22', status: 'Requested', account: 'CVS',       project: 'Pharmacy Alerts', category: 'Pharma / Health', note: 'Antidepressant brand. Rhymes with "so loft".', definition: 'Brand name for sertraline, an SSRI antidepressant.',                                              suggestions: [{ ipa: 'ˈzoʊlɑft',          rime: 'z1olaft',         explanation: 'Official brand — ZOH-loft' }] },
]

const STATUS_DOT: Record<string, string> = {
  Requested: '#a78bfa', 'In Review': '#fbbf24', Updated: '#34d399', Rejected: '#f87171', Approved: '#2dd4bf',
}

// ─── IPA helpers ──────────────────────────────────────────────────────────────

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
    const m2 = IPA_TOKENS.find(t => t.ipa === two)
    if (m2) { result.push(m2); i += 2; continue }
    const m1 = IPA_TOKENS.find(t => t.ipa === clean[i])
    if (m1) result.push(m1)
    else if (clean[i] !== 'ː' && clean[i] !== ' ') result.push({ ipa: clean[i], rime: '', label: '' })
    i++
  }
  return result
}

function generateContextSentences(word: string): [string, string, string] {
  const cap = word.charAt(0).toUpperCase() + word.slice(1)
  const low = word.toLowerCase()
  return [`${cap} is commonly used in this context.`, `The word ${low} appears in many sentences.`, `Here is an example using ${low}.`]
}

// ─── AnnotationManagementPage ─────────────────────────────────────────────────

function AnnotationManagementPage() {
  const [words, setWords] = useState<ManagedWord[]>(ALL_WORDS)
  const [selectedAnnotatorId, setSelectedAnnotatorId] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [statusFilter, setStatusFilter] = useState('All')
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const rightPanelRef = useRef<HTMLDivElement>(null)

  const filtered = words.filter(w => {
    const matchAnnotator = !selectedAnnotatorId || w.annotatorId === selectedAnnotatorId
    const matchStatus = statusFilter === 'All' || w.status === statusFilter
    return matchAnnotator && matchStatus
  })

  const scrollToWord = useCallback((word: string) => {
    cardRefs.current.get(word)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleApprove = (word: string) =>
    setWords(prev => prev.map(w => w.word === word ? { ...w, status: 'Approved' } : w))
  const handleEdit = (word: string) =>
    setWords(prev => prev.map(w => w.word === word ? { ...w, status: 'In Review' } : w))
  const handleApproveAll = () =>
    setWords(prev => prev.map(w =>
      (!selectedAnnotatorId || w.annotatorId === selectedAnnotatorId) && w.status === 'Updated'
        ? { ...w, status: 'Approved' } : w
    ))

  const approvedCount = words.filter(w => (!selectedAnnotatorId || w.annotatorId === selectedAnnotatorId) && w.status === 'Approved').length
  const hasUnapproved = words.some(w => (!selectedAnnotatorId || w.annotatorId === selectedAnnotatorId) && w.status === 'Updated')

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--surface-0)', overflow: 'hidden' }}>

      {/* ── LEFT PANEL: annotators ── */}
      <div style={{ width: '240px', flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-1)' }}>

        {/* Header */}
        <div style={{ padding: '18px 14px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-emphasis)', marginBottom: '12px' }}>Annotation Management</div>
          {/* Global stats */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { label: 'Total', value: words.length, color: 'var(--text-emphasis)' },
              { label: 'Submitted', value: words.filter(w => w.status === 'Updated' || w.status === 'Approved').length, color: '#34d399' },
              { label: 'Approved', value: words.filter(w => w.status === 'Approved').length, color: '#2dd4bf' },
            ].map(s => (
              <div key={s.label} style={{ flex: 1, padding: '6px 8px', borderRadius: '5px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setSelectedIndex(0) }}
            style={{ width: '100%', fontSize: '11px', padding: '4px 5px', borderRadius: '4px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', outline: 'none' }}>
            <option value="All">All Status</option>
            <option value="Requested">Requested</option>
            <option value="In Review">In Review</option>
            <option value="Updated">Submitted</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        {/* Annotator list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
            Annotators
          </div>
          {/* "All" row */}
          <div
            onClick={() => { setSelectedAnnotatorId(null); setSelectedIndex(0) }}
            style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', backgroundColor: !selectedAnnotatorId ? 'var(--surface-2)' : 'transparent', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--surface-3)', border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
              All
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: !selectedAnnotatorId ? 600 : 400, color: 'var(--text-emphasis)' }}>All Annotators</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{words.length} words</div>
            </div>
          </div>
          {ANNOTATORS.map(ann => {
            const annWords = words.filter(w => w.annotatorId === ann.id)
            const submitted = annWords.filter(w => w.status === 'Updated' || w.status === 'Approved').length
            const approved = annWords.filter(w => w.status === 'Approved').length
            const isSelected = selectedAnnotatorId === ann.id
            return (
              <div
                key={ann.id}
                onClick={() => { setSelectedAnnotatorId(ann.id); setSelectedIndex(0) }}
                style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', backgroundColor: isSelected ? 'var(--surface-2)' : 'transparent', transition: 'background-color 0.1s' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: ann.color + '22', border: '1px solid ' + ann.color + '55', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: 700, color: ann.color, flexShrink: 0, fontFamily: 'monospace' }}>
                    {ann.initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 400, color: 'var(--text-emphasis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ann.name}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{submitted} submitted · {approved} approved</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Word queue in left panel */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ padding: '6px 14px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', position: 'sticky', top: 0, backgroundColor: 'var(--surface-1)', zIndex: 1 }}>
            Words · {filtered.length}
          </div>
          {filtered.length > 0 ? filtered.map((w, i) => {
            const ann = ANNOTATORS.find(a => a.id === w.annotatorId)!
            return (
              <div
                key={w.word}
                onClick={() => { setSelectedIndex(i); scrollToWord(w.word) }}
                style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', backgroundColor: i === selectedIndex ? 'var(--surface-2)' : 'transparent', transition: 'background-color 0.1s', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: ann.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: i === selectedIndex ? 600 : 400, color: 'var(--text-emphasis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.word}</div>
                  <div style={{ fontSize: '10px', color: ann.color, marginTop: '1px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '8px', fontWeight: 700 }}>{ann.initials}</span>
                    <span style={{ color: 'var(--text-muted)' }}>· {w.account}</span>
                  </div>
                </div>
                {w.status === 'Approved'
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}><path d="M2 6l3 3 5-5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>×{w.frequency}</span>
                }
              </div>
            )
          }) : (
            <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No words match</div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: all word cards ── */}
      <div ref={rightPanelRef} style={{ flex: 1, overflowY: 'auto', padding: '0 0 80px' }}>

        {/* Sticky header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--surface-0)', borderBottom: '1px solid var(--border-subtle)', padding: '12px 32px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-emphasis)' }}>
              {filtered.length} words {selectedAnnotatorId ? `· ${ANNOTATORS.find(a => a.id === selectedAnnotatorId)?.name}` : '· All Annotators'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <span style={{ color: '#2dd4bf', fontWeight: 700, fontFamily: 'monospace' }}>{approvedCount}</span>
                {' '}approved
              </span>
              {hasUnapproved && (
                <button onClick={handleApproveAll} style={{ padding: '6px 16px', borderRadius: '5px', fontSize: '12px', fontWeight: 600, border: 'none', backgroundColor: '#ffffff', color: '#000', cursor: 'pointer' }}>
                  Approve All Submitted
                </button>
              )}
            </div>
          </div>
          <div style={{ height: '3px', backgroundColor: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'linear-gradient(90deg, #34d399, #2dd4bf)', transition: 'width 0.4s', width: filtered.length > 0 ? `${(approvedCount / filtered.length) * 100}%` : '0%' }} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '80px 40px', textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>No words match your filters</div>
        ) : (
          filtered.map((w, i) => (
            <ReviewWordCard
              key={`${w.word}-${i}`}
              word={w}
              annotator={ANNOTATORS.find(a => a.id === w.annotatorId)!}
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

// ─── ReviewWordCard ───────────────────────────────────────────────────────────

function ReviewWordCard({ word, annotator, isHighlighted, cardRef, onClick, onApprove, onEdit }: {
  word: ManagedWord; annotator: Annotator
  isHighlighted: boolean
  cardRef: (el: HTMLDivElement | null) => void
  onClick: () => void
  onApprove: (word: string) => void
  onEdit: (word: string) => void
}) {
  const [playingIdx, setPlayingIdx]           = useState<number | null>(null)
  const [loadingIdx, setLoadingIdx]           = useState<number | null>(null)
  const [hoveredIpaIdx, setHoveredIpaIdx]     = useState<number | null>(null)
  const [playingRecording, setPlayingRecording] = useState(false)
  const [loadingRecording, setLoadingRecording] = useState(false)
  const [speedRate, setSpeedRate]             = useState<1 | 0.75 | 0.5 | 0.25>(1)
  const [playingPreview, setPlayingPreview]   = useState(false)
  const [loadingPreview, setLoadingPreview]   = useState(false)
  const [sentencePlaying, setSentencePlaying] = useState<boolean[]>([false, false, false])
  const [sentenceLoading, setSentenceLoading] = useState<boolean[]>([false, false, false])
  const sentenceAudioRefs = useRef<Array<HTMLAudioElement | null>>([null, null, null])
  const audioRef           = useRef<HTMLAudioElement | null>(null)
  const recordingAudioRef  = useRef<HTMLAudioElement | null>(null)
  const previewAudioRef    = useRef<HTMLAudioElement | null>(null)

  const isDone     = word.status === 'Updated' || word.status === 'Rejected' || word.status === 'Approved'
  const isApproved = word.status === 'Approved'
  const speedOptions: Array<1 | 0.75 | 0.5 | 0.25> = [1, 0.75, 0.5, 0.25]
  const [pronunciation, setPronunciation] = useState(word.rime ? `{${word.rime}}` : '')

  const handlePlayRecording = async () => {
    if (playingRecording) { recordingAudioRef.current?.pause(); setPlayingRecording(false); return }
    setLoadingRecording(true)
    try {
      const url = await fetchWordAudio(word.word, RIME_API_KEY, 'cove')
      const audio = new Audio(url); audio.playbackRate = speedRate
      recordingAudioRef.current = audio; audio.onended = () => setPlayingRecording(false)
      await audio.play(); setPlayingRecording(true)
    } catch { /* silent */ } finally { setLoadingRecording(false) }
  }

  const handlePlaySuggestion = async (idx: number) => {
    if (playingIdx === idx) { audioRef.current?.pause(); setPlayingIdx(null); return }
    audioRef.current?.pause(); setLoadingIdx(idx)
    try {
      const url = await fetchWordAudio(word.word, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url); audio.playbackRate = speedRate
      audioRef.current = audio; audio.onended = () => setPlayingIdx(null)
      await audio.play(); setPlayingIdx(idx)
    } catch { /* silent */ } finally { setLoadingIdx(null) }
  }

  const handlePlay = async () => {
    const bare = pronunciation.trim(); if (!bare) return
    if (playingPreview) { previewAudioRef.current?.pause(); setPlayingPreview(false); return }
    previewAudioRef.current?.pause(); setLoadingPreview(true)
    try {
      const url = await fetchPhoneticAudio(bare, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url); audio.playbackRate = speedRate
      previewAudioRef.current = audio; audio.onended = () => setPlayingPreview(false)
      await audio.play(); setPlayingPreview(true)
    } catch { /* silent */ } finally { setLoadingPreview(false) }
  }

  const handlePlaySentence = async (sentIdx: 0 | 1 | 2) => {
    if (sentencePlaying[sentIdx]) { sentenceAudioRefs.current[sentIdx]?.pause(); setSentencePlaying(p => p.map((v, i) => i === sentIdx ? false : v)); return }
    sentenceAudioRefs.current.forEach(a => a?.pause()); setSentencePlaying([false, false, false])
    setSentenceLoading(p => p.map((v, i) => i === sentIdx ? true : v))
    try {
      const sentences = generateContextSentences(word.word)
      const bare = pronunciation.trim().replace(/^\{|\}$/g, '')
      const text = sentences[sentIdx].replace(new RegExp(word.word, 'gi'), `{${bare}}`)
      const url = await fetchPhoneticAudio(text, RIME_API_KEY, 'lagoon')
      const audio = new Audio(url); audio.playbackRate = speedRate
      sentenceAudioRefs.current[sentIdx] = audio
      audio.onended = () => setSentencePlaying(p => p.map((v, i) => i === sentIdx ? false : v))
      await audio.play(); setSentencePlaying(p => p.map((v, i) => i === sentIdx ? true : v))
    } catch { /* silent */ } finally { setSentenceLoading(p => p.map((v, i) => i === sentIdx ? false : v)) }
  }

  return (
    <div
      ref={cardRef} onClick={onClick}
      style={{ margin: '16px 32px', borderRadius: '8px', border: `1px solid ${isHighlighted ? 'rgba(139,92,246,0.4)' : 'var(--border-subtle)'}`, backgroundColor: isHighlighted ? 'rgba(139,92,246,0.03)' : 'var(--surface-1)', overflow: 'hidden', transition: 'border-color 0.15s', scrollMarginTop: '64px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-emphasis)' }}>{word.word}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>×{word.frequency}</span>
          <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>{word.account}</span>
          {/* Annotator badge */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px', backgroundColor: annotator.color + '18', border: '1px solid ' + annotator.color + '44', color: annotator.color }}>
            <span style={{ fontFamily: 'monospace', fontSize: '9px' }}>{annotator.initials}</span>
            {annotator.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: '2px', borderRadius: '5px', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            {speedOptions.map(s => (
              <button key={s} onClick={e => { e.stopPropagation(); setSpeedRate(s) }} style={{ padding: '2px 7px', borderRadius: '3px', fontSize: '10px', fontWeight: 600, border: 'none', cursor: 'pointer', backgroundColor: speedRate === s ? 'var(--surface-3)' : 'transparent', color: speedRate === s ? 'var(--text-emphasis)' : 'var(--text-muted)' }}>{s}×</button>
            ))}
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{word.date}</span>
          {isDone && (
            <span style={{ fontSize: '11px', fontWeight: 500, padding: '2px 8px', borderRadius: '4px', backgroundColor: isApproved ? 'rgba(45,212,191,0.1)' : word.status === 'Updated' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', color: isApproved ? '#2dd4bf' : word.status === 'Updated' ? '#34d399' : '#f87171', border: `1px solid ${isApproved ? 'rgba(45,212,191,0.3)' : word.status === 'Updated' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}` }}>
              {isApproved ? 'Approved' : word.status === 'Updated' ? 'Submitted' : 'Rejected'}
            </span>
          )}
        </div>
      </div>

      {/* Definition + recording + note */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ flex: 1, padding: '12px 20px', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Definition</span>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(word.word)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={`Search "${word.word}" on Google`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '4px', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textDecoration: 'none', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/><path d="M8 1h3v3M11 1L6 6"/></svg>
            </a>
          </div>
          {word.definition ? <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{word.definition}</p> : <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No definition available.</p>}
        </div>
        <div style={{ flex: 0.5, padding: '12px 20px', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '8px' }}>Recorded by annotator</div>
          {word.recordingUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
              <button onClick={e => { e.stopPropagation(); handlePlayRecording() }} style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, backgroundColor: playingRecording ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.06)', border: playingRecording ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.12)', color: playingRecording ? '#fbbf24' : 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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

      {/* AI Suggested */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: '8px' }}>AI Suggested Pronunciations</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {word.suggestions.map((s, idx) => {
            const isPlaying = playingIdx === idx; const isLoading = loadingIdx === idx
            const ipaTokens = parseIpaToTokens(s.ipa)
            return (
              <div key={idx} style={{ flex: '1 1 0', minWidth: '200px', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
                <button onClick={e => { e.stopPropagation(); handlePlaySuggestion(idx) }} style={{ width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0, backgroundColor: isPlaying ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.06)', border: isPlaying ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.12)', color: isPlaying ? '#fbbf24' : 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            {pronunciation && (
              <div style={{ flexGrow: 1, flexShrink: 1, minWidth: '120px', position: 'relative' }}>
                <input value={pronunciation} onChange={e => setPronunciation(e.target.value)} style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: '5px', border: '1px solid var(--border-default)', backgroundColor: 'var(--surface-3)', fontFamily: 'monospace', fontSize: '12px', color: '#2dd4bf', outline: 'none', boxSizing: 'border-box' }} />
                <button onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handlePlay() }} style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%', backgroundColor: playingPreview ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.06)', border: playingPreview ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.12)', color: playingPreview ? '#fbbf24' : 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {loadingPreview ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--text-muted)', display: 'inline-block' }} /> : playingPreview ? <svg width="6" height="7" viewBox="0 0 8 9" fill="currentColor"><rect x="0" y="0" width="2.5" height="9" rx="0.5"/><rect x="5" y="0" width="2.5" height="9" rx="0.5"/></svg> : <svg width="5" height="7" viewBox="0 0 7 9" fill="currentColor"><path d="M0.5 1L6.5 4.5L0.5 8V1Z"/></svg>}
                </button>
              </div>
            )}
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
                      <button onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handlePlaySentence(sentIdx as 0 | 1 | 2) }} style={{ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0, backgroundColor: isPlaying ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.06)', border: isPlaying ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.12)', color: isPlaying ? '#fbbf24' : 'rgba(255,255,255,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
            <div style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
              <div style={{ padding: '8px 12px', borderRadius: '5px', fontSize: '12px', backgroundColor: isApproved ? 'rgba(45,212,191,0.06)' : word.status === 'Updated' ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)', border: `1px solid ${isApproved ? 'rgba(45,212,191,0.2)' : word.status === 'Updated' ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`, color: isApproved ? '#2dd4bf' : word.status === 'Updated' ? '#34d399' : '#f87171' }}>
                {isApproved ? `✓ Approved: {${word.rime}}` : word.status === 'Updated' ? `Submitted: {${word.rime}}` : '✗ Rejected'}
              </div>
              {!isApproved && word.status === 'Updated' && (
                <button onClick={e => { e.stopPropagation(); onApprove(word.word) }} style={{ padding: '8px 20px', borderRadius: '5px', fontSize: '12px', fontWeight: 600, border: 'none', backgroundColor: '#ffffff', color: '#000', cursor: 'pointer', flexShrink: 0 }}>
                  Approve ✓
                </button>
              )}
              <button onClick={e => { e.stopPropagation(); onEdit(word.word) }} style={{ padding: '8px 16px', borderRadius: '5px', fontSize: '12px', fontWeight: 500, border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}>
                {isApproved ? 'Revoke' : 'Send Back'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Waiting for annotator to submit…</div>
        )}
      </div>
    </div>
  )
}
