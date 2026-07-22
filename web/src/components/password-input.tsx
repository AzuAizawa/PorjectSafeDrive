import { useState } from 'react';

const RULES = [
  { label: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { label: 'One special character', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordMeetsRules(value: string) {
  return RULES.every((r) => r.test(value));
}

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  showChecklist?: boolean;
}

export function PasswordInput({ value, onChange, label = 'Password', showChecklist = false }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          required
          minLength={8}
          className="h-[38px] w-full rounded-md border border-line bg-surface px-3 pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? '🙈' : '👁️'}
        </button>
      </div>

      {showChecklist ? (
        <ul className="mt-2 flex flex-col gap-1">
          {RULES.map((rule) => {
            const met = rule.test(value);
            return (
              <li key={rule.label} className={`flex items-center gap-1.5 text-[11.5px] ${met ? 'text-good' : 'text-muted'}`}>
                <span>{met ? '✓' : '○'}</span>
                {rule.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
