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
  { key: '.dcc', group: 'Education', text: 'Pt assessed at the bedside. VS stable. Pt has a fair appetite and is drinking fluids throughout the day. Pt looking forward to discharging home. Reviewed discharge process with pt. Reviewed medications. Pt instructed to continue with current medications until the patient sees their primary care provider. Pt tolerated medications and therapy well during their SNF admission. No acute complications since last assessment.' },
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


// ===== APP-11-11  START: "Today's decisions" buttons and varied wording =====
// Both lists are the ones tested on the computer against the Note Updater (F:\\Bedside app\\phrases).
// Today's decisions: one tap writes the sentence; ___ is what gets typed. They show as the "Decisions" group on the phrase bar.
export const DECISION_GROUP = 'Decisions';
export const DECISION_PHRASES = [
  { key: ".inc", group: DECISION_GROUP, text: "Increased ___ to ___ for ___." }, // Medication: Increased
  { key: ".dec", group: DECISION_GROUP, text: "Decreased ___ to ___ for ___." }, // Medication: Decreased
  { key: ".start", group: DECISION_GROUP, text: "Started ___ for ___." }, // Medication: Started
  { key: ".stop", group: DECISION_GROUP, text: "Stopped ___ due to ___." }, // Medication: Stopped
  { key: ".held", group: DECISION_GROUP, text: "Held ___ today for ___." }, // Medication: Held
  { key: ".cont", group: DECISION_GROUP, text: "Continue ___, no changes today." }, // Medication: Continue, no change
  { key: ".lab", group: DECISION_GROUP, text: "Ordered ___ for ___." }, // Tests: Ordered labs
  { key: ".ua", group: DECISION_GROUP, text: "Ordered UA with culture for ___." }, // Tests: Ordered UA
  { key: ".xr", group: DECISION_GROUP, text: "Ordered ___ x-ray for ___." }, // Tests: Ordered imaging
  { key: ".res", group: DECISION_GROUP, text: "Reviewed labs from ___: ___." }, // Tests: Reviewed results
  { key: ".hosp", group: DECISION_GROUP, text: "Reviewed hospital discharge summary from ___." }, // Records: Hospital records
  { key: ".spec", group: DECISION_GROUP, text: "Reviewed ___ consult note from ___." }, // Records: Specialist note
  { key: ".cm", group: DECISION_GROUP, text: "Discussed plan of care with case manager: ___." }, // Discussed: Case manager
  { key: ".dr", group: DECISION_GROUP, text: "Discussed with Dr. ___ (___): ___." }, // Discussed: Physician / specialist
  { key: ".fam", group: DECISION_GROUP, text: "History obtained from ___ as pt is unable to give a reliable history." }, // Discussed: History from family
  { key: ".ed", group: DECISION_GROUP, text: "Sent pt to the ED for ___." }, // Level of care: Sent to ED
  { key: ".tip", group: DECISION_GROUP, text: "Hospitalization discussed for ___; decision made to treat in the facility: ___." }, // Level of care: Treat in place
  { key: ".stable", group: DECISION_GROUP, text: "___ stable on current regimen." }, // Problem status: Stable
  { key: ".goal", group: DECISION_GROUP, text: "___ not at goal: ___." }, // Problem status: Not at goal
  { key: ".worse", group: DECISION_GROUP, text: "___ worse today: ___." }, // Problem status: Worse
  { key: ".newp", group: DECISION_GROUP, text: "New problem today: ___." }, // Problem status: New problem
];
// Varied wording: each row says the same thing in different words and adds no finding. The first is the wording used until now.
export const PHRASE_VARIANTS = [
  ["Pt assessed up at bedside.", "Pt seen up at bedside.", "Assessed pt up at bedside.", "Pt evaluated up at bedside."],
  ["Pt assessed in wheelchair.", "Pt seen in wheelchair.", "Assessed pt in wheelchair.", "Pt evaluated in wheelchair."],
  ["Pt denies breathing complications.", "Denies any breathing complications.", "No breathing complications reported.", "Pt reports no breathing complications."],
  ["Pt's pain within acceptable limits.", "Pain remains within acceptable limits.", "Pain level within acceptable limits.", "Pain is within acceptable limits."],
  ["No s/sx of sedation.", "No signs or symptoms of sedation.", "No sedation noted.", "Without s/sx of sedation."],
  ["Pt denies constipation.", "Denies constipation.", "No constipation reported.", "Pt reports no constipation."],
  ["Fair appetite, adequate fluids intake.", "Appetite fair, fluid intake adequate.", "Fair appetite with adequate fluid intake.", "Appetite is fair, fluids intake adequate."],
  ["Pt continues to work with therapy.", "Continues working with therapy.", "Pt still working with therapy.", "Pt continues with therapy."],
];
// The sentence after the vital signs ("Vital signs: <readings>; denies ..."). Every wording keeps the word "denies".
export const VITALS_TAILS = ["denies HAs, dizziness or chest pain.", "denies chest pain, dizziness or HAs.", "pt denies HAs, chest pain or dizziness."];
// ===== APP-11-11  END =====

// Antibiotics to pick from on the ABX detail. A name in brackets helps the search but stays out of the note.
export const DEFAULT_ABX = [
  'Amoxicillin', 'Amoxicillin-clavulanate (Augmentin)', 'Ampicillin', 'Ampicillin-sulbactam (Unasyn)', 'Azithromycin (Zithromax)',
  'Cefazolin (Ancef)', 'Cefdinir', 'Cefepime', 'Cefpodoxime (Vantin)', 'Ceftriaxone (Rocephin)', 'Cefuroxime (Ceftin)',
  'Cephalexin (Keflex)', 'Ciprofloxacin (Cipro)', 'Clindamycin', 'Daptomycin', 'Doxycycline', 'Ertapenem (Invanz)',
  'Fosfomycin', 'Gentamicin', 'Levofloxacin (Levaquin)', 'Linezolid (Zyvox)', 'Meropenem', 'Metronidazole (Flagyl)',
  'Nitrofurantoin (Macrobid)', 'Penicillin VK', 'Piperacillin-tazobactam (Zosyn)', 'Rifampin',
  'Sulfamethoxazole-trimethoprim (Bactrim)', 'Vancomycin',
];

export const DEFAULT_SETTINGS = {
  template: DEFAULT_TEMPLATE,
  locations: DEFAULT_LOCATIONS,
  phrases: [...DEFAULT_PHRASES, ...DECISION_PHRASES], // APP-11-11
  pinned: [DECISION_GROUP, 'Assessment', 'Pain', 'Treatment', 'Education', 'Meds'],
  highPain: 7,
  fastingStart: '04:00',
  fastingEnd: '09:00',
  retentionDays: 7,
  receiverToken: '',
  receiverUrl: '',
  buildings: [], // permanent building ids, in button order
  buildingNames: {}, // id -> name shown and used for folders (missing = the id itself)
  buildingFormer: {}, // id -> earlier names, so the receiver can rename old folders
  currentBuilding: '',
  abxList: DEFAULT_ABX,
  addedDefaults: [], // starter items added to existing installs by later versions
  providerName: '',
  varyWording: true, // APP-11-11: routine sentences are worded a little differently each day (Settings turns it off)
};

// Quick details on each patient, in note order. All optional; note.js fullNote() puts each in its place.
// A preset is used as written; anything typed gets the prefix (e.g. "Per nursing, ...").
export const DETAILS = [
  { key: 'overnight', label: 'Overnight', prefix: 'Overnight: ',
    presets: ['No acute events overnight', 'Slept well overnight', 'Poor sleep overnight'] },
  { key: 'nursing', label: 'Nursing', prefix: 'Per nursing, ',
    presets: ['No new concerns per nursing'] },
  { key: 'new', label: 'New', prefix: 'New: ', presets: [] },
  { key: 'pain', label: 'Pain' },
  { key: 'meal', label: 'Meal %', prefix: 'Meals: ', unit: '%',
    numberText: (v) => `Pt eating ${v}% of meals`,
    quick: ['0', '25', '50', '75', '100'], presets: [] },
  { key: 'therapy', label: 'Therapy', prefix: 'Therapy: ', unit: 'ft',
    numberText: (v) => `Pt ambulated ${v} ft with therapy`,
    quick: ['25', '50', '100', '150', '200', '300'], presets: ['Did not ambulate with therapy today'] },
  { key: 'abx', label: 'ABX' },
  { key: 'said', label: 'Pt said', prefix: '', quote: true, presets: [] },
];

// Optional pain area and type buttons under the pain score. Chosen ones join the pain sentence:
// "Pain 6/10 to right knee and hip, aching and sharp."
export const PAIN_SIDES = ['left', 'right', 'bilateral'];
export const PAIN_SITES = ['lower back', 'knee', 'hip', 'shoulder', 'neck', 'leg', 'foot', 'abdomen', 'incision site', 'fingers', 'hands', 'generalized'];
export const PAIN_TYPES = ['aching', 'sharp', 'dull', 'burning', 'throbbing', 'stabbing', 'shooting', 'cramping', 'tender', 'numbness', 'tingling'];
