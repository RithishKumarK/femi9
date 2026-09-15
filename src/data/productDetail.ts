// The ProductExtra type moved to @femi9/core alongside services/products.ts,
// which maps database rows onto it. Re-exported so existing
// `from '@/data/productDetail'` imports keep working.
//
// Only the TYPE ever lived here. The `EXTRAS` map and the `sampleReviews` array
// that used to sit below were hardcoded copies of catalog data — every product
// page now resolves its gallery, rating, long copy, features, specs and reviews
// from the database through `services/products.ts`, so a shipped fixture could
// only ever disagree with what the admin console had published.
export type { ProductExtra } from '@femi9/core/types/catalog'
