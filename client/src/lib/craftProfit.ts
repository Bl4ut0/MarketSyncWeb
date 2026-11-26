import type { FlavorId } from '@marketsync/shared';

export interface CraftRecipe {
  id: number;
  profession: number;
  name: string;
  itemId: number;
  yield: number;
  reagents: [itemId: number, amount: number][];
}

export interface RecipeCatalog {
  version: 1;
  flavor: FlavorId;
  build: string;
  professions: { id: number; name: string; recipeCount: number; unsupportedCount: number }[];
  recipes: CraftRecipe[];
  items: Record<number, string>;
  vendorPrices: Record<number, number>;
  sellPrices?: Record<number, number>;
}

export interface CraftQuote {
  price: number;
  quantity: number;
  icon?: string;
  quality?: number;
  /** From the item catalog; used by the Money Makers view (disenchanting, names). */
  name?: string;
  itemClass?: number;
  itemLevel?: number;
}

/** Wowhead icon slugs for the profession skill-line IDs the recipe catalogs use. */
export const PROFESSION_ICONS: Record<number, string> = {
  40: 'ability_poisons',
  129: 'spell_holy_sealofsacrifice',
  164: 'trade_blacksmithing',
  165: 'inv_misc_armorkit_17',
  171: 'trade_alchemy',
  182: 'trade_herbalism',
  185: 'inv_misc_food_15',
  186: 'trade_mining',
  197: 'trade_tailoring',
  202: 'trade_engineering',
  333: 'trade_engraving',
  356: 'trade_fishing',
  393: 'inv_misc_pelt_wolf_01',
  755: 'inv_misc_gem_01',
  773: 'inv_inscription_tradeskill01',
  794: 'trade_archaeology',
};
export type CraftQuotes = Record<number, CraftQuote>;
export type CraftStrategy = 'lowest' | 'buy' | 'craft';

export interface CraftMaterial {
  itemId: number;
  quantity: number;
  cost: number | null;
  source: 'auction' | 'vendor' | 'craft' | 'surplus' | 'missing';
  reused?: number;
  craft?: { name: string; batches: number; output: number; materials: CraftMaterial[] };
}

export interface CraftEstimate {
  recipe: CraftRecipe;
  batches: number;
  output: number;
  materials: CraftMaterial[];
  cost: number | null;
  directCost?: number | null;
  unitSalePrice: number | null;
  netSale: number | null;
  profit: number | null;
  roi: number | null;
  unitVendorPrice: number | null;
  vendorSale: number | null;
  vendorProfit: number | null;
  vendorRoi: number | null;
}

export type CatalogProfession = RecipeCatalog['professions'][number];

/**
 * Enchanting's profession id. Its recipes mostly enchant an item instead of
 * creating one, so the catalog compiler cannot price them.
 */
export const ENCHANTING_PROFESSION_ID = 333;

/**
 * Explain the recipes the catalog compiler (MarketSyncData
 * `scripts/compile-recipes.py`) left out of a profession. They are counted in
 * `unsupportedCount` but not listed, so the UI can only report how many there
 * are and why. Returns null when every recipe is priced.
 */
export function describeUnpricedRecipes(profession: CatalogProfession): string | null {
  const count = profession.unsupportedCount;
  if (!count) return null;
  const noun = count === 1 ? 'recipe is' : 'recipes are';
  const reason = profession.id === ENCHANTING_PROFESSION_ID
    ? 'most enchants apply to gear and create no item to sell'
    : 'they create no item, several items or a random amount, have unusable reagent data, use their own output as a reagent, or reference items missing from this build';
  return `${count.toLocaleString()} ${profession.name} ${noun} not priced: ${reason}.`;
}

/** Professions to show: any with priced recipes or with recipes counted as unpriced. */
export function visibleProfessions(catalog: Pick<RecipeCatalog, 'professions'>): CatalogProfession[] {
  return catalog.professions.filter((p) => p.recipeCount > 0 || p.unsupportedCount > 0);
}

const catalogs = new Map<FlavorId, Promise<RecipeCatalog>>();

export function loadRecipeCatalog(flavor: FlavorId): Promise<RecipeCatalog> {
  const prior = catalogs.get(flavor);
  if (prior) return prior;
  const path = encodeURIComponent(`datasets/${flavor}/recipes.json`);
  const request = fetch(`/api/datasets/snapshot?path=${path}&v=2`, { signal: AbortSignal.timeout(12000) })
    .then(async (response) => {
      if (response.status === 404) throw new Error('No recipe catalog has been published for this edition.');
      if (!response.ok) throw new Error('Could not load the recipe catalog.');
      const value = await response.json() as RecipeCatalog;
      if (value?.version !== 1 || value.flavor !== flavor || !Array.isArray(value.recipes) ||
          !Array.isArray(value.professions) || !value.items || !value.vendorPrices) {
        throw new Error('The recipe catalog has an unsupported format.');
      }
      return value;
    }).catch((error) => {
      catalogs.delete(flavor);
      throw error;
    });
  catalogs.set(flavor, request);
  return request;
}

interface PlanStock {
  bought: Map<number, number>;
  surplus: Map<number, number>;
}

interface MaterialPlan {
  material: CraftMaterial;
  stock: PlanStock;
}

function sumCosts(materials: CraftMaterial[]): number | null {
  return materials.every((material) => material.cost !== null)
    ? materials.reduce((sum, material) => sum + material.cost!, 0)
    : null;
}

export const CRAFT_SALE_FEE = 5;

export function createCraftEvaluator(catalog: RecipeCatalog, quotes: CraftQuotes) {
  const producers = new Map<number, CraftRecipe[]>();
  for (const recipe of catalog.recipes) {
    const candidates = producers.get(recipe.itemId);
    if (candidates) candidates.push(recipe);
    else producers.set(recipe.itemId, [recipe]);
  }

  function planMaterials(recipe: CraftRecipe, batches: number, strategy: CraftStrategy,
    stock: PlanStock, ancestors: ReadonlySet<number>) {
    return recipe.reagents.map(([item, amount]) => {
      const plan = planMaterial(item, amount * batches, strategy, stock, ancestors);
      stock.bought = plan.stock.bought;
      stock.surplus = plan.stock.surplus;
      return plan.material;
    });
  }

  function planMaterial(itemId: number, quantity: number, strategy: CraftStrategy,
    stock: PlanStock, ancestors: ReadonlySet<number>): MaterialPlan {
    const reused = Math.min(quantity, stock.surplus.get(itemId) ?? 0);
    const needed = quantity - reused;
    if (reused) stock.surplus.set(itemId, stock.surplus.get(itemId)! - reused);
    if (!needed) return { material: { itemId, quantity, source: 'surplus', cost: 0 }, stock };

    const quote = quotes[itemId];
    const alreadyBought = stock.bought.get(itemId) ?? 0;
    const auction = quote && quote.quantity - alreadyBought >= needed ? quote.price : Infinity;
    const vendor = catalog.vendorPrices[itemId] || Infinity;
    const price = Math.min(auction, vendor);
    const buy: CraftMaterial = {
      itemId, quantity, ...(reused ? { reused } : {}),
      source: price === Infinity ? 'missing' : vendor <= auction ? 'vendor' : 'auction',
      cost: price === Infinity ? null : price * needed,
    };

    let bestCraft: MaterialPlan | undefined;
    if (strategy !== 'buy' && !ancestors.has(itemId)) {
      const nextAncestors = new Set(ancestors).add(itemId);
      for (const recipe of producers.get(itemId) ?? []) {
        const batches = Math.ceil(needed / recipe.yield);
        const output = batches * recipe.yield;
        const trial = { bought: new Map(stock.bought), surplus: new Map(stock.surplus) };
        const materials = planMaterials(recipe, batches, strategy, trial, nextAncestors);
        const cost = sumCosts(materials);
        const previous = bestCraft?.material.cost;
        if (bestCraft && (cost === null || (previous != null && previous <= cost))) continue;
        const extra = output - needed;
        if (extra) trial.surplus.set(itemId, (trial.surplus.get(itemId) ?? 0) + extra);
        bestCraft = {
          material: {
            itemId, quantity, cost, source: 'craft', ...(reused ? { reused } : {}),
            craft: { name: recipe.name, batches, output, materials },
          },
          stock: trial,
        };
      }
    }
    if (bestCraft && (
      buy.cost === null ||
      (bestCraft.material.cost !== null && (strategy === 'craft' || bestCraft.material.cost < buy.cost))
    )) return bestCraft;
    if (buy.source === 'auction') stock.bought.set(itemId, alreadyBought + needed);
    return { material: buy, stock };
  }

  return (recipe: CraftRecipe, batches: number, strategy: CraftStrategy): CraftEstimate => {
    const materials = planMaterials(recipe, batches, strategy,
      { bought: new Map(), surplus: new Map() }, new Set([recipe.itemId]));
    const cost = sumCosts(materials);
    const directCost = strategy === 'buy'
      ? cost
      : sumCosts(planMaterials(recipe, batches, 'buy', { bought: new Map(), surplus: new Map() }, new Set([recipe.itemId])));
    const output = recipe.yield * batches;
    const unitSalePrice = quotes[recipe.itemId]?.price ?? null;
    const netSale = unitSalePrice === null ? null : Math.floor(unitSalePrice * output * (100 - CRAFT_SALE_FEE) / 100);
    const profit = cost === null || netSale === null ? null : netSale - cost;
    const rawSell = catalog.sellPrices?.[recipe.itemId];
    const unitVendorPrice = typeof rawSell === 'number' && rawSell > 0 ? rawSell : null;
    const vendorSale = unitVendorPrice === null ? null : unitVendorPrice * output;
    const vendorProfit = cost === null || vendorSale === null ? null : vendorSale - cost;
    return {
      recipe,
      batches,
      output,
      materials,
      cost,
      directCost,
      unitSalePrice,
      netSale,
      profit,
      roi: profit !== null && cost && cost > 0 ? (100 * profit) / cost : null,
      unitVendorPrice,
      vendorSale,
      vendorProfit,
      vendorRoi: vendorProfit !== null && cost && cost > 0 ? (100 * vendorProfit) / cost : null,
    };
  };
}
