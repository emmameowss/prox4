// The shared Slack client.
//
// This lives apart from main.ts so that modules main.ts imports (images.ts)
// can use the client without forming an import cycle back through main.ts.

import { WebClient } from "@slack/web-api";

import { token } from "./secrets_wrapper";

export const web = new WebClient(token);
