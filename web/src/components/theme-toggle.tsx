import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme | null {
  const stored = localStorage.getItem('safedrive-theme');
  return stored === 'light' || stored === 'dark' ? stored : null;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => getInitialTheme() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('safedrive-theme', next);
  }

  return (
    <button
      className="grid h-8.5 w-8.5 place-items-center rounded-full border border-line bg-surface/80 text-base hover:-translate-y-px hover:shadow-md hover:rotate-12"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Moon className="h-4 w-4" strokeWidth={2.25} /> : <Sun className="h-4 w-4" strokeWidth={2.25} />}
    </button>
  );
}
