import { useEffect, useRef } from 'react';
import { uiStore, useUi } from '../app/appState';
import { SYMBOL_IDS, SYMBOLS } from '../game/symbols';
import { useStrings } from '../hooks/useStrings';
import { SymbolIcon } from './SymbolIcon';

const COPY = {
  en: {
    title: 'How to read the dice',
    intro:
      'Langur Burja, also called Jhandi Burja, is played with six dice. Every die carries the same six symbols, one on each face.',
    symbolsTitle: 'The six symbols',
    readTitle: 'Reading a roll',
    read: [
      'When the dice stop, look only at the top face of each die.',
      'Count how many dice show each symbol. The mat below the tray does this for you, and the counts always add up to six.',
      'Hover over a symbol on the mat (or tap it on touch screens) to ring the matching dice in the tray.',
    ],
    fairTitle: 'Fair dice',
    fair: 'Every die is independent. Each symbol has exactly a 1 in 6 chance on every die, on every roll. Earlier results never make a symbol more or less likely next time.',
    testTitle: 'Test rolls',
    test: 'A roll marked TEST was preset by an admin for testing. It is labelled on screen and in history and is not random.',
    keysTitle: 'Keyboard',
    keys: 'Press Space or Enter to roll when no other control is focused.',
    note: 'This is a dice simulator only. It has no betting, money or payouts.',
  },
  ne: {
    title: 'पासा कसरी पढ्ने',
    intro: 'लङ्गुर बुर्जा (झण्डी बुर्जा) छ वटा पासाले खेलिन्छ। हरेक पासामा उही छ वटा चिन्ह हुन्छन्, एक मोहोरमा एउटा।',
    symbolsTitle: 'छ वटा चिन्ह',
    readTitle: 'फाल कसरी पढ्ने',
    read: [
      'पासा रोकिएपछि हरेक पासाको माथिल्लो मोहोर मात्र हेर्नुहोस्।',
      'कुन चिन्ह कति पासामा परेको छ गन्नुहोस्। थाल मुनिको तालिकाले यो गणना गर्छ, र जम्मा सधैं छ हुन्छ।',
      'तालिकाको कुनै चिन्हमा माउस राख्नुहोस् (वा छुनुहोस्), थालमा त्यही चिन्हका पासा घेरिन्छन्।',
    ],
    fairTitle: 'निष्पक्ष पासा',
    fair: 'हरेक पासा स्वतन्त्र हुन्छ। हरेक फालमा हरेक पासामा प्रत्येक चिन्हको सम्भावना ठीक ६ मा १ हुन्छ। पहिलेका नतिजाले अर्को फाललाई असर गर्दैन।',
    testTitle: 'परीक्षण फाल',
    test: '"परीक्षण" चिन्ह लागेको फाल प्रशासकले परीक्षणका लागि तोकेको हो। यो स्क्रिन र इतिहासमा देखाइन्छ र अनियमित हुँदैन।',
    keysTitle: 'किबोर्ड',
    keys: 'अरू कुनै बटनमा फोकस नभएको बेला स्पेस वा इन्टर थिचेर पासा फाल्न सकिन्छ।',
    note: 'यो पासा सिमुलेटर मात्र हो। यसमा बाजी, पैसा वा भुक्तानी छैन।',
  },
} as const;

export function HelpDialog() {
  const { t, lang } = useStrings();
  const open = useUi((s) => s.helpOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const copy = COPY[lang];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="help-dialog"
      aria-labelledby="help-title"
      onClose={() => uiStore.set({ helpOpen: false })}
      onClick={(event) => {
        // Click on the backdrop (outside the panel) closes.
        if (event.target === ref.current) uiStore.set({ helpOpen: false });
      }}
    >
      <div className="help-panel">
        <div className="help-head">
          <h2 id="help-title">{copy.title}</h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={() => uiStore.set({ helpOpen: false })}>
            <span aria-hidden="true" className="icon-glyph">×</span>
          </button>
        </div>
        <p>{copy.intro}</p>
        <h3>{copy.symbolsTitle}</h3>
        <ul className="help-symbols">
          {SYMBOL_IDS.map((id) => (
            <li key={id}>
              <span className="help-symbol">
                <SymbolIcon id={id} size="100%" />
              </span>
              <span>
                <strong>{SYMBOLS[id].latin}</strong> <span lang="ne">{SYMBOLS[id].nepali}</span>
                <br />
                <span className="muted">{SYMBOLS[id].english}</span>
              </span>
            </li>
          ))}
        </ul>
        <h3>{copy.readTitle}</h3>
        <ol>
          {copy.read.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <h3>{copy.fairTitle}</h3>
        <p>{copy.fair}</p>
        <h3>{copy.testTitle}</h3>
        <p>{copy.test}</p>
        <h3>{copy.keysTitle}</h3>
        <p>{copy.keys}</p>
        <p className="help-note">{copy.note}</p>
      </div>
    </dialog>
  );
}
