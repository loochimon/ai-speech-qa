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

// ─── component ────────────────────────────────────────────────────────────────

function MyWordsPage() {
  const [words, setWords] = useState<RequestedWord[]>([])
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('All Projects')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [updatedExpanded, setUpdatedExpanded] = useState(true)
  const [updatedHeight, setUpdatedHeight] = useState<number | null>(200)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)
  const updatedPanelRef = useRef<HTMLDivElement>(null)

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const currentH = updatedPanelRef.current?.getBoundingClientRect().height ?? 200
    dragStartY.current = e.clientY
    dragStartH.current = currentH
    setUpdatedExpanded(true)

    const onMove = (mv: MouseEvent) => {
      const delta = mv.clientY - dragStartY.current
      const newH = Math.max(48, dragStartH.current + delta)
      setUpdatedHeight(newH)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Load from localStorage on mount and whenever the page becomes visible
  useEffect(() => {
    const refresh = () => setWords(loadWords())
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const filtered = words.filter(w => {
    const matchSearch = !search || w.word.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'All' || w.status === statusFilter
    return matchSearch && matchStatus
  })

  const counts = {
    total: words.length + UPDATED_FILLER.length,
    updated: words.filter(w => w.status === 'Updated').length + UPDATED_FILLER.length,
    inReview: words.filter(w => w.status === 'In Review').length,
    requested: words.filter(w => w.status === 'Requested').length,
    rejected: words.filter(w => w.status === 'Rejected').length,
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--surface-0)', color: 'var(--text-emphasis)' }}>

      {/* ── header ── */}
      <div
        className="flex items-center justify-between px-8 py-6"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h1 className="text-2xl font-bold tracking-tight">My Words</h1>
      </div>

      {/* ── stats bar ── */}
      <div style={{ display: 'flex', gap: '40px', padding: '16px 26px', borderBottom: '0.5px solid #383838', backgroundColor: '#141414' }}>

        {/* Updated */}
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Updated</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
            {counts.updated}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#7C7C7C', marginLeft: '4px' }}>/ {counts.total}</span>
          </div>
        </div>

        {/* In Review */}
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>In Review</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{counts.inReview}</div>
        </div>

        {/* Requested */}
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Requested</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{counts.requested}</div>
        </div>

        {/* Rejected */}
        <div>
          <div style={{ fontSize: '11px', color: '#7C7C7C', marginBottom: '3px' }}>Rejected</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>{counts.rejected}</div>
        </div>

      </div>

      {/* ── filter bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 26px', borderBottom: '0.5px solid #383838' }}>
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
            placeholder="Search"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#FFFFFF', fontSize: '12px' }}
          />
        </div>

        {/* Project filter */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px', fontSize: '12px', color: '#FFFFFF' }}>
            <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Project</span>
            <span style={{ flexShrink: 0 }}>{projectFilter}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
          >
            <option value="All Projects">All Projects</option>
            <option value="Medication IVR">Medication IVR</option>
            <option value="Patient Portal">Patient Portal</option>
            <option value="Clinical Trials">Clinical Trials</option>
            <option value="Mobile Banking">Mobile Banking</option>
            <option value="Customer Support">Customer Support</option>
          </select>
        </div>

        {/* Status filter */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: '#161616', border: '0.5px solid #434343', borderRadius: '5px', fontSize: '12px', color: '#FFFFFF' }}>
            <span style={{ color: '#A5A5A5', flexShrink: 0 }}>Status</span>
            <span style={{ flexShrink: 0 }}>{statusFilter === 'All' ? `All (${words.length})` : statusFilter}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, marginLeft: 'auto' }}><path d="M2 3.5L5 6.5L8 3.5" stroke="#A5A5A5" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
          >
            <option value="All">All ({words.length})</option>
            <option value="Requested">Requested ({counts.requested})</option>
            <option value="In Review">In Review ({counts.inReview})</option>
            <option value="Updated">Updated ({counts.updated})</option>
            <option value="Rejected">Rejected ({counts.rejected})</option>
          </select>
        </div>
      </div>

      {/* ── updated in dictionary section ── */}
      <div className="px-8 pt-6 pb-2">
        {/* Section header — click to expand/collapse */}
        <button
          onClick={() => setUpdatedExpanded(v => !v)}
          className="flex items-center gap-3 mb-3 w-full text-left transition hover:opacity-80"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-emphasis)' }}>Updated in Dictionary</h2>
          <span
            className="text-xs px-2 py-0.5 font-medium"
            style={{ borderRadius: '20px', backgroundColor: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)' }}
          >
            3 words updated since your last visit
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', flexShrink: 0 }}>
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              style={{ transform: updatedExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
            >
              <path d="M2 4.5L6 8L10 4.5" />
            </svg>
          </span>
        </button>

        {updatedExpanded && (
          <div
            ref={updatedPanelRef}
            style={{
              border: '1px solid var(--border-subtle)', borderRadius: '5px',
              overflow: 'hidden auto',
              height: updatedHeight ? `${updatedHeight}px` : 'auto',
              maxHeight: updatedHeight ? undefined : '9999px',
            }}
          >
            {UPDATED_FILLER.map((entry, i) => (
              <UpdatedWordCard key={`updated-${i}`} entry={entry} />
            ))}
          </div>
        )}

        {/* Drag handle — draggable to resize, click to collapse */}
        <div
          className="flex items-center justify-center w-full"
          style={{ marginTop: updatedExpanded ? '8px' : '4px', height: '20px', cursor: 'ns-resize', userSelect: 'none' }}
          onMouseDown={handleDragStart}
          onClick={() => { if (!updatedHeight) setUpdatedExpanded(v => !v) }}
          title={updatedExpanded ? 'Drag to resize · click to collapse' : 'Click to expand'}
        >
          <div
            className="transition-all hover:opacity-100"
            style={{ width: '48px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--surface-3)', opacity: 0.7 }}
          />
        </div>
      </div>

      {/* ── requested words table ── */}
      <div className="px-8 pt-4 pb-6">
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-emphasis)' }}>Words Not in Dictionary</h2>
        {words.length === 0 ? (
          <div
            className="py-20 flex flex-col items-center gap-3"
            style={{ border: '1px solid var(--border-subtle)', borderRadius: '5px' }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
              <rect x="4" y="4" width="24" height="24" rx="4" />
              <line x1="10" y1="12" x2="22" y2="12" />
              <line x1="10" y1="16" x2="18" y2="16" />
              <line x1="10" y1="20" x2="14" y2="20" />
            </svg>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No words requested yet</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Run Check Coverage and click "Request Pronunciation" to add words here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No words match your filters.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '5px', overflow: 'hidden' }}>
            {filtered.map((entry, i) => (
              <RequestedWordCard key={`${entry.word}-${i}`} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── filler data for "Updated in Dictionary" section ─────────────────────────

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

// ─── sub-components ───────────────────────────────────────────────────────────

function StatDivider() {
  return <div style={{ width: '1px', height: '32px', backgroundColor: 'var(--border-subtle)' }} />
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function RequestedWordCard({ entry }: { entry: RequestedWord }) {
  const sc = STATUS_COLORS[entry.status]
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const VDivider = () => (
    <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-default)', flexShrink: 0, margin: '0 4px' }} />
  )

  return (
    <div
      className="flex items-center"
      style={{ borderBottom: '1px solid var(--border-subtle)', padding: '13px 24px', gap: '12px', flexWrap: 'wrap' }}
    >
      {/* group 1: word + freq */}
      <div className="flex items-center" style={{ gap: '6px', minWidth: '120px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-emphasis)' }}>{entry.word}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>×{entry.frequency}</span>
      </div>

      <VDivider />

      {/* group 2: play + Suggested pill */}
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
            border: '1px solid rgba(139,92,246,0.4)',
            backgroundColor: 'rgba(139,92,246,0.08)',
            color: '#a78bfa', fontSize: '12px', fontWeight: 500, flexShrink: 0,
          }}
        >
          <svg width="6" height="8" viewBox="0 0 7 9" fill="currentColor">
            <path d="M0.5 1L6.5 4.5L0.5 8V1Z" />
          </svg>
          Suggested
        </div>
      </div>

      <VDivider />

      {/* group 3: IPA + Rime */}
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

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* date */}
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{entry.date}</span>

      <VDivider />

      {/* status pill */}
      <span
        style={{
          fontSize: '11px', fontWeight: 500,
          padding: '3px 10px', borderRadius: '5px',
          backgroundColor: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
          flexShrink: 0,
        }}
      >
        {entry.status}
      </span>

      <VDivider />

      {/* note button + inline popover */}
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
          <div
            style={{
              position: 'absolute', right: 0, top: '36px', zIndex: 50,
              width: '280px', borderRadius: '8px',
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '10px',
            }}
          >
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add context or priority notes…"
              autoFocus
              rows={3}
              style={{
                width: '100%', resize: 'none', outline: 'none',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '5px', padding: '8px 10px',
                fontSize: '12px', color: 'var(--text-emphasis)',
                lineHeight: 1.5,
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNoteOpen(false)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px',
                  fontWeight: 500, cursor: 'pointer',
                  border: '1px solid var(--border-default)',
                  backgroundColor: 'transparent', color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setNoteOpen(false)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer',
                  border: 'none', backgroundColor: '#ffffff', color: '#000000',
                }}
              >
                Re-request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── UpdatedWordCard — matches OOV card layout with green "Updated" pill ──────

function UpdatedWordCard({ entry }: { entry: RequestedWord }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const VDivider = () => (
    <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-default)', flexShrink: 0, margin: '0 4px' }} />
  )

  return (
    <div
      className="flex items-center"
      style={{ borderBottom: '1px solid var(--border-subtle)', padding: '13px 24px', gap: '12px', flexWrap: 'wrap' }}
    >
      {/* group 1: word + freq */}
      <div className="flex items-center" style={{ gap: '6px', minWidth: '120px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-emphasis)' }}>{entry.word}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>×{entry.frequency}</span>
      </div>

      <VDivider />

      {/* group 2: play + Updated pill */}
      <div className="flex items-center" style={{ gap: '8px' }}>
        {/* Play button */}
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

        {/* Updated pill */}
        <div
          className="flex items-center"
          style={{
            gap: '6px', padding: '4px 14px', borderRadius: '999px',
            border: '1px solid rgba(52,211,153,0.4)',
            backgroundColor: 'rgba(52,211,153,0.08)',
            color: '#34d399', fontSize: '12px', fontWeight: 500, flexShrink: 0,
          }}
        >
          <svg width="6" height="8" viewBox="0 0 7 9" fill="currentColor">
            <path d="M0.5 1L6.5 4.5L0.5 8V1Z" />
          </svg>
          Updated
        </div>
      </div>

      <VDivider />

      {/* group 3: IPA + Rime */}
      <div className="flex items-center" style={{ gap: '5px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>IPA</span>
        <span className="font-mono" style={{ fontSize: '12px', color: entry.ipa ? '#a78bfa' : 'var(--text-muted)' }}>
          {entry.ipa ? `/${entry.ipa}/` : '/—/'}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>·</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '2px' }}>Rime</span>
        <span
          className="font-mono"
          style={{ fontSize: '12px', color: entry.rime ? '#2dd4bf' : 'var(--text-muted)', marginLeft: '2px' }}
        >
          {entry.rime ? `{${entry.rime}}` : '{—}'}
        </span>
      </div>

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* date */}
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{entry.date}</span>

      <VDivider />

      {/* status pill */}
      <span
        style={{
          fontSize: '11px', fontWeight: 500,
          padding: '3px 10px', borderRadius: '5px',
          backgroundColor: 'rgba(52,211,153,0.1)',
          color: '#34d399',
          border: '1px solid rgba(52,211,153,0.3)',
          flexShrink: 0,
        }}
      >
        Updated
      </span>

      <VDivider />

      {/* note button + inline popover */}
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
          <div
            style={{
              position: 'absolute', right: 0, top: '36px', zIndex: 50,
              width: '280px', borderRadius: '8px',
              backgroundColor: 'var(--surface-1)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              padding: '12px',
              display: 'flex', flexDirection: 'column', gap: '10px',
            }}
          >
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add context or priority notes…"
              autoFocus
              rows={3}
              style={{
                width: '100%', resize: 'none', outline: 'none',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '5px', padding: '8px 10px',
                fontSize: '12px', color: 'var(--text-emphasis)',
                lineHeight: 1.5,
              }}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNoteOpen(false)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px',
                  fontWeight: 500, cursor: 'pointer',
                  border: '1px solid var(--border-default)',
                  backgroundColor: 'transparent', color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => setNoteOpen(false)}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: '5px', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer',
                  border: 'none', backgroundColor: '#ffffff', color: '#000000',
                }}
              >
                Re-request
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
