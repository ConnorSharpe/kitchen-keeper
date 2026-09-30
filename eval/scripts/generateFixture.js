// TASK-069 §2.8: generates eval/fixtures/household.json, the synthetic eval corpus.
// Deterministic (seeded PRNG): re-running produces a byte-identical file. The output is committed;
// this script only exists so the corpus can be regenerated or extended reviewably.
//
// Hero recipes are hand-written retrieval targets that the golden set points at. Filler recipes and
// meal logs are generated from pools that EXCLUDE every term the golden set depends on (hidden
// ingredients, rare terms, negative terms, temporal items); eval/lib/fixtureCheck.js re-verifies that.
//
// Usage: node eval/scripts/generateFixture.js
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'household.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(69);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const sample = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
};
const ing = (name, quantity, unit) => ({ name, quantity, unit });

// ---- Hero recipes (hand-written retrieval targets) ----
// savedDaysAgo > ~300 puts a recipe outside the 150 most recently saved, i.e. absent from the chat
// agent's recipe summary; the agent eval's no-tool arm cannot see those by name.
const HEROES = [
  // ingredient_hidden: the term appears only in the ingredients, never in the name or tags.
  {
    key: 'hero_traybake', name: 'Sunday Night Traybake', savedDaysAgo: 410,
    description: 'One-pan roasted vegetables with a crispy, smoky finish.',
    tags: ['dinner', 'easy', 'vegetarian'],
    ingredients: [ing('chickpeas', 400, 'g'), ing('sweet potato', 2, 'item'), ing('red onion', 1, 'item'), ing('smoked paprika', 2, 'tsp'), ing('olive oil', 3, 'tbsp')],
    steps: ['Heat the oven to 220C.', 'Toss everything with oil and paprika on a large tray.', 'Roast for 35 minutes, shaking halfway.'],
  },
  {
    key: 'hero_glow_bowl', name: 'Monday Glow Bowl', savedDaysAgo: 380,
    description: 'A bright grain bowl with a creamy lemon dressing.',
    tags: ['lunch', 'vegan', 'meal prep'],
    ingredients: [ing('quinoa', 150, 'g'), ing('kale', 100, 'g'), ing('tahini', 3, 'tbsp'), ing('lemon', 1, 'item'), ing('cucumber', 0.5, 'item')],
    steps: ['Cook the quinoa and let it cool.', 'Massage the kale with a pinch of salt.', 'Whisk the dressing with lemon juice and water, then pour over the bowl.'],
  },
  {
    key: 'hero_pasta_night', name: 'Friday Pasta Night', savedDaysAgo: 350,
    description: 'Salty, garlicky spaghetti that comes together in 15 minutes.',
    tags: ['dinner', 'quick', 'pasta'],
    ingredients: [ing('spaghetti', 200, 'g'), ing('anchovies', 6, 'item'), ing('garlic', 3, 'clove'), ing('chilli flakes', 1, 'tsp'), ing('parsley', 1, 'handful')],
    steps: ['Boil the spaghetti.', 'Melt the fillets into warm oil with the garlic and chilli.', 'Toss with the pasta, a splash of pasta water and the parsley.'],
  },
  {
    key: 'hero_winter_soup', name: "Mum's Winter Soup", savedDaysAgo: 330,
    description: 'A thick, filling soup for cold evenings.',
    tags: ['soup', 'comfort'],
    ingredients: [ing('pearl barley', 100, 'g'), ing('carrots', 2, 'item'), ing('celery', 2, 'stick'), ing('leek', 1, 'item'), ing('vegetable stock', 1.5, 'l')],
    steps: ['Soften the chopped vegetables in butter.', 'Add the grains and stock.', 'Simmer for 50 minutes until thick.'],
  },
  {
    key: 'hero_desk_wraps', name: 'Desk Lunch Wraps', savedDaysAgo: 40,
    description: 'Grilled cheese and roasted pepper wraps that travel well.',
    tags: ['lunch', 'quick'],
    ingredients: [ing('halloumi', 225, 'g'), ing('tortilla wraps', 4, 'item'), ing('roasted red peppers', 1, 'jar'), ing('rocket', 1, 'handful')],
    steps: ['Slice and griddle the cheese until golden.', 'Layer everything into the wraps.', 'Roll tightly and wrap in foil.'],
  },
  {
    key: 'hero_breakfast_bake', name: 'Weekend Breakfast Bake', savedDaysAgo: 25,
    description: 'A big sharing dish of eggs, potatoes and spiced sausage.',
    tags: ['breakfast', 'brunch'],
    ingredients: [ing('chorizo', 150, 'g'), ing('potatoes', 500, 'g'), ing('eggs', 6, 'item'), ing('spring onions', 4, 'item')],
    steps: ['Roast the diced potatoes for 25 minutes.', 'Add the sliced sausage for 10 minutes.', 'Crack in the eggs and bake until just set.'],
  },
  // paraphrase: the golden query describes the dish without sharing its distinctive words.
  {
    key: 'hero_harira', name: 'Harira', savedDaysAgo: 360,
    description: 'Moroccan tomato and lentil soup, traditionally served to break the fast during Ramadan.',
    tags: ['soup', 'moroccan'],
    ingredients: [ing('red lentils', 150, 'g'), ing('tinned tomatoes', 400, 'g'), ing('celery', 2, 'stick'), ing('ground cinnamon', 1, 'tsp'), ing('ground ginger', 1, 'tsp'), ing('coriander', 1, 'bunch')],
    steps: ['Fry the onion, celery and spices.', 'Add lentils, tomatoes and water.', 'Simmer 40 minutes and finish with lemon and coriander.'],
  },
  {
    key: 'hero_shakshuka', name: 'Shakshuka', savedDaysAgo: 12,
    description: 'Eggs poached in a spiced tomato and pepper sauce, eaten with bread.',
    tags: ['brunch', 'vegetarian'],
    ingredients: [ing('eggs', 4, 'item'), ing('tinned tomatoes', 400, 'g'), ing('red pepper', 2, 'item'), ing('ground cumin', 1, 'tsp'), ing('feta', 50, 'g')],
    steps: ['Soften the peppers with the cumin.', 'Add the tomatoes and reduce.', 'Make wells, crack in the eggs, cover until set.'],
  },
  {
    key: 'hero_jook', name: 'Jook', savedDaysAgo: 395,
    description: 'Cantonese rice porridge simmered for hours, topped with scallion and ginger. Gentle food for sick days.',
    tags: ['breakfast', 'comfort'],
    ingredients: [ing('jasmine rice', 100, 'g'), ing('chicken stock', 1.5, 'l'), ing('fresh ginger', 1, 'thumb'), ing('scallions', 3, 'item'), ing('white pepper', 0.5, 'tsp')],
    steps: ['Rinse the rice.', 'Simmer in stock with ginger for 90 minutes, stirring often.', 'Top with scallions and white pepper.'],
  },
  {
    key: 'hero_tarte_tatin', name: 'Tarte Tatin', savedDaysAgo: 290,
    description: 'Upside-down caramelised apple tart baked under puff pastry.',
    tags: ['dessert', 'french'],
    ingredients: [ing('apples', 6, 'item'), ing('caster sugar', 150, 'g'), ing('butter', 60, 'g'), ing('puff pastry', 1, 'sheet')],
    steps: ['Make a dry caramel in an ovenproof pan.', 'Pack in the quartered apples.', 'Cover with pastry, bake 30 minutes, then invert onto a plate.'],
  },
  {
    key: 'hero_gazpacho', name: 'Gazpacho', savedDaysAgo: 300,
    description: 'Chilled Andalusian tomato soup, blended raw and served cold in summer.',
    tags: ['soup', 'spanish', 'no-cook'],
    ingredients: [ing('ripe tomatoes', 1, 'kg'), ing('cucumber', 1, 'item'), ing('green pepper', 1, 'item'), ing('sherry vinegar', 2, 'tbsp'), ing('stale bread', 1, 'slice')],
    steps: ['Roughly chop everything.', 'Blend until smooth with oil and vinegar.', 'Chill for at least 2 hours.'],
  },
  {
    key: 'hero_overnight_oats', name: 'Bircher Jars', savedDaysAgo: 60,
    description: 'Swiss-style oats soaked overnight in the fridge with apple and yoghurt, ready to grab in the morning.',
    tags: ['breakfast', 'meal prep'],
    ingredients: [ing('rolled oats', 50, 'g'), ing('apple juice', 100, 'ml'), ing('natural yoghurt', 80, 'g'), ing('grated apple', 1, 'item')],
    steps: ['Stir everything together in a jar.', 'Leave in the fridge overnight.', 'Top with fruit and eat cold.'],
  },
  {
    key: 'hero_bubble_squeak', name: 'Bubble and Squeak', savedDaysAgo: 210,
    description: 'Leftover roast potatoes and greens fried into a crispy patty the day after a roast dinner.',
    tags: ['british', 'leftovers'],
    ingredients: [ing('leftover mashed potato', 400, 'g'), ing('savoy cabbage', 0.25, 'item'), ing('butter', 30, 'g')],
    steps: ['Mix the potato and shredded greens.', 'Press into a hot buttered pan.', 'Fry until a deep crust forms, then flip.'],
  },
  {
    key: 'hero_kra_pao', name: 'Pad Kra Pao', savedDaysAgo: 18,
    description: 'Thai holy basil stir-fry with minced pork, served over rice with a crispy fried egg.',
    tags: ['thai', 'dinner', 'quick'],
    ingredients: [ing('pork mince', 300, 'g'), ing('holy basil', 1, 'bunch'), ing('bird eye chillies', 3, 'item'), ing('oyster sauce', 1, 'tbsp'), ing('eggs', 2, 'item')],
    steps: ['Pound the garlic and chillies.', 'Stir-fry with the pork until caramelised.', 'Wilt in the basil and serve with a fried egg.'],
  },
  // exact_rare_term: the term appears in exactly these recipes and nowhere else in the corpus.
  {
    key: 'hero_wings', name: 'Sticky Weeknight Wings', savedDaysAgo: 90,
    description: 'Oven-baked wings in a sweet, spicy glaze.',
    tags: ['dinner', 'party food'],
    ingredients: [ing('chicken wings', 1, 'kg'), ing('gochujang', 3, 'tbsp'), ing('honey', 2, 'tbsp'), ing('soy sauce', 1, 'tbsp')],
    steps: ['Bake the wings at 220C for 40 minutes.', 'Warm the glaze ingredients together.', 'Toss the wings in the glaze and bake 5 more minutes.'],
  },
  {
    key: 'hero_flatbreads', name: "Za'atar Flatbreads", savedDaysAgo: 70,
    description: 'Soft yoghurt flatbreads brushed with herby oil.',
    tags: ['bread', 'side'],
    ingredients: [ing('self-raising flour', 250, 'g'), ing('natural yoghurt', 250, 'g'), ing("za'atar", 2, 'tbsp'), ing('olive oil', 3, 'tbsp')],
    steps: ['Mix flour and yoghurt into a dough.', 'Roll into 6 rounds and dry-fry.', "Brush with the za'atar oil while hot."],
  },
  {
    key: 'hero_salmon_bowls', name: 'Salmon Rice Bowls', savedDaysAgo: 150,
    description: 'Seared salmon over sticky rice with quick pickles.',
    tags: ['dinner', 'healthy'],
    ingredients: [ing('salmon fillets', 2, 'item'), ing('short grain rice', 150, 'g'), ing('furikake', 2, 'tsp'), ing('radishes', 6, 'item')],
    steps: ['Cook the rice.', 'Sear the salmon skin-side down.', 'Serve over rice and shower with furikake.'],
  },
  {
    key: 'hero_fattoush', name: 'Fattoush', savedDaysAgo: 55,
    description: 'Crunchy Levantine bread salad.',
    tags: ['salad', 'lunch'],
    ingredients: [ing('pitta breads', 2, 'item'), ing('romaine lettuce', 1, 'item'), ing('tomatoes', 3, 'item'), ing('sumac', 1, 'tbsp'), ing('pomegranate molasses', 1, 'tbsp')],
    steps: ['Toast the torn pitta until crisp.', 'Chop the salad vegetables.', 'Dress with oil, lemon, molasses and a heavy pinch of sumac.'],
  },
  {
    key: 'hero_teriyaki', name: 'Teriyaki Chicken', savedDaysAgo: 100,
    description: 'Glossy homemade teriyaki with chicken thighs.',
    tags: ['dinner', 'japanese'],
    ingredients: [ing('chicken thighs', 500, 'g'), ing('soy sauce', 3, 'tbsp'), ing('mirin', 3, 'tbsp'), ing('sugar', 1, 'tbsp')],
    steps: ['Brown the chicken.', 'Add soy, mirin and sugar.', 'Reduce until sticky and glossy.'],
  },
  {
    key: 'hero_miso_aubergine', name: 'Miso Glazed Aubergine', savedDaysAgo: 230,
    description: 'Roasted aubergine halves with a sweet-salty glaze.',
    tags: ['side', 'vegan', 'japanese'],
    ingredients: [ing('aubergines', 2, 'item'), ing('white miso', 2, 'tbsp'), ing('mirin', 2, 'tbsp'), ing('sesame seeds', 1, 'tsp')],
    steps: ['Score and roast the aubergine halves for 25 minutes.', 'Brush with the glaze.', 'Grill until bubbling and scatter with seeds.'],
  },
  {
    key: 'hero_tadka_dal', name: 'Tadka Dal', savedDaysAgo: 250,
    description: 'Yellow lentils finished with a sizzling spiced butter.',
    tags: ['indian', 'vegetarian'],
    ingredients: [ing('yellow split peas', 200, 'g'), ing('turmeric', 1, 'tsp'), ing('asafoetida', 0.25, 'tsp'), ing('cumin seeds', 1, 'tsp'), ing('ghee', 2, 'tbsp')],
    steps: ['Simmer the split peas with turmeric until soft.', 'Heat ghee and fry cumin seeds and asafoetida.', 'Pour the tadka over the dal.'],
  },
];

// ---- Filler recipes ----
// None of these pools may contain a reserved term (see fixtureCheck + golden.json).
const PROTEINS = [
  ['chicken thighs', 'chicken'], ['chicken breast', 'chicken'], ['beef mince', 'beef'], ['pork chops', 'pork'],
  ['cod fillets', 'cod'], ['king prawns', 'prawn'], ['firm tofu', 'tofu'], ['turkey mince', 'turkey'],
  ['lamb shoulder', 'lamb'], ['paneer', 'paneer'], ['black beans', 'black bean'], ['mushrooms', 'mushroom'],
  ['haddock', 'haddock'], ['sausages', 'sausage'], ['butternut squash', 'squash'], ['steak', 'steak'],
];
const FLAVOURS = [
  { label: 'Lemon Herb', extras: ['lemon', 'thyme', 'garlic'] },
  { label: 'Garlic Butter', extras: ['garlic', 'butter', 'parsley'] },
  { label: 'Smoky', extras: ['smoked paprika', 'garlic', 'tomato puree'] },
  { label: 'Honey Mustard', extras: ['honey', 'wholegrain mustard', 'thyme'] },
  { label: 'Sweet Chilli', extras: ['sweet chilli sauce', 'lime', 'spring onions'] },
  { label: 'Peri Peri', extras: ['peri peri sauce', 'red pepper', 'lemon'] },
  { label: 'Coconut', extras: ['coconut milk', 'lime', 'curry powder'] },
  { label: 'Pesto', extras: ['basil pesto', 'cherry tomatoes', 'parmesan'] },
  { label: 'Cajun', extras: ['cajun seasoning', 'red pepper', 'sweetcorn'] },
  { label: 'Ginger Soy', extras: ['fresh ginger', 'soy sauce', 'spring onions'] },
  { label: 'Mediterranean', extras: ['olives', 'courgette', 'oregano'] },
  { label: 'Chipotle', extras: ['chipotle paste', 'lime', 'red onion'] },
  { label: 'Creamy Tuscan', extras: ['double cream', 'spinach', 'sun-dried tomatoes'] },
  { label: 'Balsamic', extras: ['balsamic vinegar', 'red onion', 'rosemary'] },
];
const DISHES = [
  { label: 'Traybake', base: ['potatoes'], method: 'Roast everything on one tray at 200C for 35 minutes.', tags: ['dinner', 'one pan'] },
  { label: 'Stir-Fry', base: ['egg noodles', 'broccoli'], method: 'Stir-fry over high heat for 6 minutes.', tags: ['dinner', 'quick'] },
  { label: 'Curry', base: ['basmati rice', 'onion'], method: 'Simmer in the sauce for 25 minutes.', tags: ['dinner', 'curry'] },
  { label: 'Stew', base: ['carrots', 'onion', 'stock'], method: 'Cover and simmer gently for an hour.', tags: ['dinner', 'comfort'] },
  { label: 'Salad', base: ['mixed leaves', 'cucumber'], method: 'Toss together just before serving.', tags: ['lunch', 'light'] },
  { label: 'Pasta Bake', base: ['penne', 'mozzarella'], method: 'Bake at 190C for 20 minutes until bubbling.', tags: ['dinner', 'family'] },
  { label: 'Tacos', base: ['corn tortillas', 'red cabbage'], method: 'Warm the tortillas and pile in the filling.', tags: ['dinner', 'mexican'] },
  { label: 'Skewers', base: ['red onion', 'peppers'], method: 'Thread onto skewers and grill for 12 minutes.', tags: ['bbq', 'summer'] },
  { label: 'Rice Bowl', base: ['long grain rice', 'edamame'], method: 'Serve the topping over steamed rice.', tags: ['lunch', 'meal prep'] },
  { label: 'Soup', base: ['onion', 'stock'], method: 'Simmer for 20 minutes, then blend half.', tags: ['soup', 'lunch'] },
  { label: 'Pie', base: ['shortcrust pastry', 'onion'], method: 'Top with pastry and bake for 35 minutes.', tags: ['dinner', 'baking'] },
  { label: 'Burgers', base: ['brioche buns', 'lettuce'], method: 'Shape into patties and griddle for 4 minutes a side.', tags: ['dinner', 'bbq'] },
  { label: 'Wraps', base: ['flour tortillas', 'lettuce'], method: 'Roll up tightly and toast seam-side down.', tags: ['lunch', 'quick'] },
];
const UNITS = ['g', 'tbsp', 'tsp', 'item', 'handful'];

const FILLER_COUNT = 186;
const recipes = [...HEROES];
const names = new Set(HEROES.map((h) => h.name.toLowerCase()));
let n = 0;
while (recipes.length < HEROES.length + FILLER_COUNT) {
  const [protein, proteinLabel] = pick(PROTEINS);
  const flavour = pick(FLAVOURS);
  const dish = pick(DISHES);
  const name = `${flavour.label} ${proteinLabel[0].toUpperCase()}${proteinLabel.slice(1)} ${dish.label}`;
  if (names.has(name.toLowerCase())) continue;
  names.add(name.toLowerCase());
  n += 1;
  const parts = [protein, ...dish.base, ...sample(flavour.extras, int(2, 3)), 'olive oil', 'salt'];
  recipes.push({
    key: `filler_${String(n).padStart(3, '0')}`,
    name,
    description: `A ${pick(['simple', 'weeknight', 'family-friendly', 'hearty', 'fresh'])} ${dish.label.toLowerCase()} with ${proteinLabel} and ${flavour.label.toLowerCase()} flavours.`,
    tags: dish.tags,
    ingredients: parts.map((p) => ing(p, int(1, 400), pick(UNITS))),
    steps: [`Prep the ${protein} and vegetables.`, `Season with the ${flavour.extras.join(', ')}.`, dish.method, 'Taste, adjust the seasoning and serve.'],
    savedDaysAgo: int(0, 420),
  });
}

// ---- Meal logs: 300 over 90 days ----
// Temporal targets (golden `temporal_meal_log`) are placed on fixed days; filler items never reuse them.
const TEMPORAL = [
  ['mango', 'Produce', [3, 10, 45]],
  ['sourdough bread', 'Grains', [5, 60]],
  ['kimchi', 'Other', [20, 21]],
  ['pomegranate', 'Produce', [80]],
  ['leftover lasagne', 'Leftovers', [1]],
  ['blueberries', 'Produce', [2, 30, 50]],
];
const MEAL_ITEMS = [
  ['apple', 'Produce'], ['banana', 'Produce'], ['greek yoghurt', 'Dairy'], ['cheddar', 'Dairy'], ['chicken breast', 'Meat'],
  ['salmon fillet', 'Seafood'], ['spinach', 'Produce'], ['broccoli', 'Produce'], ['carrots', 'Produce'], ['eggs', 'Dairy'],
  ['milk', 'Dairy'], ['porridge oats', 'Grains'], ['rice', 'Grains'], ['pasta', 'Grains'], ['tomatoes', 'Produce'],
  ['avocado', 'Produce'], ['strawberries', 'Produce'], ['grapes', 'Produce'], ['ham', 'Meat'], ['bagel', 'Grains'],
  ['orange', 'Produce'], ['pear', 'Produce'], ['cottage cheese', 'Dairy'], ['tuna', 'Seafood'], ['peppers', 'Produce'],
  ['granola', 'Grains'], ['butter', 'Dairy'], ['bacon', 'Meat'], ['mince', 'Meat'], ['crumpets', 'Grains'],
  ['leftover curry', 'Leftovers'], ['leftover stew', 'Leftovers'], ['cucumber', 'Produce'], ['plums', 'Produce'],
];
const mealLogs = [];
for (const [itemName, category, days] of TEMPORAL) {
  for (const d of days) {
    mealLogs.push({ key: `ml_${itemName.replace(/\s+/g, '_')}_${d}`, itemName, category, loggedDaysAgo: d, wasExpiring: false });
  }
}
let m = 0;
while (mealLogs.length < 300) {
  const [itemName, category] = pick(MEAL_ITEMS);
  m += 1;
  mealLogs.push({ key: `ml_filler_${String(m).padStart(3, '0')}`, itemName, category, loggedDaysAgo: int(0, 90), wasExpiring: rand() < 0.2 });
}

// ---- Pantry (in-memory only; fed to the agent eval's pantry summary, never written) ----
const pantry = [
  { id: 1, name: 'milk', category: 'Dairy', qty: '1 l', status: 'critical', frozen: false },
  { id: 2, name: 'spinach', category: 'Produce', qty: '200 g', status: 'warning', frozen: false },
  { id: 3, name: 'chicken thighs', category: 'Meat', qty: '500 g', status: 'warning', frozen: false },
  { id: 4, name: 'greek yoghurt', category: 'Dairy', qty: '500 g', status: 'ok', frozen: false },
  { id: 5, name: 'rice', category: 'Grains', qty: '1 kg', status: 'none', frozen: false },
  { id: 6, name: 'frozen peas', category: 'Frozen', qty: '900 g', status: 'ok', frozen: true },
  { id: 7, name: 'eggs', category: 'Dairy', qty: '6 item', status: 'ok', frozen: false },
  { id: 8, name: 'lemons', category: 'Produce', qty: '3 item', status: 'expired', frozen: false },
];

writeFileSync(OUT, JSON.stringify({ recipes, mealLogs, pantry }, null, 2) + '\n');
console.log(`wrote ${OUT}: ${recipes.length} recipes (${HEROES.length} heroes), ${mealLogs.length} meal logs`);
