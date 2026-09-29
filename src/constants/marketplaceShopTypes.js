/**
 * Customer browse tiles and the shop signup allow-list.
 * Figma node 46:352, in display order.
 * Not the FSSAI license set — that stays in shopOnboardingService.
 */
const MARKETPLACE_SHOP_TYPES = [
  'Food & Restaurants',
  'Grocery & Supermarket',
  'Meat & Seafood',
  'Fashion & Clothing',
  'Electronics & Electrical',
  'Home & Kitchen',
  'Hardware & Tools',
  'Beauty & Personal Care',
  'Sports & Fitness',
  'Books & Stationery',
  'Automotive Spares & Lubricants',
  'Baby & Kids',
  'Pet Supplies',
  'Gifts, Flowers & Accessories'
];

const MARKETPLACE_SHOP_TYPE_SET = new Set(MARKETPLACE_SHOP_TYPES);

function isMarketplaceShopType(value) {
  return typeof value === 'string' && MARKETPLACE_SHOP_TYPE_SET.has(value.trim());
}

module.exports = {
  MARKETPLACE_SHOP_TYPES,
  isMarketplaceShopType
};
