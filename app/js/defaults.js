// Starter settings. Everything here is editable in the app's Settings screen.

export const DEFAULT_TEMPLATE =
  '{location} Vital signs: {vitals}denies HAs, dizziness or chest pain. Pt denies breathing complications. ' +
  'Pain {pain}/10. Pt\'s pain within acceptable limits. No s/sx of sedation. Pt denies constipation. ' +
  'Fair appetite, adequate fluids intake. Pt continues to work with therapy.';

export const DEFAULT_LOCATIONS = [
  { key: 'B', label: 'bedside', text: 'Pt assessed up at bedside.' },
  { key: 'C', label: 'chair', text: 'Pt assessed up in chair.' },
  { key: 'R', label: 'recliner', text: 'Pt assessed up in recliner.' },
  { key: 'SB', label: 'side of bed', text: 'Pt assessed sitting at side of bed.' },
  { key: 'W', label: 'wheelchair', text: 'Pt assessed in wheelchair.' },
  { key: 'T', label: 'therapy room', text: 'Pt assessed in therapy room.' },
];

// Nathan's existing keyboard text shortcuts, grouped.
// Type the shortcut followed by a space in the editor, or tap it on the phrase bar.
export const DEFAULT_PHRASES = [
  // Assessment
  { key: 'dh', group: 'Assessment', text: "Denies HA's, dizziness or chest pain." },
  { key: 'nac', group: 'Assessment', text: 'Denies acute complications.' },
  { key: 'nacb', group: 'Assessment', text: 'Denies acute breathing complications.' },
  { key: 'nacc', group: 'Assessment', text: 'Denies acute cardiac complications.' },
  { key: 'nacbb', group: 'Assessment', text: 'Pt denies acute bruising or bleeding.' },
  { key: 'nacbbw', group: 'Assessment', text: 'No acute bruising or bleeding complications, pt continues with' },
  { key: '.csd', group: 'Assessment', text: 'Denies constipation, no s/sx of sedation during assessment.' },
  { key: 'faaf', group: 'Assessment', text: 'Fair appetite, adequate fluids intake.' },
  { key: 'gaaf', group: 'Assessment', text: 'Good appetite, adequate fluids intake.' },
  { key: '.s', group: 'Assessment', text: 'Pt sleeping well throughout the night.' },
  { key: '.psia', group: 'Assessment', text: 'Pt pleased with strength improvement since snf admission.' },
  // Pain
  { key: '.cox', group: 'Pain', text: 'Pain within therapeutic range with oxycodone.' },
  { key: '.coxt', group: 'Pain', text: 'Pain within therapeutic range continues with oxycodone and Tylenol.' },
  // Treatment
  { key: '.iv', group: 'Treatment', text: 'Pt continues IV abx therapy without complications.' },
  { key: '.pco', group: 'Treatment', text: 'Pt continues with oral abx therapy without complications.' },
  { key: '.o', group: 'Treatment', text: 'Pt continues with O2 therapy via nasal canula.' },
  { key: '.nw', group: 'Treatment', text: 'Nursing continues with wound care.' },
  { key: '.hyd', group: 'Treatment', text: 'Sure hydralazine 25mg q8h prn for sbp >150' },
  { key: '.pso', group: 'Treatment', text: 'Pt started on' },
  { key: 'roaa', group: 'Treatment', text: 'Pt recovering from' },
  // Education and labs
  { key: '.dc', group: 'Education', text: 'Discharge education reviewed with pt.' },
  { key: '.dcf', group: 'Education', text: 'Discharge education reviewed with pt and family.' },
  { key: '.fl', group: 'Education', text: 'Pt educated on the benefits from hydration and consistent fluids intake.' },
  { key: '.lo', group: 'Education', text: 'Labs ordered:' },
  { key: '.lr', group: 'Education', text: 'Labs reviewed.' },
  // Meds
  { key: '.a', group: 'Meds', text: 'Amlodipine' },
  { key: '.g', group: 'Meds', text: 'gabapentin' },
  { key: '.l', group: 'Meds', text: 'lisinopril' },
  { key: '.m', group: 'Meds', text: 'Metoprolol' },
  { key: '.ox', group: 'Meds', text: 'Oxycodone' },
  { key: '.p', group: 'Meds', text: 'Percocet' },
  { key: '.t', group: 'Meds', text: 'Tylenol' },
  { key: '.tr', group: 'Meds', text: 'Tramadol' },
  { key: '.z', group: 'Meds', text: 'zofran' },
  // Words
  { key: '.c', group: 'Words', text: 'cough' },
  { key: '.pna', group: 'Words', text: 'pneumonia' },
  { key: 'sob', group: 'Words', text: 'shortness of breath' },
  { key: '.fbs', group: 'Words', text: 'Fast blood sugar' },
  { key: 'pd', group: 'Words', text: 'Pt denies' },
  { key: 'ccc', group: 'Words', text: 'Continue' },
  { key: 'cccs', group: 'Words', text: 'continues' },
];

export const DEFAULT_SETTINGS = {
  template: DEFAULT_TEMPLATE,
  locations: DEFAULT_LOCATIONS,
  phrases: DEFAULT_PHRASES,
  pinned: ['Assessment', 'Pain', 'Treatment', 'Education', 'Meds'],
  highPain: 7,
  fastingStart: '04:00',
  fastingEnd: '09:00',
  retentionDays: 7,
  receiverToken: '',
  receiverUrl: '',
  providerName: '',
};
