import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type CycleMode = 'menstrual' | 'planning'

interface CycleModeCtx {
  mode: CycleMode
  setMode: (m: CycleMode) => void
  toggle: () => void
}

const Ctx = createContext<CycleModeCtx>({
  mode: 'menstrual',
  setMode: () => {},
  toggle: () => {},
})

/** Read the current cycle mode + setters anywhere below the provider. */
export const useCycleMode = () => useContext(Ctx)

const STORAGE_KEY = 'femi9-cycle-mode'

function readInitial(): CycleMode {
  if (typeof window === 'undefined') return 'menstrual'
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return saved === 'planning' ? 'planning' : 'menstrual'
}

/**
 * Cycle Mode (spec §3). A cycle is phases, not one static event, so the whole
 * site can switch between two moods:
 *   - `menstrual` — Active/Bleeding phase: ultra-clean, high-contrast, calm.
 *   - `planning`  — Rest-of-month phase: warmer, editorial, lifestyle-forward.
 *
 * The mode is written to `data-cycle` on <html>, so any CSS token can respond
 * (see cycle-mode.css) and it persists across visits via localStorage.
 */
export function CycleModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<CycleMode>(readInitial)

  useEffect(() => {
    document.documentElement.setAttribute('data-cycle', mode)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  const toggle = () =>
    setMode((m) => (m === 'menstrual' ? 'planning' : 'menstrual'))

  return <Ctx.Provider value={{ mode, setMode, toggle }}>{children}</Ctx.Provider>
}

const COPY: Record<CycleMode, { label: string; hint: string }> = {
  menstrual: { label: 'Active phase', hint: 'Calm · reorder fast' },
  planning: { label: 'Planning phase', hint: 'Explore · stock up' },
}

/** The visible switch users tap to move the whole site between phases. */
export function CycleModeToggle({ className = '' }: { className?: string }) {
  const { mode, toggle } = useCycleMode()
  return (
    <button
      type="button"
      className={`cycle-toggle ${className}`.trim()}
      data-mode={mode}
      onClick={toggle}
      aria-label={`Cycle mode: ${COPY[mode].label}. Tap to switch.`}
      title="Switch cycle phase"
    >
      <span className="cycle-toggle__track" aria-hidden>
        <span className="cycle-toggle__thumb" />
      </span>
      <span className="cycle-toggle__text">
        <b>{COPY[mode].label}</b>
        <small>{COPY[mode].hint}</small>
      </span>
    </button>
  )
}
