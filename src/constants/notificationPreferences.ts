import type {
  NotificationPreferenceChannel,
  NotificationPreferenceRole,
} from "@/types/notificationPreferences";

export type NotificationToggleOption = {
  eventType: string;
  channel: NotificationPreferenceChannel;
  role: NotificationPreferenceRole;
  label: string;
  description: string;
  inputName: string;
};

const EMAIL_CHANNEL: NotificationPreferenceChannel = "email";

function buildOption(props: {
  eventType: string;
  role: NotificationPreferenceRole;
  label: string;
  description: string;
}): NotificationToggleOption {
  return {
    eventType: props.eventType,
    role: props.role,
    channel: EMAIL_CHANNEL,
    label: props.label,
    description: props.description,
    inputName: props.eventType,
  };
}

export const CUSTOMER_NOTIFICATION_OPTIONS: NotificationToggleOption[] = [
  buildOption({
    eventType: "quote_message_posted",
    role: "customer",
    label: "New messages on my quotes",
    description: "Email me when admins or suppliers reply in shared threads.",
  }),
  buildOption({
    eventType: "quote_won",
    role: "customer",
    label: "A supplier is awarded",
    description: "Alerts you when a project moves into the awarded phase.",
  }),
];

export const SUPPLIER_NOTIFICATION_OPTIONS: NotificationToggleOption[] = [
  buildOption({
    eventType: "quote_message_posted",
    role: "supplier",
    label: "Messages on assigned RFQs",
    description: "Ping me when customers or admins add updates in shared threads.",
  }),
  buildOption({
    eventType: "bid_won",
    role: "supplier",
    label: "Bid awarded",
    description: "Notify me when my proposal wins and kickoff is ready.",
  }),
];
