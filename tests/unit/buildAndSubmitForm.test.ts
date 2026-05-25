import { describe, expect, it, vi } from 'vitest'
import { buildAndSubmitForm } from '../../src/lib/auth_helpers'

const mockDocument = () => {
  const submit = vi.fn()
  const form = { submit } as unknown as HTMLFormElement
  const div: { innerHTML: string; children: HTMLFormElement[] } = {
    innerHTML: '',
    children: [form]
  }
  const doc = {
    createElement: vi.fn(() => div),
    body: { appendChild: vi.fn((node: typeof div) => node) }
  } as unknown as Document
  return { doc, div, form, submit }
}

describe('buildAndSubmitForm', () => {
  it('renders the HTML inside a container and submits the embedded form', () => {
    const { doc, div, form, submit } = mockDocument()

    buildAndSubmitForm('<form><input/></form>', doc)

    expect(doc.createElement).toHaveBeenCalledWith('div')
    expect(div.innerHTML).toBe('<form><input/></form>')
    expect(doc.body.appendChild).toHaveBeenCalledWith(div)
    expect(submit).toHaveBeenCalledOnce()
    expect(form).toBe(div.children[0])
  })

  it('throws if the rendered HTML has no child element', () => {
    const { doc, div } = mockDocument()
    div.children = [] as unknown as HTMLFormElement[]

    expect(() => buildAndSubmitForm('', doc)).toThrow()
  })
})
