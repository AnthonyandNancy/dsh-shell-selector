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
