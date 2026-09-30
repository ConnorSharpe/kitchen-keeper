// TASK-069 §2.8: pure structural validation of the eval fixture against the golden set.

const CATEGORIES = [
  'ingredient_hidden', 'paraphrase', 'exact_rare_term', 'temporal_meal_log', 'negative',
];

const lc = (s) => String(s).toLowerCase();
const has = (text, term) => lc(text).includes(lc(term));
const recipeText = (r) => [r.name, r.description, ...(r.tags || []),
  ...(r.ingredients || []).map((i) => i.name), ...(r.steps || [])];

/** Returns a list of problem strings; [] means the fixture is valid. */
export function validateFixture(fixture, golden) {
  const problems = [];
  const { recipes, mealLogs } = fixture;

  if (recipes.length <= 150) problems.push(`recipes: need more than 150, got ${recipes.length}`);

  const keys = new Set();
  const names = new Set();
  for (const r of recipes) {
    if (keys.has(r.key)) problems.push(`duplicate recipe key: ${r.key}`);
    keys.add(r.key);
    if (names.has(lc(r.name))) problems.push(`duplicate recipe name: ${r.name}`);
    names.add(lc(r.name));
  }
  const logKeys = new Set();
  for (const m of mealLogs) {
    if (logKeys.has(m.key)) problems.push(`duplicate mealLog key: ${m.key}`);
    logKeys.add(m.key);
    if (!(m.loggedDaysAgo >= 0 && m.loggedDaysAgo <= 90)) {
      problems.push(`mealLog ${m.key}: loggedDaysAgo ${m.loggedDaysAgo} outside [0,90]`);
    }
  }
  const allKeys = new Set([...keys, ...logKeys]);
  const byKey = new Map(recipes.map((r) => [r.key, r]));

  const checkExpected = (q) => {
    for (const e of q.expected) {
      if (!allKeys.has(e.key)) problems.push(`${q.id}: expected key ${e.key} does not exist`);
    }
  };

  for (const q of golden.retrieval) {
    if (!CATEGORIES.includes(q.category)) {
      problems.push(`${q.id}: unknown category ${q.category}`);
    }
    if ((q.category === 'negative') !== (q.expected.length === 0)) {
      problems.push(`${q.id}: negative must have empty expected, and only negative may`);
    }
    checkExpected(q);

    if (q.category === 'ingredient_hidden') {
      if (!q.term) {
        problems.push(`${q.id}: ingredient_hidden requires term`);
      } else {
        for (const e of q.expected) {
          const r = byKey.get(e.key);
          if (!r) continue;
          if (!r.ingredients.some((i) => has(i.name, q.term))) {
            problems.push(`${q.id}: term ${q.term} not in an ingredient of ${e.key}`);
          }
          if (has(r.name, q.term) || (r.tags || []).some((t) => has(t, q.term))) {
            problems.push(`${q.id}: term ${q.term} leaks into name or tags of ${e.key}`);
          }
        }
      }
    }

    if (q.category === 'exact_rare_term') {
      if (!q.term) {
        problems.push(`${q.id}: exact_rare_term requires term`);
      } else {
        const found = recipes.filter((r) => recipeText(r).some((t) => has(t, q.term)))
          .map((r) => r.key).sort();
        const want = q.expected.map((e) => e.key).sort();
        if (found.join('|') !== want.join('|')) {
          problems.push(`${q.id}: term ${q.term} matches [${found}] but expected [${want}]`);
        }
      }
    }

    if (q.category === 'negative') {
      if (!q.absentTerms || q.absentTerms.length === 0) {
        problems.push(`${q.id}: negative requires non-empty absentTerms`);
      } else {
        for (const term of q.absentTerms) {
          if (recipes.some((r) => recipeText(r).some((t) => has(t, term)))
            || mealLogs.some((m) => has(m.itemName, term))) {
            problems.push(`${q.id}: absent term ${term} appears in fixture`);
          }
        }
      }
    }
  }

  for (const q of golden.agent) {
    checkExpected(q);
    if (q.kind === 'golden') {
      if (q.expected.length === 0) problems.push(`${q.id}: golden requires non-empty expected`);
    } else if (q.kind === 'control') {
      if (q.expected.length > 0) problems.push(`${q.id}: control requires empty expected`);
    } else {
      problems.push(`${q.id}: unknown kind ${q.kind}`);
    }
  }

  return problems;
}
