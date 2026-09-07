/**
 * Public API of the `pricing` module.
 *
 * Deliberately NOT exported: nothing else. There is no way to read the rate
 * card row-by-row through this module — a caller asks what a case costs and
 * gets a number. Ops edits rates through the database, not through an endpoint
 * that would need its own authorization story.
 */
export { PricingService, SpecialtyClosedError } from './internal/pricing.service';
export type { Quote, QuoteInput } from './internal/pricing.service';
export { PricingModule } from './pricing.module';
