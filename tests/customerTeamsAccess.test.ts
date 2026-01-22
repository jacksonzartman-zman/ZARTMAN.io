import assert from "node:assert";
import { canCustomerViewQuote } from "../src/server/customerTeams/access";

assert.strictEqual(
  canCustomerViewQuote({
    emailMatchesCustomerAccount: true,
    overrideEmailMatchesQuote: false,
    teamMembershipGrantsAccess: false,
  }),
  true,
  "Email match should grant access",
);

assert.strictEqual(
  canCustomerViewQuote({
    emailMatchesCustomerAccount: false,
    overrideEmailMatchesQuote: true,
    teamMembershipGrantsAccess: false,
  }),
  true,
  "Override match should grant access",
);

assert.strictEqual(
  canCustomerViewQuote({
    emailMatchesCustomerAccount: false,
    overrideEmailMatchesQuote: false,
    teamMembershipGrantsAccess: true,
  }),
  true,
  "Team membership should grant access",
);

assert.strictEqual(
  canCustomerViewQuote({
    emailMatchesCustomerAccount: false,
    overrideEmailMatchesQuote: false,
    teamMembershipGrantsAccess: false,
  }),
  false,
  "No signals should deny access",
);

console.log("customerTeamsAccess tests passed");

