import type { TPluginTabs } from "@sharkord/plugin-sdk/client";
import { Webhooks } from "./webhooks";

// this plugin fills no interface slots, it only adds a tab to its own page in
// the server settings, which only someone who can manage plugins ever sees
const tabs: TPluginTabs = [
  { id: "webhooks", label: "Webhooks", component: Webhooks },
];

export { tabs };
