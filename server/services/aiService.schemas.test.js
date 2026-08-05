import { test } from 'node:test';
import assert from 'node:assert/strict';

// aiService.js (via recipeSearchService.js) and routes/ai.js both transitively
// import db/client.js, which constructs its Neon client at module load time
// and throws if DATABASE_URL is unset; aiService.js also constructs an OpenAI
// client at module load time and throws if OPENAI_API_KEY is unset. This test
// only needs the pure schema/Zod exports below — no query and no OpenAI call
// ever runs — so placeholders are enough when the real values aren't already
// loaded. Static imports are hoisted above module-body code, so these must be
// set before aiService.js/routes/ai.js are imported dynamically, not via a
// top-of-file static import.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost/test';
process.env.OPENAI_API_KEY ??= 'test-key';

const {
  EAT_THIS_NOW_SCHEMA,
  EXPAND_SUGGESTION_SCHEMA,
  PARSE_RECEIPT_SCHEMA,
  PARSED_RECIPE_SCHEMA,
  ENRICH_RECIPE_FIELDS_SCHEMA,
} = await import('./aiService.js');
const { parsedRecipeSchema } = await import('../routes/ai.js');

const ALL_SCHEMAS = {
  EAT_THIS_NOW_SCHEMA,
  EXPAND_SUGGESTION_SCHEMA,
  PARSE_RECEIPT_SCHEMA,
  PARSED_RECIPE_SCHEMA,
  ENRICH_RECIPE_FIELDS_SCHEMA,
};

// Recursively walks every object node in a JSON Schema (root + nested, through
// `properties` and array `items`) and asserts the two invariants OpenAI's
// `strict: true` mode requires at every level: `additionalProperties: false`,
// and `required` exactly equal to that object's own `properties` keys.
function walkSchemaNode(node, path, assertions) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'object' || node.properties) {
    assertions.push({
      path,
      additionalProperties: node.additionalProperties,
      requiredKeys: [...(node.required ?? [])].sort(),
      propertyKeys: Object.keys(node.properties ?? {}).sort(),
    });
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walkSchemaNode(child, `${path}.properties.${key}`, assertions);
    }
  }

  if (node.type === 'array' && node.items) {
    walkSchemaNode(node.items, `${path}.items`, assertions);
  }
}

for (const [schemaName, jsonSchema] of Object.entries(ALL_SCHEMAS)) {
  test(`${schemaName}: every object node has additionalProperties:false and a full required list`, () => {
    const assertions = [];
    walkSchemaNode(jsonSchema.schema, schemaName, assertions);
    assert.ok(assertions.length > 0, `${schemaName} should contain at least one object node`);
    for (const a of assertions) {
      assert.equal(
        a.additionalProperties,
        false,
        `${a.path} must have additionalProperties: false`
      );
      assert.deepStrictEqual(
        a.requiredKeys,
        a.propertyKeys,
        `${a.path}'s required array must exactly equal its properties keys`
      );
    }
  });
}

for (const [schemaName, jsonSchema] of Object.entries(ALL_SCHEMAS)) {
  test(`${schemaName}: response_format shape survives a JSON.stringify/parse round-trip`, () => {
    const requestShape = { type: 'json_schema', json_schema: jsonSchema };
    const roundTripped = JSON.parse(JSON.stringify(requestShape));
    assert.deepStrictEqual(roundTripped, requestShape);
  });
}

test('PARSED_RECIPE_SCHEMA top-level fields match the Zod parsedRecipeSchema fields', () => {
  const jsonSchemaKeys = Object.keys(PARSED_RECIPE_SCHEMA.schema.properties).sort();
  const zodKeys = Object.keys(parsedRecipeSchema.shape).sort();
  assert.deepStrictEqual(jsonSchemaKeys, zodKeys);
});

test('PARSED_RECIPE_SCHEMA ingredient sub-schema fields match the Zod ingredient fields', () => {
  const jsonSchemaKeys = Object.keys(
    PARSED_RECIPE_SCHEMA.schema.properties.ingredients.items.properties
  ).sort();
  const zodKeys = Object.keys(
    parsedRecipeSchema.shape.ingredients.removeDefault().element.shape
  ).sort();
  assert.deepStrictEqual(jsonSchemaKeys, zodKeys);
});
