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
 *    viewport, with a small margin on every edge;
 *  - `align="end"` pins the list's RIGHT edge to the trigger's right edge, so a
 *    list wider than its trigger grows leftwards, into the dialog, instead of
 *    escaping past its right edge.
 *
 * @module dsh-shell-selector/client/dsh-select
 */
import { type ReactNode } from 'react';
export interface DshSelectOption<T extends string> {
    value: T;
    label: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
}
export interface DshSelectProps<T extends string> {
    value: T;
    options: readonly DshSelectOption<T>[];
    onChange: (value: T) => void;
    disabled?: boolean;
    ariaLabel?: string;
    className?: string;
}
export declare function DshSelect<T extends string>({ value, options, onChange, disabled, ariaLabel, className, }: DshSelectProps<T>): JSX.Element;
//# sourceMappingURL=DshSelect.d.ts.map