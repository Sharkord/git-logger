/**
 * Sends a signed, fake GitHub delivery to a webhook, to test it without pushing
 * anything real.
 *
 *   bun fake-event.ts <url>                 # a push
 *   bun fake-event.ts <url> release         # any event below, or any name at all
 *   bun fake-event.ts <url> push --secret=… # when the lookup cannot find it
 *
 * The secret is taken from --secret, then GIT_LOGGER_SECRET, then the webhook's
 * own entry in the plugin's hooks.json, found through SHARKORD_PLUGINS_PATH.
 */
import { createHmac } from "node:crypto";
import path from "node:path";
import { format, hookIdFrom } from "./src/github";

const repository = {
  full_name: "acme/rocket",
  html_url: "https://github.com/acme/rocket",
};

const sender = { login: "octocat" };

const payloads: Record<string, unknown> = {
  ping: {
    repository,
    sender,
    zen: "Keep it logically awesome.",
    hook_id: 674596631,
    hook: { type: "Repository", events: ["push", "release"] },
  },

  push: {
    repository,
    sender,
    ref: "refs/heads/main",
    pusher: { name: "octocat" },
    commits: [
      {
        id: "9f2c1a4d8e77b3105c6de0a1f4b8927e3d15c0aa",
        url: "https://github.com/acme/rocket/commit/9f2c1a4",
        message: "Fix the booster throttle\n\nIt was pointing the wrong way.",
      },
      {
        id: "3b81f0c5a9d24e6f7108b2c3d4e5f60718293a4b",
        url: "https://github.com/acme/rocket/commit/3b81f0c",
        message: "Add a test for the throttle",
      },
    ],
  },

  pull_request: {
    repository,
    sender,
    action: "opened",
    number: 42,
    pull_request: {
      html_url: "https://github.com/acme/rocket/pull/42",
      title: "Throttle the booster before launch",
    },
  },

  issues: {
    repository,
    sender,
    action: "opened",
    issue: {
      number: 7,
      html_url: "https://github.com/acme/rocket/issues/7",
      title: "Booster points the wrong way",
    },
  },

  issue_comment: {
    repository,
    sender,
    action: "created",
    issue: { number: 7, html_url: "https://github.com/acme/rocket/issues/7" },
    comment: { body: "Confirmed on my machine too." },
  },

  release: {
    repository,
    sender,
    action: "published",
    release: {
      tag_name: "v1.4.0",
      name: "Throttle Control",
      prerelease: false,
      html_url: "https://github.com/acme/rocket/releases/tag/v1.4.0",
      // roughly what GitHub's generated notes look like
      body: [
        "## What's Changed",
        "* Fix the booster throttle by @octocat in https://github.com/acme/rocket/pull/42",
        "* Rename `boost_helper_fn` for clarity by @hubot in https://github.com/acme/rocket/pull/43",
        "* Bump the launch window by @octocat",
        "",
        "## New Contributors",
        "* @hubot made their first contribution",
        "",
        "**Full Changelog**: https://github.com/acme/rocket/compare/v1.3.0...v1.4.0",
      ].join("\n"),
    },
  },

  star: { repository, sender, action: "created" },

  workflow_run: {
    repository,
    sender,
    action: "completed",
    workflow_run: {
      name: "CI",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/acme/rocket/actions/runs/1",
    },
  },
};

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const positional = args.filter((arg) => !arg.startsWith("--"));
const [url, event = "push"] = positional;

if (!url) {
  console.error("usage: bun fake-event.ts <url> [event] [--secret=…]");
  process.exit(1);
}

/** The webhook's own secret, from the plugin's data folder next to the server. */
const secretFromHooks = async () => {
  const plugins = process.env.SHARKORD_PLUGINS_PATH;

  if (!plugins) return undefined;

  const file = path.join(plugins, "..", "plugin-data", "git-logger", "hooks.json");

  try {
    const hooks = await Bun.file(file).json();
    const id = hookIdFrom(new URL(url).pathname);

    return hooks.find((hook: { id: string }) => hook.id === id)?.secret;
  } catch {
    return undefined;
  }
};

const secret = flag("secret") ?? process.env.GIT_LOGGER_SECRET ?? (await secretFromHooks());

if (!secret) {
  console.error(
    "No secret found. Pass --secret=…, set GIT_LOGGER_SECRET, or point SHARKORD_PLUGINS_PATH at your server so it can be read from hooks.json.",
  );
  process.exit(1);
}

// an event with no sample still gets sent, to exercise the generic formatter
const payload = payloads[event] ?? { repository, sender, action: "created" };
const body = JSON.stringify(payload);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "GitHub-Hookshot/fake",
    "X-GitHub-Event": event,
    "X-GitHub-Delivery": crypto.randomUUID(),
    "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
  },
  body,
});

console.log(`${event} → ${response.status} ${response.statusText}`);

// a filtered-out delivery answers 204 too, so this cannot claim it was posted
if (response.status === 204)
  console.log(
    `Accepted. If it passes the webhook's event filter, the channel gets:\n  ${format(event, payload as any)}`,
  );

if (response.status === 401)
  console.log("Bad signature: the secret does not match the one on the webhook.");

if (response.status === 404)
  console.log("No webhook with that id, or the plugin is disabled.");
