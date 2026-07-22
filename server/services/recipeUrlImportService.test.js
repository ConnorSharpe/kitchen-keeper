import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDisallowedIp,
  extractJsonLdRecipe,
  extractPageText,
  extractPageTitle,
} from './recipeUrlImportService.js';

test('isDisallowedIp blocks loopback, private, and link-local IPv4', () => {
  assert.equal(isDisallowedIp('127.0.0.1'), true);
  assert.equal(isDisallowedIp('10.1.2.3'), true);
  assert.equal(isDisallowedIp('172.16.0.5'), true);
  assert.equal(isDisallowedIp('192.168.1.1'), true);
  assert.equal(isDisallowedIp('169.254.169.254'), true); // cloud metadata
});

test('isDisallowedIp blocks the extended IANA special-purpose ranges (round 2)', () => {
  assert.equal(isDisallowedIp('100.64.0.1'), true); // shared/CGNAT
  assert.equal(isDisallowedIp('192.0.0.1'), true); // IETF protocol assignments
  assert.equal(isDisallowedIp('192.0.2.1'), true); // documentation
  assert.equal(isDisallowedIp('198.18.0.1'), true); // benchmarking
  assert.equal(isDisallowedIp('198.51.100.1'), true); // documentation
  assert.equal(isDisallowedIp('203.0.113.1'), true); // documentation
  assert.equal(isDisallowedIp('224.0.0.1'), true); // multicast
  assert.equal(isDisallowedIp('240.0.0.1'), true); // reserved
  assert.equal(isDisallowedIp('255.255.255.255'), true); // broadcast
});

test('isDisallowedIp allows ordinary public IPv4 addresses', () => {
  assert.equal(isDisallowedIp('93.184.216.34'), false); // example.com-range public IP
  assert.equal(isDisallowedIp('8.8.8.8'), false);
});

test('isDisallowedIp blocks IPv6 loopback, unspecified, ULA, link-local, and documentation ranges', () => {
  assert.equal(isDisallowedIp('::1'), true);
  assert.equal(isDisallowedIp('::'), true);
  assert.equal(isDisallowedIp('fd00::1'), true);
  assert.equal(isDisallowedIp('fe80::1'), true);
  assert.equal(isDisallowedIp('2001:db8::1'), true);
});

test('isDisallowedIp allows an ordinary public IPv6 address', () => {
  assert.equal(isDisallowedIp('2606:4700:4700::1111'), false);
});

test('isDisallowedIp rejects non-IP input', () => {
  assert.equal(isDisallowedIp('not-an-ip'), true);
});

test('extractJsonLdRecipe maps a flat Recipe node, including duration/yield parsing and tag dedup', () => {
  const html = `<html><head><script type="application/ld+json">
    ${JSON.stringify({
      '@type': 'Recipe',
      name: 'Test Soup',
      recipeIngredient: ['2 cups broth', '1 tsp salt'],
      recipeInstructions: ['Boil it.', 'Season it.'],
      recipeYield: '4 servings',
      prepTime: 'PT15M',
      cookTime: 'PT1H30M',
      recipeCategory: 'Dinner',
      recipeCuisine: 'Dinner',
    })}
  </script></head><body></body></html>`;
  const recipe = extractJsonLdRecipe(html);
  assert.equal(recipe.name, 'Test Soup');
  assert.equal(recipe.servings, 4);
  assert.equal(recipe.prepMins, 15);
  assert.equal(recipe.cookMins, 90);
  assert.deepEqual(recipe.steps, ['Boil it.', 'Season it.']);
  assert.equal(recipe.tags.length, 1); // 'Dinner' deduped, not duplicated
});

test('extractJsonLdRecipe finds a Recipe node inside an @graph array', () => {
  const html = `<html><head><script type="application/ld+json">
    ${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite', name: 'Some Blog' },
        { '@type': 'Recipe', name: 'Graph Recipe', recipeIngredient: ['1 egg'] },
      ],
    })}
  </script></head><body></body></html>`;
  assert.equal(extractJsonLdRecipe(html).name, 'Graph Recipe');
});

test('extractJsonLdRecipe returns null when no Recipe JSON-LD is present', () => {
  assert.equal(extractJsonLdRecipe('<html><body>no recipe here</body></html>'), null);
});

test('extractPageText truncates near an Ingredients heading when there is a long preamble', () => {
  const preamble = 'This is my grandmother\'s story. '.repeat(30); // > 150 chars
  const html = `<html><body><p>${preamble}</p><h2>Ingredients</h2><p>2 eggs, 1 cup flour</p></body></html>`;
  const text = extractPageText(html);
  const ingredientsIndex = text.toLowerCase().indexOf('ingredients');
  assert.ok(ingredientsIndex >= 0 && ingredientsIndex < 200);
});

test('extractPageTitle returns the <title> text, or null if absent', () => {
  assert.equal(
    extractPageTitle('<html><head><title> My Recipe </title></head></html>'),
    'My Recipe'
  );
  assert.equal(extractPageTitle('<html><head></head></html>'), null);
});
