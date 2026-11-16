/**
 * Microscopic Madness: levels, specimens, answer choices, hints and facts.
 * Every fact and real-world size is checked against a source listed in
 * SOURCES.md (ids in `src`). Image files and widths live in
 * public/assets/microscope/manifest.json so real micrographs can replace
 * the simulated ones without code changes.
 */

export const STAMP_SKILL = 'Spotted clues at tiny scales';

/** Zoom steps per specimen, closest first. */
export const ZOOM_STEPS = 4;

/**
 * @typedef {Object} Specimen
 * @property {string} id          matches the manifest
 * @property {string} name        the right answer, as shown on its button
 * @property {string[]} choices   four answers including `name`, in display order
 * @property {string[]} hints     one-line hint after each wrong guess (index = wrong guesses so far - 1)
 * @property {string} fact        one short true fact shown on the reveal
 * @property {string[]} src       SOURCES.md ids backing the fact and the look
 */

/** @type {Record<string, Specimen>} */
export const SPECIMENS = {
  salt: {
    id: 'salt', name: 'Table salt',
    choices: ['Sand', 'Table salt', 'Glitter', 'Sugar'],
    hints: [
      'Look at the corners. They are square, like the corner of a box.',
      'Every grain here has the same box shape with flat faces.',
      'Each box is smaller than a sesame seed. You might shake it on food.',
    ],
    fact: 'Salt grains are tiny cubes, because sodium and chloride atoms stack in a cube pattern. Most grains are 0.2 to 0.6 mm across.',
    src: ['salt-scale', 'salt-sem'],
  },
  hair: {
    id: 'hair', name: 'A strand of hair',
    choices: ['A pine needle', 'Fishing line', 'A strand of hair', 'A noodle'],
    hints: [
      'The surface is covered in thin layers that overlap, like shingles.',
      'It is a long, thin strand. Check the scale bar: it is about 0.1 mm wide.',
      'Lots of these grow on your head.',
    ],
    fact: 'A hair from your head is about 0.1 mm wide. Its outside is covered in tightly packed scales that overlap.',
    src: ['hair-sem', 'hair-width'],
  },
  hooks: {
    id: 'hooks', name: 'Hook-and-loop tape',
    choices: ['A hairbrush', 'Hook-and-loop tape', 'Carpet', 'Grass'],
    hints: [
      'This plastic strand bends over at the top, like a cane.',
      'Rows of tiny hooks stand up from a woven strip.',
      'These hooks grab loops on the other side. Shoes and jackets use it.',
    ],
    fact: 'George de Mestral looked at burrs under a microscope and saw tiny hooks. That idea became hook-and-loop tape, patented in 1955.',
    src: ['hooks-invent', 'hooks-hackaday'],
  },
  pollen: {
    id: 'pollen', name: 'Sunflower pollen',
    choices: ['A sea urchin', 'A dust bunny', 'Sunflower pollen', 'A seed'],
    hints: [
      'Check the scale bar. This spiky ball is smaller than a hair is wide.',
      'Spikes like these help it stick to visiting bees.',
      'Flowers make lots of this yellow dust.',
    ],
    fact: 'Pollen has a tough outer wall. On sunflower pollen it is covered in spikes that help the grains stick to bees.',
    src: ['pollen-nwe', 'pollen-foldscope', 'pollen-size'],
  },
  wing: {
    id: 'wing', name: 'Butterfly wing',
    choices: ['Fish skin', 'Snake skin', 'Butterfly wing', 'Bird feather'],
    hints: [
      'Each tiny plate has fine ridges running along it.',
      'The plates sit in rows and overlap like roof shingles.',
      'Each scale is about as small as a speck of dust. Together they color an insect\'s wings.',
    ],
    fact: 'A butterfly wing is covered in hundreds of thousands of tiny scales that overlap like roof shingles.',
    src: ['wing-phys', 'wing-rsc'],
  },
  leaf: {
    id: 'leaf', name: 'Leaf surface',
    choices: ['Orange peel', 'Leaf surface', 'Skin on your hand', 'A sponge'],
    hints: [
      'Two bean-shaped cells sit around a thin slit.',
      'The slits are pores that let gases in and out.',
      'Look for veins. This came from a plant.',
    ],
    fact: 'Leaves have tiny pores called stomata. Two guard cells open and close each pore to control gas and water exchange.',
    src: ['leaf-atlas', 'leaf-csbsju'],
  },
  paper: {
    id: 'paper', name: 'Paper',
    choices: ['Plastic wrap', 'Aluminum foil', 'Paper', 'A sponge'],
    hints: [
      'These are flat ribbons, all tangled together like a mat.',
      'The ribbons are plant fibers. Most come from wood.',
      'See the torn edge? You write and draw on this.',
    ],
    fact: 'Paper is a mat of plant fibers, mostly from wood. Softwood fibers are about 3 to 5 mm long.',
    src: ['paper-brit', 'wood-brit'],
  },
  cotton: {
    id: 'cotton', name: 'Cotton fabric',
    choices: ['Steel wool', 'A spider web', 'Paper', 'Cotton fabric'],
    hints: [
      'Each fiber is a flat, twisted ribbon.',
      'Many fibers twist together to make one thread.',
      'Threads go over and under each other. You might be wearing this.',
    ],
    fact: 'A cotton fiber grows on the outside of a cotton seed. Under a microscope it looks like a flattened, twisted tube about 0.02 mm wide.',
    src: ['cotton-cameo'],
  },
  graphite: {
    id: 'graphite', name: 'Pencil tip',
    choices: ['Chalk', 'Pencil tip', 'A crayon', 'An eraser'],
    hints: [
      'These are thin, flat flakes stacked in layers.',
      'The flakes rub off easily and leave a gray mark.',
      'The flakes cover a sharp point that sits in wood.',
    ],
    fact: 'Pencil "lead" has no lead metal in it. It is graphite, a form of carbon made of flat layers that flake off onto paper.',
    src: ['graphite-micro'],
  },
};

/**
 * @typedef {Object} Level
 * @property {number} id
 * @property {string} title
 * @property {string} goal
 * @property {string} teaches
 * @property {number} wrongLimit   two-star limit: wrong guesses for the whole level
 * @property {string[]} specimens  ids, in play order
 */

/** @type {Level[]} */
export const LEVELS = [
  { id: 1, title: 'Everyday objects', goal: 'Name three things from around the house.', teaches: 'Shape and texture are clues.', wrongLimit: 4, specimens: ['salt', 'hair', 'hooks'] },
  { id: 2, title: 'Living things', goal: 'Name three parts of plants or animals.', teaches: 'Living things have structure at tiny scales.', wrongLimit: 3, specimens: ['pollen', 'wing', 'leaf'] },
  { id: 3, title: 'Materials', goal: 'Name three materials.', teaches: 'Materials are built from fibers, grains or layers.', wrongLimit: 3, specimens: ['paper', 'cotton', 'graphite'] },
];
