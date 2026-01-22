import assert from "node:assert";
import { resolveSupplierActivityEmptyState } from "../src/app/(portals)/supplier/activityEmptyState";

const assignmentsDisabled = resolveSupplierActivityEmptyState({
  supplierExists: true,
  hasEvents: false,
  reason: "assignments-disabled",
});

assert(assignmentsDisabled, "Expected empty state copy for assignments-disabled");
assert.strictEqual(
  assignmentsDisabled?.title,
  "Workspace activity will appear here",
  "Assignments disabled title mismatch",
);

const supplierExistsCopy = resolveSupplierActivityEmptyState({
  supplierExists: true,
  hasEvents: false,
  reason: undefined,
});

assert.strictEqual(
  supplierExistsCopy?.description,
  "We’ll stream search request assignments and bid updates here as they happen.",
  "Supplier copy mismatch",
);

const onboardingCopy = resolveSupplierActivityEmptyState({
  supplierExists: false,
  hasEvents: false,
  reason: undefined,
});

assert.strictEqual(
  onboardingCopy?.title,
  "Activity unlocks after onboarding",
  "Onboarding copy mismatch",
);

const hasEvents = resolveSupplierActivityEmptyState({
  supplierExists: true,
  hasEvents: true,
  reason: "assignments-disabled",
});

assert.strictEqual(hasEvents, null, "Non-empty feeds should not render empty state copy");

console.log("resolveSupplierActivityEmptyState tests passed");
