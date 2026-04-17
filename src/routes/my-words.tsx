import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import type { RequestedWord } from './index'

export const Route = createFileRoute('/my-words')({ component: MyWordsPage })

// ─── types ────────────────────────────────────────────────────────────────────

type WordStatus = RequestedWord['status']

const STATUS_COLORS: Record<WordStatus, { color: string; bg: string; border: string }> = {
  Updated:     { color: '#34d399', bg: 'rgba(52,211,153,0.1)',   border: 'rgba(52,211,153,0.3)' },
  'In Review': { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)' },
  Requested:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)' },
  Rejected:    { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)' },
}

function loadWords(): RequestedWord[] {
  try {
    return JSON.parse(localStorage.getItem('rime_requested_words') ?? '[]')
  } catch {
    return []
  }
}

// ─── draggable section hook ───────────────────────────────────────────────────

function useDraggableSection(defaultHeight = 220, defaultExpanded = true) {
  const [height, setHeight] = useState(defaultHeight)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef({ y: 0, h: 0 })

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const currentH = panelRef.current?.getBoundingClientRect().height ?? defaultHeight
    dragStart.current = { y: e.clientY, h: currentH }
    if (!expanded) setExpanded(true)

    const onMove = (mv: MouseEvent) => {
      const delta = mv.clientY - dragStart.current.y
      setHeight(Math.max(48, dragStart.current.h + delta))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return { height, expanded, setExpanded, panelRef, onDragStart }
}

function DragHandle({ onDragStart, expanded, onToggle }: {
  onDragStart: (e: React.MouseEvent) => void
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '16px', cursor: 'ns-resize', userSelect: 'none' }}
      onMouseDown={onDragStart}
      onClick={() => { onToggle() }}
      title={expanded ? 'Drag to resize · click to collapse' : 'Click to expand'}
    >
      <div style={{ width: '40px', height: '3px', borderRadius: '2px', backgroundColor: '#2A2A2A' }} />
    </div>
  )
}

// ─── section header ───────────────────────────────────────────────────────────

function SectionHeader({
  label, count, collapsed, onToggle, accent,
}: {
  label: string
  count: number
  collapsed?: boolean
  onToggle?: () => void
  accent?: string
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 32px',
        borderTop: '0.5px solid #2A2A2A', borderBottom: '0.5px solid #2A2A2A',
        backgroundColor: '#111111',
        cursor: onToggle ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: accent ?? '#CFCFCF' }}>{label}</span>
        <span style={{
          fontSize: '10px', padding: '1px 6px', borderRadius: '3px',
          backgroundColor: 'rgba(255,255,255,0.05)', color: '#5C5C5C',
        }}>{count}</span>
      </div>
      {onToggle && (
        <svg
          width="11" height="11" viewBox="0 0 11 11" fill="none"
          stroke="#5C5C5C" strokeWidth="1.4" strokeLinecap="round"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
        >
          <path d="M2 4L5.5 7.5L9 4" />
        </svg>
      )}
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────

function MyWordsPage() {
  const [words, setWords] = useState<RequestedWord[]>([])
  const [search, setSearch] = useState('')

  const updated  = useDraggableSection(220, true)
  const pending  = useDraggableSection(220, true)
  const rejected = useDraggableSection(180, false)

  useEffect(() => {
    const refresh = () => setWords(loadWords())
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const allWords = [...UPDATED_FILLER, ...words, ...REJECTED_FILLER]

  const filtered = (list: RequestedWord[]) =>
    list.filter(w => !search || w.word.toLowerCase().includes(search.toLowerCase()))

  const updatedWords  = filtered([...UPDATED_FILLER, ...words.filter(w => w.status === 'Updated')])
  const pendingWords  = filtered(words.filter(w => w.status === 'In Review' || w.status === 'Requested'))
  const rejectedWords = filtered(REJECTED_FILLER)

  const counts = {
    total:    allWords.length,
    updated:  updatedWords.length,
    inReview: words.filter(w => w.status === 'In Review').length,
    requested: words.filter(w => w.status === 'Requested').length,
    rejected: rejectedWords.length,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--surface-0)', color: 'var(--text-emphasis)' }}>

      {/* ── header ── */}
      <div
        className="flex items-center justify-between px-8 py-6"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h1 className="text-2xl font-bold tracking-tight">Review Corrections</h1>
      </div>

      {/* ── stats bar ── */}
      <div style={{ display: 'flex', gap: '40px', padding: '16px 32px', borderBottom: '0.5px solid #383838', backgroundColor: '#141414' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Updated</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
            {counts.updated}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#7C7C7C', marginLeft: '4px' }}>/ {counts.total}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>In Review</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{counts.inReview}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Requested</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{counts.requested}</div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Rejected</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{counts.rejected}</div>
        </div>
      </div>

      {/* ── filter bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 32px', borderBottom: '0.5px solid #383838' }}>
        {/* Search */}
        <div style={{ width: '200px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
            <circle cx="6" cy="6" r="4.5" stroke="#A5A5A5" strokeWidth="1.2" />
            <path d="M9.5 9.5L12.5 12.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search words…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#FFFFFF', fontSize: '12px', fontFamily: 'Inter, sans-serif' }}
          />
        </div>
        {/* Voice */}
        <div style={{ width: '140px', flexShrink: 0 }}>
          <div style={{ padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px', fontSize: '12px', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Voice</span>
            <span>All</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
        {/* Status */}
        <div style={{ width: '140px', flexShrink: 0 }}>
          <div style={{ padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px', fontSize: '12px', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Status</span>
            <span>All</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
        {/* Time */}
        <div style={{ width: '130px', flexShrink: 0 }}>
          <div style={{ padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px', fontSize: '12px', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Time</span>
            <span>All Time</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      </div>

      {/* ── section 1: Updated in Dictionary ── */}
      <SectionHeader
        label="Words Updated in Dictionary" count={updatedWords.length} accent="#34d399"
        collapsed={!updated.expanded} onToggle={() => updated.setExpanded(v => !v)}
      />
      {updated.expanded && (
        <>
          <div ref={updated.panelRef} style={{ overflowY: 'auto', height: `${updated.height}px` }}>
            {updatedWords.length === 0
              ? <EmptyState message="No words updated yet." />
              : updatedWords.map((entry, i) => <WordCard key={`updated-${i}`} entry={entry} />)
            }
          </div>
          <DragHandle onDragStart={updated.onDragStart} expanded={updated.expanded} onToggle={() => updated.setExpanded(v => !v)} />
        </>
      )}

      {/* ── section 2: Not Yet in Dictionary ── */}
      <SectionHeader
        label="Words Not Yet in Dictionary" count={pendingWords.length}
        collapsed={!pending.expanded} onToggle={() => pending.setExpanded(v => !v)}
      />
      {pending.expanded && (
        <>
          <div ref={pending.panelRef} style={{ overflowY: 'auto', height: `${pending.height}px` }}>
            {pendingWords.length === 0
              ? <EmptyState message='No pending words. Run Check Pronunciation and click "Correct All Words" to add words here.' />
              : pendingWords.map((entry, i) => <WordCard key={`pending-${i}`} entry={entry} />)
            }
          </div>
          <DragHandle onDragStart={pending.onDragStart} expanded={pending.expanded} onToggle={() => pending.setExpanded(v => !v)} />
        </>
      )}

      {/* ── section 3: Rejected by Rime (collapsed by default) ── */}
      <SectionHeader
        label="Rejected by Rime" count={rejectedWords.length} accent="#f87171"
        collapsed={!rejected.expanded} onToggle={() => rejected.setExpanded(v => !v)}
      />
      {rejected.expanded && (
        <>
          <div ref={rejected.panelRef} style={{ overflowY: 'auto', height: `${rejected.height}px` }}>
            {rejectedWords.length === 0
              ? <EmptyState message="No rejected words." />
              : rejectedWords.map((entry, i) => <WordCard key={`rejected-${i}`} entry={entry} />)
            }
          </div>
          <DragHandle onDragStart={rejected.onDragStart} expanded={rejected.expanded} onToggle={() => rejected.setExpanded(v => !v)} />
        </>
      )}

    </div>
  )
}

// ─── shared empty state ───────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '32px', textAlign: 'center' }}>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{message}</p>
    </div>
  )
}

// ─── unified word card ────────────────────────────────────────────────────────

function WordCard({ entry }: { entry: RequestedWord }) {
  const sc = STATUS_COLORS[entry.status]
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const VDivider = () => (
    <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-default)', flexShrink: 0, margin: '0 4px' }} />
  )

  const pillColor = entry.status === 'Updated'
    ? { border: 'rgba(52,211,153,0.4)', bg: 'rgba(52,211,153,0.08)', color: '#34d399' }
    : entry.status === 'Rejected'
    ? { border: 'rgba(248,113,113,0.4)', bg: 'rgba(248,113,113,0.08)', color: '#f87171' }
    : { border: 'rgba(139,92,246,0.4)', bg: 'rgba(139,92,246,0.08)', color: '#a78bfa' }

  return (
    <div
      className="flex items-center"
      style={{ borderBottom: '0.5px solid var(--border-subtle)', padding: '13px 32px', gap: '12px', flexWrap: 'wrap' }}
    >
      {/* word + freq */}
      <div className="flex items-center" style={{ gap: '6px', minWidth: '120px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-emphasis)' }}>{entry.word}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>×{entry.frequency}</span>
      </div>

      <VDivider />

      {/* play + status pill */}
      <div className="flex items-center" style={{ gap: '8px' }}>
        <button
          className="flex items-center justify-center transition hover:opacity-80"
          style={{
            width: '26px', height: '26px', borderRadius: '50%',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-2)',
            color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <svg width="7" height="8" viewBox="0 0 7 9" fill="currentColor">
            <path d="M0.5 1L6.5 4.5L0.5 8V1Z" />
          </svg>
        </button>

        <div
          className="flex items-center"
          style={{
            gap: '6px', padding: '4px 14px', borderRadius: '999px',
            border: `1px solid ${pillColor.border}`,
            backgroundColor: pillColor.bg,
            color: pillColor.color, fontSize: '12px', fontWeight: 500, flexShrink: 0,
          }}
        >
          <svg width="6" height="8" viewBox="0 0 7 9" fill="currentColor">
            <path d="M0.5 1L6.5 4.5L0.5 8V1Z" />
          </svg>
          {entry.status === 'Updated' ? 'Updated' : entry.status === 'Rejected' ? 'Rejected' : 'Suggested'}
        </div>
      </div>

      <VDivider />

      {/* IPA + Rime */}
      <div className="flex items-center" style={{ gap: '5px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>IPA</span>
        <span className="font-mono" style={{ fontSize: '12px', color: entry.ipa ? '#a78bfa' : 'var(--text-muted)' }}>
          {entry.ipa ? `/${entry.ipa}/` : '/—/'}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>·</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '2px' }}>Rime</span>
        <span className="font-mono" style={{ fontSize: '12px', color: entry.rime ? '#2dd4bf' : 'var(--text-muted)', marginLeft: '2px' }}>
          {entry.rime ? `{${entry.rime}}` : '{—}'}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* date */}
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{entry.date}</span>

      <VDivider />

      {/* status badge */}
      <span style={{
        fontSize: '11px', fontWeight: 500, padding: '3px 10px', borderRadius: '5px',
        backgroundColor: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, flexShrink: 0,
      }}>
        {entry.status}
      </span>

      <VDivider />

      {/* note button */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setNoteOpen(v => !v)}
          title="Add note"
          className="flex items-center justify-center transition hover:opacity-80"
          style={{
            width: '28px', height: '28px', borderRadius: '5px',
            border: `1px solid ${noteOpen || note ? 'rgba(139,92,246,0.4)' : 'var(--border-subtle)'}`,
            backgroundColor: noteOpen ? 'rgba(139,92,246,0.08)' : 'transparent',
            color: noteOpen || note ? '#a78bfa' : 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <svg width="12" height="13" viewBox="0 0 12 13" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="10" height="11" rx="1.5" />
            <line x1="8.5" y1="9" x2="11" y2="11.5" />
          </svg>
        </button>
        {noteOpen && (
          <div style={{
            position: 'absolute', right: 0, top: '36px', zIndex: 50,
            width: '280px', borderRadius: '8px',
            backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-default)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: '12px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add context or priority notes…"
              autoFocus
              rows={3}
              style={{
                width: '100%', resize: 'none', outline: 'none',
                backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                borderRadius: '5px', padding: '8px 10px',
                fontSize: '12px', color: 'var(--text-emphasis)', lineHeight: 1.5,
              }}
            />
            <div className="flex items-center gap-2">
              <button onClick={() => setNoteOpen(false)} style={{ flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px', fontWeight: 500, cursor: 'pointer', border: '1px solid var(--border-default)', backgroundColor: 'transparent', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={() => setNoteOpen(false)} style={{ flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none', backgroundColor: '#ffffff', color: '#000000' }}>Save</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── filler data ──────────────────────────────────────────────────────────────

const UPDATED_FILLER: RequestedWord[] = [
  { word: 'Lisinopril',  frequency: 18, ipa: 'lɪˈsɪnəprɪl',    rime: 'l0Is1Inxpr0Il',  date: 'Mar 27', status: 'Updated' },
  { word: 'Pfizer',      frequency: 41, ipa: 'ˈfaɪzər',         rime: 'f1Yzxr',          date: 'Mar 27', status: 'Updated' },
  { word: 'Zoloft',      frequency: 9,  ipa: 'ˈzoʊlɑft',        rime: 'z1olaft',         date: 'Mar 25', status: 'Updated' },
  { word: 'Metformin',   frequency: 7,  ipa: 'ˈmɛtfɔrmɪn',     rime: 'm1Etf0OrmIn',     date: 'Mar 24', status: 'Updated' },
  { word: 'Naranja',     frequency: 23, ipa: 'naˈɾaŋxa',        rime: 'na0r0aGxa',       date: 'Mar 22', status: 'Updated' },
  { word: 'Tylenol',     frequency: 14, ipa: 'ˈtaɪlənɑl',       rime: 't1Ylxnal',        date: 'Mar 20', status: 'Updated' },
  { word: 'Semaglutide', frequency: 5,  ipa: 'sɛˌmæɡluːˈtaɪd', rime: 's0Em2@glu1tYd',   date: 'Mar 18', status: 'Updated' },
  { word: 'Omeprazole',  frequency: 11, ipa: 'oʊˈmɛprəzoʊl',   rime: 'o1Em0prxz0ol',    date: 'Mar 16', status: 'Updated' },
  { word: 'Wegovy',      frequency: 3,  ipa: 'ˈwiːɡoʊvi',       rime: 'w1igoUvi',        date: 'Mar 15', status: 'Updated' },
  { word: 'Ozempic',     frequency: 8,  ipa: 'oʊˈzɛmpɪk',       rime: 'o1zEmIk',         date: 'Mar 12', status: 'Updated' },
]

const REJECTED_FILLER: RequestedWord[] = [
  { word: 'Ssdlfkj',    frequency: 2,  ipa: '', rime: '', date: 'Apr 10', status: 'Rejected' },
  { word: 'Asdfjklqwe', frequency: 1,  ipa: '', rime: '', date: 'Apr 8',  status: 'Rejected' },
  { word: 'Zxcvbnmq',   frequency: 3,  ipa: '', rime: '', date: 'Apr 5',  status: 'Rejected' },
]
