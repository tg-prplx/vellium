export { resolveApiAssetUrl, type StreamCallbacks } from "./api/core";
import { accountSettingsClient } from "./api/accountSettingsClient";
import { chatClient } from "./api/chatClient";
import { contentClient } from "./api/contentClient";
import { providerClient } from "./api/providerClient";
import { writerClient } from "./api/writerClient";

export const api = {
  ...accountSettingsClient,
  ...providerClient,
  ...chatClient,
  ...contentClient,
  ...writerClient
};
