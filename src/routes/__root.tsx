import { HeadContent, Scripts, createRootRoute, Outlet } from '@tanstack/react-router'

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
        <nav
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface-1)',
            padding: '0 1.5rem',
            height: '52px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <RimeLogo />
        </nav>
        {children}
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
      <span
        style={{
          color: 'white',
          fontWeight: 600,
          fontSize: '15px',
          letterSpacing: '-0.01em',
        }}
      >
        rime
      </span>
    </div>
  )
}
