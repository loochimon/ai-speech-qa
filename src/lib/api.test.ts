import { describe, it, expect } from 'vitest'
import { parseWords, fetchOov, fetchWordAudio, generateScript, ipaToRime } from './api'

// Keys are loaded from .env.local via vitest.config.ts
const RIME_KEY = process.env.VITE_RIME_API_KEY ?? ''
const OPENAI_KEY = process.env.VITE_OPENAI_API_KEY ?? ''

// ─── parseWords (pure — no network) ─────────────────────────────────────────

describe('parseWords', () => {
  it('counts word frequencies', () => {
    const freq = parseWords('hello world hello')
    expect(freq.get('hello')).toBe(2)
    expect(freq.get('world')).toBe(1)
  })

  it('is case-insensitive and preserves first-seen capitalisation', () => {
    const freq = parseWords('Pfizer pfizer PFIZER')
    expect(freq.size).toBe(1)
    expect(freq.has('Pfizer')).toBe(true)
    expect(freq.get('Pfizer')).toBe(3)
  })

  it('ignores single characters and non-alphabetic tokens', () => {
    const freq = parseWords('a 42 hello-world')
    expect(freq.has('a')).toBe(false)
    expect(freq.has('42')).toBe(false)
    expect(freq.has('hello')).toBe(true)
    expect(freq.has('world')).toBe(true)
  })

  it('returns an empty map for empty input', () => {
    expect(parseWords('').size).toBe(0)
    expect(parseWords('   ').size).toBe(0)
  })
})

// ─── ipaToRime (pure — no network) ───────────────────────────────────────────

describe('ipaToRime', () => {
  it('converts a simple stressed word correctly', () => {
    // "Pfizer" /ˈfaɪzər/ → f + 1Y(aɪ) + z + 0x(ə) + r
    expect(ipaToRime('ˈfaɪzər')).toBe('f1Yz0xr')
  })

  it('converts a multisyllabic word correctly', () => {
    // "Tylenol" /ˈtaɪlənɑl/ → t + 1Y + l + 0x + n + 0a + l
    expect(ipaToRime('ˈtaɪlənɑl')).toBe('t1Yl0xn0al')
  })

  it('matches docs example: comma = k1am0x', () => {
    // /ˈkɑmə/ → k + 1a + m + 0x
    expect(ipaToRime('ˈkɑmə')).toBe('k1am0x')
  })

  it('handles consonant digraphs', () => {
    // Stress (ˈ) defers to the vowel after the affricate.
    expect(ipaToRime('ˈtʃɛri')).toBe('C1Er0i')  // "cherry"
    expect(ipaToRime('ˈdʒʌmp')).toBe('J1Amp')   // "jump" — no trailing vowels
  })

  it('handles vowel digraphs — unstressed get 0 prefix', () => {
    expect(ipaToRime('eɪ')).toBe('0e')
    expect(ipaToRime('oʊ')).toBe('0o')
    expect(ipaToRime('aɪ')).toBe('0Y')
    expect(ipaToRime('aʊ')).toBe('0W')
    expect(ipaToRime('ɔɪ')).toBe('0O')
  })

  it('strips IPA brackets if present', () => {
    expect(ipaToRime('/ˈfaɪzər/')).toBe('f1Yz0xr')
    expect(ipaToRime('[ˈfaɪzər]')).toBe('f1Yz0xr')
  })

  it('strips length marks', () => {
    expect(ipaToRime('iː')).toBe('0i')
    expect(ipaToRime('uː')).toBe('0u')
  })

  it('maps special consonants (no stress prefix on consonants)', () => {
    expect(ipaToRime('ŋ')).toBe('G')
    expect(ipaToRime('ʃ')).toBe('S')
    expect(ipaToRime('θ')).toBe('T')
    expect(ipaToRime('ð')).toBe('D')
    expect(ipaToRime('ʒ')).toBe('Z')
  })

  it('returns empty string for empty input', () => {
    expect(ipaToRime('')).toBe('')
  })
})

// ─── fetchOov — Rime Coverage API ────────────────────────────────────────────

describe('fetchOov', () => {
  it('returns an array (valid words produce empty list, OOV words are flagged)', async () => {
    const result = await fetchOov(['Pfizer', 'Zoloft', 'hello'], RIME_KEY)
    expect(Array.isArray(result)).toBe(true)
    // Common brand/drug names should be OOV; "hello" should be covered
    expect(result.every(w => typeof w === 'string')).toBe(true)
  })

  it('throws a descriptive error on a bad API key', async () => {
    await expect(fetchOov(['hello'], 'bad-key')).rejects.toThrow('Coverage API error 401')
  })
})

// ─── fetchWordAudio — Rime TTS API ───────────────────────────────────────────

describe('fetchWordAudio', () => {
  it('returns a non-empty blob URL for a known word', async () => {
    // In a Node env, URL.createObjectURL is not available — test the raw response instead
    const res = await fetch('https://users.rime.ai/v1/rime-tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RIME_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mp3',
      },
      body: JSON.stringify({ text: 'Pfizer', speaker: 'lagoon', modelId: 'mistv2' }),
    })
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toMatch(/audio/)
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(0)
  })

  it('throws a descriptive error on a bad API key', async () => {
    await expect(fetchWordAudio('hello', 'bad-key')).rejects.toThrow('TTS API error 401')
  })
})

// ─── generateScript — OpenAI API ─────────────────────────────────────────────

describe('generateScript', () => {
  it('returns a non-empty dialogue string', async () => {
    const script = await generateScript('pharmacy prescription refill', OPENAI_KEY)
    expect(typeof script).toBe('string')
    expect(script.length).toBeGreaterThan(100)
    // Should contain dialogue markers
    expect(script).toMatch(/Agent:|Customer:/i)
  })

  it('throws a descriptive error on a bad API key', async () => {
    await expect(generateScript('test', 'bad-key')).rejects.toThrow('OpenAI API error 401')
  })
})
