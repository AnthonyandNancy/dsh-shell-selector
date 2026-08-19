/**
 * DSH-native Select.
 *
 * A lightweight wrapper around the official `Menu` primitive and `Button`
 * primitive. It deliberately does not use a native HTML `<select>`: the
 * trigger is a DSH-styled button and the dropdown is the DSH floating menu
 * with rounded corners, soft shadow, hover tokens, selected check, outside
 * click, Escape, and keyboard navigation.
 *
 * @module dsh-shell-selector/client/dsh-select
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

export interface DshSelectOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface DshSelectProps<T extends string> {
  value: T
  options: readonly DshSelectOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

export function DshSelect<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className,
}: DshSelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const focusItem = (index: number): void => {
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    const target = items[index]
    if (target !== undefined) target.focus()
  }

  const navigateMenu = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
    if (items.length === 0) return
    const current = items.findIndex((element) => element === document.activeElement)
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else next = current <= 0 ? items.length - 1 : current - 1
    focusItem(next)
  }

  useEffect(() => {
    if (!open) return
    const onDocumentKeyDown = (event: KeyboardEvent): void => navigateMenu(event)
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [open, options.length])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen(true)
      setTimeout(() => {
        const index = event.key === 'ArrowUp' ? options.length - 1 : 0
        focusItem(index)
      }, 0)
    }
  }

  const items = options.map((option) => ({
    id: option.value,
    label: (
      <span className="sss-menu-item">
        <span className="sss-menu-item-label">{option.label}</span>
        {option.description === undefined ? null : <span className="sss-menu-item-desc">{option.description}</span>}
      </span>
    ),
    ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
  }))

  const selected = options.find((option) => option.value === value)

  const anchor = (
    <Button
      type="button"
      variant="outline"
      size="md"
      className="sss-select-trigger"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      onClick={() => setOpen((current) => !current)}
    >
      <span className="sss-select-trigger-label">{selected?.label ?? value}</span>
      <IconChevronDownOutline14 className="sss-select-chevron" />
    </Button>
  )

  return (
    <div ref={rootRef} className={`sss-select${className === undefined ? '' : ` ${className}`}`} onKeyDown={handleKeyDown}>
      <Menu
        open={open}
        anchor={anchor}
        items={items}
        selectedId={value}
        onSelect={(id) => {
          onChange(id as T)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
