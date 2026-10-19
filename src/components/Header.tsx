import { prefsStore, uiStore, usePrefs } from '../app/appState';
import { useStrings } from '../hooks/useStrings';
import { SymbolIcon } from './SymbolIcon';

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" />
      {on ? (
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
          <path d="M17.6 6.8a7.4 7.4 0 0 1 0 10.4" />
        </g>
      ) : (
        <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
        </g>
      )}
    </svg>
  );
}

export function Header({ admin }: { admin: boolean }) {
  const { t, lang } = useStrings();
  const prefs = usePrefs();

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <SymbolIcon id="burja" size={22} />
        </span>
        <div className="brand-text">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        {admin && <span className="admin-pill">Admin testing</span>}
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={t.helpLabel}
          title={t.helpLabel}
          onClick={() => uiStore.set({ helpOpen: true })}
        >
          <span aria-hidden="true" className="icon-glyph">?</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t.sound}
          aria-pressed={prefs.sound}
          title={prefs.sound ? t.soundOnTitle : t.soundOffTitle}
          onClick={() => prefsStore.set({ sound: !prefs.sound })}
        >
          <SpeakerIcon on={prefs.sound} />
        </button>
        <button
          type="button"
          className="icon-button lang-button"
          aria-label={t.languageLabel}
          title={t.languageLabel}
          lang={lang === 'en' ? 'ne' : 'en'}
          onClick={() => prefsStore.set({ lang: lang === 'en' ? 'ne' : 'en' })}
        >
          {t.languageButton}
        </button>
      </div>
    </header>
  );
}
