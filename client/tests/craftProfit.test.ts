import { describe, expect, it } from 'vitest';
import {
  createCraftEvaluator, describeUnpricedRecipes, visibleProfessions, type CraftRecipe, type RecipeCatalog,
} from '../src/lib/craftProfit.js';

const recipe = (id: number, itemId: number, count: number, reagents: [number, number][]): CraftRecipe => ({
  id, itemId, yield: count, reagents, profession: 164, name: `Recipe ${id}`,
});

const catalog = (recipes: CraftRecipe[], vendorPrices = {}): RecipeCatalog => ({
  version: 1, flavor: 'forever', build: '1.60.1.71037', professions: [],
  items: {}, recipes, vendorPrices,
});

describe('craft profitability', () => {
  it('prices a multi-level chain, rounds batches up and subtracts the auction fee', () => {
    const armor = recipe(1, 10, 1, [[20, 3], [40, 1]]);
    const bars = recipe(2, 20, 2, [[30, 2]]);
    const parts = recipe(3, 30, 1, [[50, 1]]);
    const estimate = createCraftEvaluator(catalog([armor, bars, parts], { 40: 10 }), {
      10: { price: 1000, quantity: 3 }, 20: { price: 100, quantity: 8 },
      50: { price: 5, quantity: 10 },
    });
    expect(estimate(armor, 1, 'lowest')).toMatchObject({
      cost: 30, netSale: 950, profit: 920,
      materials: [
        { itemId: 20, source: 'craft', craft: { batches: 2, output: 4,
          materials: [{ itemId: 30, source: 'craft', craft: { materials: [{ itemId: 50, cost: 20 }] } }] } },
        { itemId: 40, source: 'vendor', cost: 10 },
      ],
    });
    expect(estimate(armor, 1, 'buy')).toMatchObject({ cost: 310, profit: 640 });
  });

  it('counts auction supply across branches and refuses to value missing inputs as free', () => {
    const final = recipe(1, 10, 1, [[20, 1], [30, 1]]);
    const first = recipe(2, 20, 1, [[40, 2]]);
    const second = recipe(3, 30, 1, [[40, 2]]);
    const cycle = recipe(4, 40, 1, [[10, 1]]);
    const estimate = createCraftEvaluator(catalog([final, first, second, cycle]), {
      40: { price: 5, quantity: 3 },
    });
    expect(estimate(final, 1, 'lowest')).toMatchObject({ cost: null, netSale: null, profit: null });
  });

  it('calculates vendor profit for bulk crafts without an auction sale quote or fee', () => {
    const product = recipe(1, 10, 2, [[20, 3]]);
    const data = { ...catalog([product]), sellPrices: { 10: 200 } };
    const available = createCraftEvaluator(data, { 20: { price: 20, quantity: 150 } });
    expect(available(product, 50, 'lowest')).toMatchObject({
      output: 100, cost: 3000, netSale: null, profit: null,
      vendorSale: 20000, vendorProfit: 17000,
    });
    const missing = createCraftEvaluator(data, {});
    expect(missing(product, 1, 'lowest')).toMatchObject({
      cost: null, vendorSale: 400, vendorProfit: null,
    });
  });
});

describe('unpriced recipes', () => {
  const professions = [
    { id: 171, name: 'Alchemy', recipeCount: 181, unsupportedCount: 15 },
    { id: 333, name: 'Enchanting', recipeCount: 29, unsupportedCount: 233 },
    { id: 129, name: 'First Aid', recipeCount: 32, unsupportedCount: 0 },
    { id: 755, name: 'Jewelcrafting', recipeCount: 0, unsupportedCount: 4 },
    { id: 794, name: 'Archaeology', recipeCount: 0, unsupportedCount: 0 },
  ];

  it('keeps professions whose recipes are all unpriced and drops empty ones', () => {
    expect(visibleProfessions({ professions }).map((p) => p.name))
      .toEqual(['Alchemy', 'Enchanting', 'First Aid', 'Jewelcrafting']);
  });

  it('explains why recipes are not priced', () => {
    expect(describeUnpricedRecipes(professions[2]!)).toBeNull();
    expect(describeUnpricedRecipes(professions[1]!)).toBe(
      '233 Enchanting recipes are not priced: most enchants apply to gear and create no item to sell.',
    );
    expect(describeUnpricedRecipes(professions[0]!)).toMatch(/^15 Alchemy recipes are not priced: they create no item/);
    expect(describeUnpricedRecipes({ ...professions[3]!, unsupportedCount: 1 })).toMatch(/^1 Jewelcrafting recipe is not priced/);
  });
});
