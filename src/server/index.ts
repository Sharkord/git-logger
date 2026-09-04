import {
  Permission,
  type PluginContext,
  type UnloadPluginContext,
} from "@sharkord/plugin-sdk";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { THook, TPlugin, TSaveHook } from "../types";
import { format, hookIdFrom, matches, verify } from "../github";

type TStoredHook = THook & { secret: string };

const readBody = async (req: { on: Function }) =>
  new Promise<string>((resolve, reject) => {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk;

      // GitHub caps deliveries at 25 MB; refuse anything absurd early
      if (body.length > 2_000_000) reject(new Error("payload too large")); // 2 MB is plenty for a commit or release
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const clean = (payload: TSaveHook) => {
  const name = String(payload?.name ?? "")
    .trim()
    .slice(0, 80);
  const channelId = Number(payload?.channelId);
  const events = String(payload?.events ?? "*")
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean)
    .join(", ");

  if (!name) throw new Error("A name is required.");
  if (!Number.isInteger(channelId) || channelId <= 0)
    throw new Error("Pick a channel.");
  // an empty list used to fall back to "*", which quietly logged everything
  // when the admin had meant to narrow it down
  if (!events)
    throw new Error("Pick at least one event, or turn on everything GitHub sends.");

  return { name, channelId, events, secret: String(payload?.secret ?? "") };
};

const onLoad = async (ctx: PluginContext<TPlugin>) => {
  const file = path.join(ctx.dataPath, "hooks.json");

  // ponytail: read once at load and rewritten on every change, so this is the
  // source of truth for one server process. Move it to the database if a plugin
  // ever runs in more than one.
  let hooks: TStoredHook[] = [];

  try {
    hooks = await Bun.file(file).json();
  } catch {
    hooks = [];
  }

  const persist = async () => {
    await Bun.write(file, JSON.stringify(hooks, null, 2));

    // what the browser is allowed to see
    return hooks.map(({ secret, ...hook }) => hook);
  };

  /**
   * `requires` below is only the default an admin can widen, and these actions
   * read and write server wide config, so the real check happens here.
   */
  const assertAdmin = async (userId: number) => {
    if (!(await ctx.permissions.userCan(userId, Permission.MANAGE_PLUGINS))) {
      throw new Error("You cannot manage plugins.");
    }
  };

  ctx.actions.register({
    name: "list",
    description: "Lists the configured webhooks.",
    requires: Permission.MANAGE_PLUGINS,
    executes: async (invoker) => {
      await assertAdmin(invoker.userId);

      return hooks.map(({ secret, ...hook }) => hook);
    },
  });

  ctx.actions.register({
    name: "create",
    description: "Creates a webhook.",
    requires: Permission.MANAGE_PLUGINS,
    executes: async (invoker, payload) => {
      await assertAdmin(invoker.userId);

      const hook = clean(payload);

      if (!hook.secret) throw new Error("A secret is required.");

      hooks.push({ ...hook, id: randomBytes(8).toString("hex") });

      return persist();
    },
  });

  ctx.actions.register({
    name: "update",
    description: "Updates a webhook.",
    requires: Permission.MANAGE_PLUGINS,
    executes: async (invoker, payload) => {
      await assertAdmin(invoker.userId);

      const existing = hooks.find((hook) => hook.id === payload?.id);

      if (!existing) throw new Error("That webhook no longer exists.");

      const hook = clean(payload);

      // an empty secret means the admin did not want to rotate it
      Object.assign(existing, hook, { secret: hook.secret || existing.secret });

      return persist();
    },
  });

  ctx.actions.register({
    name: "remove",
    description: "Deletes a webhook.",
    requires: Permission.MANAGE_PLUGINS,
    executes: async (invoker, payload) => {
      await assertAdmin(invoker.userId);

      hooks = hooks.filter((hook) => hook.id !== payload?.id);

      return persist();
    },
  });

  // one wildcard route serves every webhook, so nothing is registered or torn
  // down as they come and go, and the 100 route cap never comes into it
  ctx.http.post("/webhook/*", async (req, res) => {
    const send = (status: number) => {
      res.writeHead(status);
      res.end();
    };

    const hook = hooks.find(
      (candidate) => candidate.id === hookIdFrom(req.url),
    );

    const delivery = String(req.headers["x-github-delivery"] ?? "unknown");
    const event = String(req.headers["x-github-event"] ?? "");

    if (!hook) {
      ctx.logger.debug(
        `delivery ${delivery}: no webhook with id ${hookIdFrom(req.url)}`,
      );

      return send(404);
    }

    const body = await readBody(req);
    const signature = req.headers["x-hub-signature-256"];

    if (
      !verify(
        body,
        hook.secret,
        typeof signature === "string" ? signature : undefined,
      )
    ) {
      ctx.logger.error(
        `delivery ${delivery}: rejected ${event} for "${hook.name}", bad signature`,
      );

      return send(401);
    }

    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(body);
    } catch {
      ctx.logger.error(
        `delivery ${delivery}: ${event} for "${hook.name}" was not JSON, is the webhook's content type application/json?`,
      );

      return send(400);
    }

    // GitHub sends one release as several deliveries, so the action is what
    // separates them, and what the filter can narrow to
    const action = typeof payload.action === "string" ? payload.action : undefined;
    const label = action ? `${event} (${action})` : event;

    // a ping is the single delivery GitHub makes when the webhook is saved, so
    // it is posted whatever the filter says: confirming the hook works is the
    // whole point of it, and a release-only hook needs that confirmation too
    if (event !== "ping" && !matches(hook.events, event, action)) {
      ctx.logger.debug(
        `delivery ${delivery}: ignored ${label} for "${hook.name}", its filter is ${hook.events}`,
      );

      return send(204);
    }

    try {
      const { messageId } = await ctx.messages.send(
        hook.channelId,
        format(event, payload),
        { previews: false },
      );

      ctx.logger.log(
        `delivery ${delivery}: posted ${label} for "${hook.name}" to channel ${hook.channelId} as message ${messageId}`,
      );
    } catch (error) {
      ctx.logger.error(
        `delivery ${delivery}: failed to post ${label} for "${hook.name}" to channel ${hook.channelId}`,
        error,
      );

      return send(500);
    }

    send(204);
  });

  // no ctx.ui.enable(): this plugin fills no slots, and the admin tab is loaded
  // for anyone opening the plugin's page in the server settings regardless
  ctx.logger.log(`git-logger serving ${hooks.length} webhook(s)`);
};

const onUnload = (ctx: UnloadPluginContext) => {
  ctx.logger.log("git-logger unloaded");
};

export { onLoad, onUnload };
