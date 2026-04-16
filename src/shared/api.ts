export { resolveApiAssetUrl, type StreamCallbacks } from "./api/core";
import { accountSettingsClient } from "./api/accountSettingsClient";
import { agentClient } from "./api/agentClient";
import { chatClient } from "./api/chatClient";
import { contentClient } from "./api/contentClient";
import { extensionClient } from "./api/extensionClient";
import { pluginClient } from "./api/pluginClient";
import { providerClient } from "./api/providerClient";
import { writerClient } from "./api/writerClient";

export const api = {
  ...accountSettingsClient,
  ...agentClient,
  ...providerClient,
  ...extensionClient,
  ...pluginClient,
  ...chatClient,
  ...contentClient,
  ...writerClient
};
