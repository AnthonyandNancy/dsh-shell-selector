/**
 * The reference a `.volatile()` Config field resolves to.
 *
 * DSH 0.1.7-rc.1 never hands a plugin the bare value of a volatile field: the
 * Loader passes the reference to `apply()`, and schemastery returns the same
 * reference from `~standard.validate()`. The shape is cosmokit's
 * `createVolatile()` output — a plain object with a `get()` reader and a
 * writer marked by a GLOBAL symbol, which is what makes it recognizable across
 * the module copies the host and the plugin each load.
 *
 * @module dsh-shell-selector/tests/helpers/volatile-ref
 */

/** The writer slot cosmokit stamps on a volatile reference (`Symbol.for`, so it crosses module copies). */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Build one reference the way the host's schema resolution does.
 *
 * @param value - the value the reference currently holds.
 * @returns a frozen reference the plugin must read through `get()`.
 */
export function volatileRef(value: unknown): unknown {
  return Object.freeze({ get: () => value, [VOLATILE_WRITE]: () => {} })
}

/** A reference with no readable value — how schemastery reports an absent field. */
export function volatileRefWithoutReader(): unknown {
  return Object.freeze({ [VOLATILE_WRITE]: () => {} })
}
