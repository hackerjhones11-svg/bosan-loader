import type { Lang } from '../app/prefs';
import { SYMBOLS, type SymbolId } from '../game/symbols';

const en = {
  title: 'Langur Burja',
  subtitle: 'Jhandi Burja dice',
  roll: 'Roll Dice',
  rollOther: 'पासा फाल्नुहोस्',
  rolling: 'Rolling…',
  settling: 'Settling…',
  preparing: 'Preparing dice…',
  shortcutHint: 'or press Space / Enter',
  resultTitle: 'Result',
  resultIdle: 'Roll to count the symbols',
  resultRolling: 'Dice in motion…',
  resultTotal: '6 dice',
  resultRecovered: 'Animation was interrupted. Showing the recorded result.',
  historyTitle: 'Recent rolls',
  historyEmpty: 'No rolls yet. Your last 20 rolls will appear here.',
  clear: 'Clear',
  clearConfirm: 'Clear all history?',
  clearYes: 'Clear',
  clearNo: 'Keep',
  helpLabel: 'How to read the dice',
  close: 'Close',
  sound: 'Sound',
  soundOnTitle: 'Sound is on',
  soundOffTitle: 'Sound is off',
  languageButton: 'ने',
  languageLabel: 'नेपालीमा हेर्नुहोस् (Switch to Nepali)',
  testMode: 'TEST MODE',
  testPending: 'Next roll uses faces preset by an admin. It will not be random.',
  testRolling: 'Rolling preset test faces. This roll is not random.',
  testResult: 'Test roll. This result was preset, not random.',
  testTag: 'TEST',
  die: 'Die',
  diceTray: 'Dice tray',
  trayShowing: 'Dice showing',
  trayIntro: 'Six dice, one of each symbol, ready to roll',
  announce: 'Roll complete.',
  announceTest: 'Test roll complete. Outcome was preset, not random.',
  fallbackNotice: '3D view unavailable. Showing simple dice.',
  matLabel: 'Symbol counts',
  diceCount: (n: number) => (n === 1 ? '1 die' : `${n} dice`),
  rollAt: 'Roll at',
} as const;

type Strings = { [K in keyof typeof en]: (typeof en)[K] extends (n: number) => string ? (n: number) => string : string };

const ne: Strings = {
  title: 'लङ्गुर बुर्जा',
  subtitle: 'झण्डी बुर्जा पासा',
  roll: 'पासा फाल्नुहोस्',
  rollOther: 'Roll Dice',
  rolling: 'पासा घुम्दै…',
  settling: 'पासा थामिँदै…',
  preparing: 'पासा तयार हुँदै…',
  shortcutHint: 'वा स्पेस / इन्टर थिच्नुहोस्',
  resultTitle: 'नतिजा',
  resultIdle: 'चिन्ह गन्न पासा फाल्नुहोस्',
  resultRolling: 'पासा घुम्दैछ…',
  resultTotal: '६ पासा',
  resultRecovered: 'एनिमेसन रोकियो। रेकर्ड गरिएको नतिजा देखाइँदैछ।',
  historyTitle: 'पछिल्ला फालहरू',
  historyEmpty: 'अहिलेसम्म कुनै फाल छैन। पछिल्ला २० फाल यहाँ देखिनेछन्।',
  clear: 'मेटाउनुहोस्',
  clearConfirm: 'सबै इतिहास मेटाउने?',
  clearYes: 'मेटाउनुहोस्',
  clearNo: 'राख्नुहोस्',
  helpLabel: 'पासा कसरी पढ्ने',
  close: 'बन्द गर्नुहोस्',
  sound: 'आवाज',
  soundOnTitle: 'आवाज खुला छ',
  soundOffTitle: 'आवाज बन्द छ',
  languageButton: 'EN',
  languageLabel: 'Switch to English (अंग्रेजीमा हेर्नुहोस्)',
  testMode: 'परीक्षण मोड',
  testPending: 'अर्को फालको नतिजा प्रशासकले तोकेको छ। यो अनियमित हुने छैन।',
  testRolling: 'तोकिएको परीक्षण नतिजा फालिँदैछ। यो फाल अनियमित होइन।',
  testResult: 'परीक्षण फाल। यो नतिजा पहिल्यै तोकिएको थियो, अनियमित होइन।',
  testTag: 'परीक्षण',
  die: 'पासा',
  diceTray: 'पासा थाल',
  trayShowing: 'पासामा देखिएका चिन्ह',
  trayIntro: 'हरेक चिन्ह एक-एक भएका छ वटा पासा, फाल्न तयार',
  announce: 'फाल सकियो।',
  announceTest: 'परीक्षण फाल सकियो। नतिजा पहिल्यै तोकिएको थियो।',
  fallbackNotice: '३D दृश्य उपलब्ध छैन। साधारण पासा देखाइँदैछ।',
  matLabel: 'चिन्ह गणना',
  diceCount: (n: number) => `${toNepaliDigits(n)} पासा`,
  rollAt: 'फालेको समय',
};

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function toNepaliDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => DEVANAGARI_DIGITS[Number(d)]);
}

export const STRINGS: Record<Lang, Strings> = { en, ne };

export function formatCount(n: number, lang: Lang): string {
  return lang === 'ne' ? toNepaliDigits(n) : String(n);
}

/** Primary and secondary labels for a symbol in the current language. */
export function symbolLabels(id: SymbolId, lang: Lang): { primary: string; secondary: string } {
  const s = SYMBOLS[id];
  return lang === 'ne' ? { primary: s.nepali, secondary: s.latin } : { primary: s.latin, secondary: s.english };
}

/** Name used in announcements and accessible labels, e.g. "Paan (Heart)". */
export function symbolSpokenName(id: SymbolId, lang: Lang): string {
  const s = SYMBOLS[id];
  return lang === 'ne' ? `${s.nepali}` : `${s.latin} (${s.english})`;
}

export type { Strings };
