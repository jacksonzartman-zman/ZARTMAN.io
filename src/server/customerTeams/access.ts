export function canCustomerViewQuote(args: {
  emailMatchesCustomerAccount: boolean;
  overrideEmailMatchesQuote: boolean;
  teamMembershipGrantsAccess: boolean;
}): boolean {
  return Boolean(
    args.emailMatchesCustomerAccount ||
      args.overrideEmailMatchesQuote ||
      args.teamMembershipGrantsAccess,
  );
}

