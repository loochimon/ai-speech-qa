import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const [loading, setLoading] = useState(false)

  async function speak() {
    setLoading(true)
    try {
      const res = await fetch('https://users.rime.ai/v1/rime-tts', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer REDACTED_RIME_API_KEY',
          'Content-Type': 'application/json',
          Accept: 'audio/mp3',
        },
        body: JSON.stringify({ text: 'Hello World', speaker: 'lagoon', modelId: 'mistv2' }),
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold">Hello World</h1>
      <button
        onClick={speak}
        disabled={loading}
        className="rounded-full bg-black px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? 'Loading...' : '🔊 Read Aloud'}
      </button>
    </main>
  )
}
