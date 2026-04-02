import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import type { RequestedWord } from './index'

export const Route = createFileRoute('/shared')({ component: SharedPage })

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  Updated:     { color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
  'In Review': { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  Requested:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
  Rejected:    { color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
}

function SharedPage() {
  const [words, setWords] = useState<RequestedWord[]>([])

  // Poll localStorage every 2s for live updates
  useEffect(() => {
    const load = () => {
      try {
        setWords(JSON.parse(localStorage.getItem('rime_requested_words') ?? '[]'))
      } catch { setWords([]) }
    }
    load()
    const interval = setInterval(load, 2000)
    window.addEventListener('focus', load)
    return () => { clearInterval(interval); window.removeEventListener('focus', load) }
  }, [])

  const counts = {
    total: words.length,
    updated: words.filter(w => w.status === 'Updated').length,
    inReview: words.filter(w => w.status === 'In Review').length,
    requested: words.filter(w => w.status === 'Requested').length,
    rejected: words.filter(w => w.status === 'Rejected').length,
  }

  const pct = counts.total > 0 ? Math.round((counts.updated / counts.total) * 100) : 0

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--surface-0)', color: 'var(--text-emphasis)' }}>

      {/* Header */}
      <div style={{ padding: '32px 40px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          {/* Rime logo mark */}
          <svg width="16" height="12" viewBox="0 0 18 14" fill="none" aria-hidden="true">
            <rect x="0" y="5" width="2" height="4" rx="1" fill="currentColor" opacity="0.3" />
            <rect x="4" y="2.5" width="2" height="9" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="8" y="0" width="2" height="14" rx="1" fill="currentColor" opacity="0.8" />
            <rect x="12" y="2.5" width="2" height="9" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="16" y="5" width="2" height="4" rx="1" fill="currentColor" opacity="0.3" />
          </svg>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Rime Speech QA — Shared View
          </span>
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Requested Words</h1>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Live status of pronunciation requests · auto-refreshes every 2s
        </p>
      </div>

      {/* Progress + Stats */}
      <div style={{ padding: '20px 40px', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1, height: '6px', borderRadius: '3px', backgroundColor: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '3px', backgroundColor: '#34d399',
              transition: 'width 0.5s ease', width: `${pct}%`,
            }} />
          </div>
          <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', color: '#34d399', minWidth: '36px', textAlign: 'right' }}>
            {pct}%
          </span>
        </div>

        {/* Stat pills */}
        <div style={{ display: 'flex', gap: '16px' }}>
          <StatPill label="Total" value={counts.total} color="var(--text-emphasis)" />
          <StatPill label="Updated" value={counts.updated} color="#34d399" />
          <StatPill label="In Review" value={counts.inReview} color="#fbbf24" />
          <StatPill label="Requested" value={counts.requested} color="#a78bfa" />
          <StatPill label="Rejected" value={counts.rejected} color="#f87171" />
        </div>
      </div>

      {/* Word list */}
      <div style={{ padding: '16px 40px 80px' }}>
        {words.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>No words requested yet.</p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', opacity: 0.6 }}>Words will appear here once requested via Check Coverage.</p>
          </div>
        ) : (
          <div style={{ borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 120px 100px 80px',
              padding: '8px 16px', backgroundColor: 'var(--surface-1)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)',
            }}>
              <span>Word</span>
              <span>Frequency</span>
              <span>Pronunciation</span>
              <span>Date</span>
              <span>Status</span>
            </div>

            {words.map((w, i) => {
              const sc = STATUS_COLORS[w.status] ?? { color: 'var(--text-muted)', bg: 'transparent' }
              return (
                <div
                  key={`${w.word}-${i}`}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 80px 120px 100px 80px',
                    padding: '10px 16px', alignItems: 'center',
                    borderBottom: i < words.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    transition: 'background-color 0.2s',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-emphasis)' }}>{w.word}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>×{w.frequency}</span>
                  <span style={{ fontSize: '10px', fontFamily: 'monospace', color: '#2dd4bf' }}>
                    {w.rime ? `{${w.rime}}` : '—'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{w.date}</span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                    backgroundColor: sc.bg, color: sc.color, textAlign: 'center', width: 'fit-content',
                  }}>
                    {w.status}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-emphasis)' }}>{value}</span>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{label}</span>
    </div>
  )
}
