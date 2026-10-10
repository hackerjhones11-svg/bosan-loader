/** One restrained material palette for the whole sequence. */
export const C = {
  black: '#000000',
  white: '#FFFFFF',
  /** survey and alignment lines */
  survey: '#ffffff',
  /** equipment linework */
  line: '#8d939a',
  lineLight: '#b9bec4',
  lineDim: '#5b6168',
  /** solid surfaces */
  graphite: '#1d2023',
  graphite2: '#2b2f33',
  steel: '#454a50',
  steelLight: '#6a7077',
  silver: '#9da3a9',
  silverLight: '#c9cdd1',
  glass: '#111316',
  /** figures: near and far limbs give quiet depth */
  figure: '#b4b9bf',
  figureFar: '#7c8288',
  hat: '#dfe2e5',
  /** precast letter material before it resolves to white */
  /** freshly cast material, before it cures, and the joints between lifts */
  wet: '#62676d',
  joint: '#767b81',
  materialTop: '#a7abb0',
  materialBottom: '#92979c',
} as const;
