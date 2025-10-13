// SafeThemeSection.jsx
import React, { useState } from 'react';

const Pill = ({ children }) => (
  <span className="inline-block bg-gray-800/70 text-gray-200 text-xs px-2 py-1 rounded-md mr-2 mb-2 border border-gray-700">
    {children}
  </span>
);

const ThemeBlock = ({ t }) => {
  const [open, setOpen] = useState(true);
  const quotes = Array.isArray(t?.evidence) ? t.evidence.filter(Boolean).slice(0, 3) : [];
  const hasDrivers = Array.isArray(t?.drivers) && t.drivers.length > 0;
  const hasBarriers = Array.isArray(t?.barriers) && t.barriers.length > 0;
  const hasTensions = Array.isArray(t?.tensions) && t.tensions.length > 0;
  const hasOpps = Array.isArray(t?.opportunities) && t.opportunities.length > 0;

  // If there is literally nothing to show, don’t render the card
  if (
    !t?.themeNarrative &&
    !hasDrivers &&
    !hasBarriers &&
    !hasTensions &&
    !hasOpps &&
    quotes.length === 0
  ) return null;

  return (
    <div className="bg-[#111822] border border-gray-700 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="text-white font-semibold text-lg">
          {t?.emoji ? `${t.emoji} ` : ''}{t?.theme || 'Untitled Theme'}
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="text-teal-300 hover:text-teal-200 text-sm"
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {open && (
        <div className="mt-2">
          {/* Narrative FIRST */}
          {t?.themeNarrative && (
            <>
              <div className="text-gray-300 text-sm font-semibold mb-1">Theme narrative</div>
              <p className="text-gray-200 leading-relaxed">{t.themeNarrative}</p>
            </>
          )}

          {(hasDrivers || hasBarriers) && (
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              {hasDrivers && (
                <div>
                  <div className="text-gray-300 text-sm font-semibold mb-1">Key drivers</div>
                  <div className="flex flex-wrap">
                    {t.drivers.slice(0, 6).map((d, i) => <Pill key={i}>{d}</Pill>)}
                  </div>
                </div>
              )}
              {hasBarriers && (
                <div>
                  <div className="text-gray-300 text-sm font-semibold mb-1">Barriers / frictions</div>
                  <div className="flex flex-wrap">
                    {t.barriers.slice(0, 6).map((b, i) => <Pill key={i}>{b}</Pill>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {hasTensions && (
            <div className="mt-3">
              <div className="text-gray-300 text-sm font-semibold mb-1">Tensions & trade-offs</div>
              <ul className="list-disc list-inside text-gray-200 space-y-1">
                {t.tensions.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          )}

          {hasOpps && (
            <div className="mt-3">
              <div className="text-gray-300 text-sm font-semibold mb-1">Opportunities</div>
              <ul className="list-disc list-inside text-gray-200 space-y-1">
                {t.opportunities.slice(0, 6).map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}

          {quotes.length > 0 && (
            <div className="mt-3">
              <div className="text-gray-300 text-sm font-semibold mb-1">Supporting quotes</div>
              <div className="space-y-2">
                {quotes.map((q, i) => (
                  <blockquote
                    key={i}
                    className="text-gray-300 italic border-l-4 border-gray-700 pl-3"
                  >
                    “{q}”
                  </blockquote>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function SafeThemeSection({ themes = [] }) {
  if (!Array.isArray(themes) || themes.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="text-white font-semibold text-lg mb-2">Theme Insights</div>
      {themes.map((t, idx) => <ThemeBlock key={idx} t={t} />)}
    </div>
  );
}
