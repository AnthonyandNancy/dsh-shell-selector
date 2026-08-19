/**
 * DSH-native Select.
 *
 * A lightweight wrapper around the official `Menu` and `Button` primitives. It
 * deliberately does not use a native HTML `<select>`: the trigger is a
 * DSH-styled button and the dropdown is the DSH floating menu with rounded
 * corners, soft shadow, hover tokens, selected check, outside click, Escape and
 * keyboard navigation.
 *
 * Two positioning details matter for a control that sits on the RIGHT of a
 * Settings row:
 *
 *  - `portal` renders the list into `document.body` as a fixed-position layer,
 *    so an ancestor's `overflow` cannot crop it and it is clamped to the
 *    viewport (rc.6 keeps a 12px margin on every edge);
 *  - `align="end"` pins the list's RIGHT edge to the trigger's right edge, so a
 *    list wider than its trigger grows leftwards, into the dialog, instead of
 *    escaping past its right edge.
 *
 * @module dsh-shell-selector/client/dsh-select
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
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
  // Identifies THIS select's rows. `portal` renders the list into
  // `document.body`, so it is outside `rootRef` and cannot be found by walking
  // the wrapper — each row is tagged through the label node instead, which is
  // the part of the row this component owns.
  const menuId = `sss-menu-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`

  /** The enabled rows of this select's own menu, in DOM order. */
  const ownItems = useCallback((): HTMLButtonElement[] => {
    const marks = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-shell-selector-item="${menuId}"]`),
    )
    const rows: HTMLButtonElement[] = []
    for (const mark of marks) {
      const row = mark.closest<HTMLButtonElement>('[role="menuitem"]')
      if (row !== null && !row.disabled) rows.push(row)
    }
    return rows
  }, [menuId])

  const focusItem = useCallback(
    (index: number): void => {
      const items = ownItems()
      const target = index < 0 ? items[items.length - 1] : items[index]
      if (target !== undefined) target.focus()
    },
    [ownItems],
  )

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
        return
      }
      const items = ownItems()
      if (items.length === 0) return
      // Only steer when focus is on our trigger or inside our own menu.
      const active = document.activeElement
      const ours =
        items.some((item) => item === active) ||
        (active !== null && rootRef.current?.contains(active) === true)
      if (!ours) return
      event.preventDefault()
      const current = items.findIndex((item) => item === active)
      let next: number
      if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = items.length - 1
      else if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
      else next = current <= 0 ? items.length - 1 : current - 1
      focusItem(next)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, focusItem, ownItems])

  // Move focus into the list once it is mounted, so the first arrow key lands on
  // a row instead of being swallowed by the trigger.
  const pendingFocus = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!open || pendingFocus.current === undefined) return
    const index = pendingFocus.current
    pendingFocus.current = undefined
    focusItem(index)
  }, [open, focusItem])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled || open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      pendingFocus.current = event.key === 'ArrowUp' ? -1 : 0
      setOpen(true)
    }
  }

  const items = options.map((option) => ({
    id: option.value,
    label: (
      <span className="sss-menu-item" data-shell-selector-item={menuId}>
        <span className="sss-menu-item-label">{option.label}</span>
        {option.description === undefined ? null : (
          <span className="sss-menu-item-desc">{option.description}</span>
        )}
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
    <div
      ref={rootRef}
      className={`sss-select${className === undefined ? '' : ` ${className}`}`}
      onKeyDown={handleKeyDown}
    >
      <Menu
        open={open}
        anchor={anchor}
        items={items}
        selectedId={value}
        // Right-edge aligned so a wide list grows leftwards, and portalled so
        // the Settings dialog's overflow cannot crop it.
        align="end"
        side="bottom"
        portal
        className="sss-select-menu"
        onSelect={(id) => {
          onChange(id as T)
          setOpen(false)
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
