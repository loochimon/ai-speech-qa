import { HeadContent, Scripts, createRootRoute, Link, useRouterState } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'SpeechQA Research — Rime' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon-light.png', media: '(prefers-color-scheme: light)' },
      { rel: 'icon', href: '/favicon-dark.png', media: '(prefers-color-scheme: dark)' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar />
          <main style={{ flex: 1, minWidth: 0 }}>
            {children}
          </main>
        </div>
        <Scripts />
      </body>
    </html>
  )
}

function RimeLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
        <rect x="0" y="5" width="2" height="4" rx="1" fill="white" opacity="0.5" />
        <rect x="4" y="2.5" width="2" height="9" rx="1" fill="white" opacity="0.7" />
        <rect x="8" y="0" width="2" height="14" rx="1" fill="white" />
        <rect x="12" y="2.5" width="2" height="9" rx="1" fill="white" opacity="0.7" />
        <rect x="16" y="5" width="2" height="4" rx="1" fill="white" opacity="0.5" />
      </svg>
      <span style={{ color: 'white', fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>
        rime
      </span>
    </div>
  )
}

// ─── icons (simple SVG) ───────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

function IconWaveform() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="5" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.7" />
      <rect x="4" y="3" width="1.5" height="8" rx="0.75" fill="currentColor" opacity="0.7" />
      <rect x="7" y="1" width="1.5" height="12" rx="0.75" fill="currentColor" />
      <rect x="10" y="3" width="1.5" height="8" rx="0.75" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="1" width="5" height="7" rx="2.5" fill="currentColor" opacity="0.7" />
      <path d="M2 7c0 2.76 2.24 5 5 5s5-2.24 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      <line x1="7" y1="12" x2="7" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  )
}

function IconLibrary() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="3" height="10" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="5.5" y="2" width="3" height="10" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="10" y="2" width="3" height="10" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

function IconShield() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1L2 3.5v4C2 10.5 4.2 12.8 7 13.5c2.8-.7 5-3 5-6v-4L7 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" opacity="0.7" />
    </svg>
  )
}


// ─── sidebar ──────────────────────────────────────────────────────────────────

type NavItem = {
  label: string
  href?: string
  icon?: React.ReactNode
  admin?: boolean
  badge?: boolean
  children?: NavItem[]
  expanded?: boolean
}

function NavLink({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const isActive = item.href ? (item.href === '/' ? currentPath === '/' : currentPath.startsWith(item.href)) : false

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: depth === 0 ? '5px 8px' : '4px 8px 4px 28px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: isActive ? 500 : 400,
    color: isActive ? 'var(--text-emphasis)' : 'var(--text-secondary)',
    backgroundColor: isActive ? 'var(--surface-3)' : 'transparent',
    cursor: 'pointer',
    textDecoration: 'none',
    transition: 'background-color 0.1s, color 0.1s',
    width: '100%',
    border: 'none',
    textAlign: 'left',
  }

  const inner = (
    <>
      {item.icon && (
        <span style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', flexShrink: 0 }}>
          {item.icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.badge && (
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          backgroundColor: '#f87171', flexShrink: 0,
          boxShadow: '0 0 4px rgba(248,113,113,0.5)',
        }} />
      )}
      {item.admin && (
        <span style={{
          fontSize: '9px', fontWeight: 600, letterSpacing: '0.04em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
          border: '1px solid var(--border-default)', borderRadius: '3px', padding: '1px 4px', flexShrink: 0,
        }}>
          admin
        </span>
      )}
    </>
  )

  return (
    <>
      {item.href && item.href !== '#' ? (
        <Link to={item.href as any} style={baseStyle}>{inner}</Link>
      ) : (
        <button style={baseStyle}>{inner}</button>
      )}
      {item.children && item.expanded && (
        <div>
          {item.children.map(child => (
            <NavLink key={child.label} item={child} depth={1} />
          ))}
        </div>
      )}
    </>
  )
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div
        style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          padding: '0 8px',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {items.map(item => (
          <NavLink key={item.label} item={item} />
        ))}
      </div>
    </div>
  )
}

function Sidebar() {
  return (
    <aside
      className="app-sidebar"
      style={{
        width: '200px',
        flexShrink: 0,
        backgroundColor: 'var(--surface-1)',
        borderRight: '1px solid var(--border-subtle)',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        overflow: 'hidden auto',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '16px',
        }}
      >
        <RimeLogo />
      </div>

      <div style={{ padding: '0 8px', flex: 1 }}>
        <NavSection
          label="Platform"
          items={[
            { label: 'Dashboard', icon: <IconDashboard /> },
            { label: 'Generate Audio', icon: <IconWaveform /> },
            { label: 'Talk to Rime', icon: <IconMic /> },
            { label: 'Voice Library', icon: <IconLibrary /> },
            {
              label: 'Speech QA',
              icon: <IconShield />,
              expanded: true,
              children: [
                { label: 'Research', href: '/' },
                { label: 'Monitoring', href: '/my-words' },
                { label: 'Corrections', href: '/corrections', admin: true, badge: true },
              ],
            },
          ]}
        />
      </div>

      {/* User */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              backgroundColor: '#FF9300',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: 700,
              color: '#000',
              flexShrink: 0,
            }}
          >
            R
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-emphasis)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ramona@rime.ai
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Rime.ai</div>
          </div>
        </div>
        <button
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="3" r="1.2" fill="currentColor" />
            <circle cx="7" cy="7" r="1.2" fill="currentColor" />
            <circle cx="7" cy="11" r="1.2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </aside>
  )
}
