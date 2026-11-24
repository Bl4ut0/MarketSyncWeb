import { describe, expect, it } from 'vitest';
import { createCraftEvaluator, type CraftRecipe, type RecipeCatalog } from '../src/lib/craftProfit.js';

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
});
