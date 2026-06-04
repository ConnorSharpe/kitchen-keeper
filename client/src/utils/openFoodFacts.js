const OFF_BASE = 'https://world.openfoodfacts.org/api/v2/product';

const CATEGORY_RULES = [
  { keywords: ['dairy', 'milk', 'cheese', 'yogurt', 'cream'],          category: 'Dairy' },
  { keywords: ['produce', 'vegetable', 'fruit', 'fresh'],              category: 'Produce' },
  { keywords: ['seafood', 'fish', 'shellfish', 'shrimp', 'prawn'],     category: 'Seafood' },
  { keywords: ['meat', 'poultry', 'chicken', 'beef', 'pork', 'lamb'],  category: 'Meat' },
  { keywords: ['bakery', 'bread', 'pastry', 'biscuit', 'cake'],        category: 'Bakery' },
  { keywords: ['frozen'],                                               category: 'Frozen' },
  { keywords: ['beverage', 'drink', 'juice', 'water', 'soda', 'tea', 'coffee'], category: 'Beverages' },
  { keywords: ['condiment', 'sauce', 'dressing', 'vinegar', 'oil'],    category: 'Condiments' },
];

function mapCategory(tags) {
  const tagStr = tags.join(' ').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((k) => tagStr.includes(k))) return rule.category;
  }
  return 'Pantry';
}

function mapProduct(product) {
  return {
    name: product.product_name_en || product.product_name || product.generic_name || '',
    category: mapCategory(product.categories_tags ?? []),
  };
}

export async function fetchProductByBarcode(barcode, { signal } = {}) {
  const res = await fetch(`${OFF_BASE}/${barcode}.json`, { signal });
  if (!res.ok) throw new Error('Network error');
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return mapProduct(data.product);
}
