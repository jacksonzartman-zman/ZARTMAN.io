import { schemaGate } from "@/server/db/schemaContract";

export const CUSTOMER_TEAMS_SCHEMA = {
  teams: {
    relation: "customer_teams",
    requiredColumns: ["id", "customer_account_id", "name", "created_at"],
  },
  members: {
    relation: "customer_team_members",
    requiredColumns: ["team_id", "user_id", "role", "created_at"],
  },
  quotesTeamId: {
    relation: "quotes",
    requiredColumns: ["id", "team_id"],
  },
} as const;

export function deriveCustomerTeamsFeatureEnabledFromSchema(input: {
  hasTeams: boolean;
  hasMembers: boolean;
  hasQuotesTeamId: boolean;
}): boolean {
  return Boolean(input.hasTeams && input.hasMembers && input.hasQuotesTeamId);
}

export async function isCustomerTeamsSchemaReady(): Promise<boolean> {
  const [hasTeams, hasMembers, hasQuotesTeamId] = await Promise.all([
    schemaGate({
      enabled: true,
      relation: CUSTOMER_TEAMS_SCHEMA.teams.relation,
      requiredColumns: [...CUSTOMER_TEAMS_SCHEMA.teams.requiredColumns],
      warnPrefix: "[customer_teams]",
      warnKey: "customer_teams:teams",
    }),
    schemaGate({
      enabled: true,
      relation: CUSTOMER_TEAMS_SCHEMA.members.relation,
      requiredColumns: [...CUSTOMER_TEAMS_SCHEMA.members.requiredColumns],
      warnPrefix: "[customer_teams]",
      warnKey: "customer_teams:members",
    }),
    schemaGate({
      enabled: true,
      relation: CUSTOMER_TEAMS_SCHEMA.quotesTeamId.relation,
      requiredColumns: [...CUSTOMER_TEAMS_SCHEMA.quotesTeamId.requiredColumns],
      warnPrefix: "[customer_teams]",
      warnKey: "customer_teams:quotes_team_id",
    }),
  ]);

  return deriveCustomerTeamsFeatureEnabledFromSchema({
    hasTeams,
    hasMembers,
    hasQuotesTeamId,
  });
}

