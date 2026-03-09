export function generateManifest(machineName: string): string {
  const displayName = `ATC ${machineName.charAt(0).toUpperCase() + machineName.slice(1)}`;

  return `display_information:
  name: "${displayName}"
  description: Remote GitHub Copilot orchestration via Slack
  background_color: "#1a1a2e"
  long_description: |
    Air Traffic lets you orchestrate GitHub Copilot CLI agents on your machines
    remotely from Slack, including from your phone. Create per-project channels,
    send prompts, approve tool executions, and manage sessions.

features:
  bot_user:
    display_name: "${displayName}"
    always_online: true
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false

oauth_config:
  scopes:
    bot:
      - channels:manage
      - channels:read
      - channels:history
      - channels:join
      - chat:write
      - chat:write.public
      - files:read
      - files:write
      - reactions:read
      - reactions:write
      - groups:read
      - groups:history
      - groups:write
      - users:read
      - im:history
      - im:read
      - im:write

settings:
  event_subscriptions:
    bot_events:
      - message.channels
      - message.groups
      - message.im
      - app_home_opened
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
`;
}
