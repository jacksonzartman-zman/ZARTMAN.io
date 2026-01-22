import assert from "node:assert";
import { CUSTOMER_TEAMS_SCHEMA, deriveCustomerTeamsFeatureEnabledFromSchema } from "../src/server/customerTeams/schema";

assert.deepStrictEqual(
  CUSTOMER_TEAMS_SCHEMA.teams.requiredColumns.sort(),
  ["id", "customer_account_id", "name", "created_at"].sort(),
  "customer_teams required columns mismatch",
);

assert.deepStrictEqual(
  CUSTOMER_TEAMS_SCHEMA.members.requiredColumns.sort(),
  ["team_id", "user_id", "role", "created_at"].sort(),
  "customer_team_members required columns mismatch",
);

assert.deepStrictEqual(
  CUSTOMER_TEAMS_SCHEMA.quotesTeamId.requiredColumns.sort(),
  ["id", "team_id"].sort(),
  "quotes.team_id gate required columns mismatch",
);

assert.strictEqual(
  deriveCustomerTeamsFeatureEnabledFromSchema({ hasTeams: true, hasMembers: true, hasQuotesTeamId: true }),
  true,
  "Expected teams feature enabled when schema is complete",
);

assert.strictEqual(
  deriveCustomerTeamsFeatureEnabledFromSchema({ hasTeams: false, hasMembers: true, hasQuotesTeamId: true }),
  false,
  "Expected teams feature disabled when customer_teams missing",
);

assert.strictEqual(
  deriveCustomerTeamsFeatureEnabledFromSchema({ hasTeams: true, hasMembers: false, hasQuotesTeamId: true }),
  false,
  "Expected teams feature disabled when customer_team_members missing",
);

assert.strictEqual(
  deriveCustomerTeamsFeatureEnabledFromSchema({ hasTeams: true, hasMembers: true, hasQuotesTeamId: false }),
  false,
  "Expected teams feature disabled when quotes.team_id missing",
);

console.log("customerTeamsSchema tests passed");

