import { useState } from 'react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

// Same open/close shape as NotificationBell's dropdown (fixed overlay to
// catch outside clicks + an absolutely-positioned panel) — reused here
// rather than a native <select multiple>, which can't show a compact
// "Body type (2)" summary or a per-option checkbox row.
export function MultiSelectDropdown({ label, options, selected, onChange }: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="input-base flex w-auto min-w-[140px] items-center justify-between gap-2 px-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {label}
          {selected.length > 0 ? <span className="ml-1 font-semibold text-accent">({selected.length})</span> : null}
        </span>
        <span className="text-muted">▾</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass absolute left-0 top-11 z-50 max-h-72 w-56 overflow-y-auto rounded-xl border border-line/70 p-1.5 shadow-xl">
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                />
                {opt.label}
              </label>
            ))}
            {selected.length > 0 ? (
              <button
                type="button"
                className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-semibold text-muted underline hover:text-ink"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
