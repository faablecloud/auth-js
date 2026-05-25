import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_DIR = new URL('../../src', import.meta.url).pathname
const BANNED = /supabase|gotrue/i

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path, out)
    } else if (path.endsWith('.ts')) {
      out.push(path)
    }
  }
  return out
}

describe('source code', () => {
  it('contains no references to upstream supabase/gotrue branding', () => {
    const offenders: { file: string; line: number; text: string }[] = []
    for (const file of walk(SRC_DIR)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, idx) => {
        if (BANNED.test(line)) {
          offenders.push({ file, line: idx + 1, text: line.trim() })
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
