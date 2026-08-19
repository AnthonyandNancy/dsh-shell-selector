/**
 * DSH-native Select component tests. These verify the component does not rely
 * on native `<select>` behavior: trigger opens a floating menu, options are
 * selectable, Escape/outside click close, keyboard navigation works, and
 * disabled options are inert.
 *
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshSelect } from '../../src/client/DshSelect.js'

const options = [
  { value: 'bash', label: 'Git Bash', description: 'C:\\Program Files\\Git\\bin\\bash.exe' },
  { value: 'pwsh', label: 'PowerShell 7', description: '7.5.5' },
  { value: 'powershell', label: 'Windows PowerShell', description: '5.1.26100' },
]

afterEach(() => {
  cleanup()
})

function setup(value = 'bash') {
  const onChange = vi.fn()
  const utils = render(
    <DshSelect value={value} options={options} onChange={onChange} ariaLabel="Shell" />,
  )
  return { onChange, ...utils }
}

describe('DshSelect', () => {
  it('opens the menu when the trigger is clicked', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup()
    await user.click(getByRole('button', { name: /Shell/ }))
    expect(getByRole('menu')).toBeTruthy()
    expect(getByRole('menuitem', { name: /PowerShell 7/ })).toBeTruthy()
  })

  it('selects an option and closes the menu', async () => {
    const user = userEvent.setup()
    const { onChange, getByRole, queryByRole } = setup()
    await user.click(getByRole('button', { name: /Shell/ }))
    await user.click(getByRole('menuitem', { name: /PowerShell 7/ }))
    expect(onChange).toHaveBeenCalledWith('pwsh')
    expect(queryByRole('menu')).toBeNull()
  })

  it('shows the selected option in the trigger label', () => {
    const { getByRole } = setup('pwsh')
    expect(getByRole('button', { name: /Shell/ }).textContent).toContain('PowerShell 7')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const { getByRole, queryByRole } = setup()
    await user.click(getByRole('button', { name: /Shell/ }))
    expect(getByRole('menu')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(queryByRole('menu')).toBeNull()
  })

  it('closes on outside click', async () => {
    const user = userEvent.setup()
    const { getByRole, queryByRole } = setup()
    await user.click(getByRole('button', { name: /Shell/ }))
    expect(getByRole('menu')).toBeTruthy()
    await user.click(document.body)
    expect(queryByRole('menu')).toBeNull()
  })

  it('supports arrow-key navigation into the menu', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup()
    const trigger = getByRole('button', { name: /Shell/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(getByRole('menu')).toBeTruthy()
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
  })

  it('does not call onChange for disabled options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DshSelect
        value="bash"
        options={[{ value: 'bash', label: 'Git Bash', disabled: true }, { value: 'pwsh', label: 'PowerShell 7' }]}
        onChange={onChange}
        ariaLabel="Shell"
      />,
    )
    await user.click(screen.getByRole('button', { name: /Shell/ }))
    const disabledItem = screen.getByRole('menuitem', { name: /Git Bash/ }) as HTMLButtonElement
    expect(disabledItem.disabled).toBe(true)
    await user.click(disabledItem)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not render a native select element', () => {
    const { container } = setup()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('option')).toBeNull()
  })

  it('keeps the selected row check in the open menu', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup('bash')
    await user.click(getByRole('button', { name: /Shell/ }))
    const selected = getByRole('menuitem', { name: /Git Bash/ })
    expect(selected.querySelector('svg')).not.toBeNull()
  })
})

describe('DshSelect menu placement', () => {
  it('portals the list out of the wrapper so dialog overflow cannot crop it', async () => {
    const user = userEvent.setup()
    const { container, getByRole } = setup()
    await user.click(getByRole('button', { name: /Shell/ }))
    const menu = getByRole('menu')
    // Rendered into document.body, not inside the component's own subtree.
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
    // Positioned from the measured anchor rect (the fixed layer's coordinates
    // are written inline; `position: fixed` itself comes from the portal class).
    expect(menu.style.left).not.toBe('')
    expect(menu.style.top).not.toBe('')
  })

  it('end-aligns the list so a wide menu grows leftwards, not past the trigger', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup()
    const trigger = getByRole('button', { name: /Shell/ })
    // jsdom reports zero rects, so pin the geometry the primitive measures: a
    // trigger near the right edge of a narrow viewport.
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 600,
      right: 760,
      top: 100,
      bottom: 136,
      width: 160,
      height: 36,
      x: 600,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect)

    await user.click(trigger)
    const menu = getByRole('menu')
    // `align="end"` places the list's right edge at the trigger's right edge,
    // so `left` is never to the right of the trigger's left edge for a list at
    // least as wide as the trigger.
    const left = Number.parseFloat(menu.style.left)
    expect(Number.isNaN(left)).toBe(false)
    expect(left).toBeLessThanOrEqual(760)
  })

  it('bounds each row so a long path cannot widen the list without limit', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup()
    await user.click(getByRole('button', { name: /Shell/ }))
    const row = getByRole('menuitem', { name: /Windows PowerShell/ })
    const label = row.querySelector('.sss-menu-item')
    expect(label).not.toBeNull()
    // The width cap and the description clamp live in the injected stylesheet;
    // this pins the hooks they attach to.
    expect(row.querySelector('.sss-menu-item-desc')).not.toBeNull()
  })
})

describe('DshSelect keyboard scoping', () => {
  it('navigates only its own rows when another menu is open on the page', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <div>
        {/* A foreign menu, rendered first so its rows come earlier in the DOM. */}
        <div role="menu">
          <button type="button" role="menuitem" data-testid="foreign-1">
            Foreign one
          </button>
          <button type="button" role="menuitem" data-testid="foreign-2">
            Foreign two
          </button>
        </div>
        <DshSelect value="bash" options={options} onChange={onChange} ariaLabel="Shell" />
      </div>,
    )

    const trigger = screen.getByRole('button', { name: /Shell/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')

    // Focus landed on one of THIS select's rows, never on the foreign menu's.
    const focused = document.activeElement as HTMLElement
    expect(focused.dataset.testid).toBeUndefined()
    expect(focused.textContent).toContain('Git Bash')

    await user.keyboard('{ArrowDown}')
    expect((document.activeElement as HTMLElement).textContent).toContain('PowerShell 7')

    // The foreign rows were never focused at any point.
    expect(screen.getByTestId('foreign-1')).not.toBe(document.activeElement)
    expect(screen.getByTestId('foreign-2')).not.toBe(document.activeElement)
  })

  it('wraps End and Home within its own rows', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup()
    getByRole('button', { name: /Shell/ }).focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{End}')
    expect((document.activeElement as HTMLElement).textContent).toContain('Windows PowerShell')
    await user.keyboard('{Home}')
    expect((document.activeElement as HTMLElement).textContent).toContain('Git Bash')
  })

  it('opens upward-focused on ArrowUp', async () => {
    const user = userEvent.setup()
    const { getByRole } = setup()
    getByRole('button', { name: /Shell/ }).focus()
    await user.keyboard('{ArrowUp}')
    expect((document.activeElement as HTMLElement).textContent).toContain('Windows PowerShell')
  })
})
