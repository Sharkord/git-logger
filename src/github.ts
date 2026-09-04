import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies GitHub's `X-Hub-Signature-256` header against the raw body. */
const verify = (
  body: string,
  secret: string,
  signature: string | undefined,
) => {
  if (!secret || !signature) return false;

  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  // timingSafeEqual throws on a length mismatch, so guard it first
  return (
    expected.length === signature.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
};

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

const link = (url: unknown, text: unknown) =>
  url ? `<a href="${escape(url)}">${escape(text)}</a>` : escape(text);

/** First line of a commit message, trimmed to something a chat line can hold. */
const title = (value: unknown) => {
  const line = String(value ?? "").split("\n")[0]!;

  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

const inline = (raw: string) => {
  const parked: string[] = [];
  const park = (html: string) => `\u0000${parked.push(html) - 1}\u0000`;

  // escaped first, so a quote or angle bracket cannot break out of an href
  let text = escape(raw);

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => park(`<a href="${url}">${label}</a>`),
  );

  text = text.replace(/https?:\/\/[^\s]+/g, (url) => {
    const trimmed = url.replace(/[.,;:)]+$/, "");

    return (
      park(`<a href="${trimmed}">${trimmed}</a>`) + url.slice(trimmed.length)
    );
  });

  text = text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<![\w*_])[*_]([^*_\n]+)[*_](?![\w*_])/g, "<em>$1</em>");

  return text.replace(
    /\u0000(\d+)\u0000/g,
    (_, index) => parked[Number(index)]!,
  );
};

const notes = (body: unknown, limit = 2000) => {
  const source = String(body ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  if (!source) return "";

  const clipped = source.length > limit;
  const lines = (clipped ? source.slice(0, limit) : source)
    .split("\n")
    // a clipped body loses its last line, which is probably half a sentence
    .slice(0, clipped ? -1 : undefined)
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.*)$/);

      if (heading) return `<strong>${inline(heading[1]!)}</strong>`;

      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);

      if (bullet) return `• ${inline(bullet[1]!)}`;

      // a horizontal rule carries nothing once the styling is gone
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return "";

      return inline(line);
    });

  const rendered = lines
    .join("\n")
    // any run of blank lines becomes one gap
    .replace(/\n{2,}/g, "\n\n")
    .trim()
    .split("\n")
    .join("<br>");

  return clipped ? `${rendered}<br>…` : rendered;
};

type TPayload = Record<string, any>;

const formatters: Record<string, (p: TPayload) => string> = {
  ping: (p) => {
    const events: string[] = p.hook?.events ?? [];
    const sending = events.length
      ? ` Sending ${events.map((event) => `<code>${escape(event)}</code>`).join(", ")}.`
      : "";

    return `<strong>Webhook connected.</strong>${sending}${
      p.zen ? `<br><em>${escape(p.zen)}</em>` : ""
    }`;
  },

  push: (p) => {
    const branch = String(p.ref ?? "").replace("refs/heads/", "");
    const commits: TPayload[] = p.commits ?? [];
    const head = commits
      .slice(0, 5)
      .map(
        (c) =>
          `<br>${link(c.url, String(c.id ?? "").slice(0, 7))} ${escape(title(c.message))}`,
      )
      .join("");
    const rest =
      commits.length > 5 ? `<br><em>and ${commits.length - 5} more</em>` : "";

    return `<strong>${escape(p.pusher?.name)}</strong> pushed ${commits.length} commit(s) to <code>${escape(branch)}</code>${head}${rest}`;
  },

  pull_request: (p) =>
    `<strong>${escape(p.sender?.login)}</strong> ${escape(p.action)} pull request ${link(p.pull_request?.html_url, `#${p.number}`)}: ${escape(title(p.pull_request?.title))}`,

  issues: (p) =>
    `<strong>${escape(p.sender?.login)}</strong> ${escape(p.action)} issue ${link(p.issue?.html_url, `#${p.issue?.number}`)}: ${escape(title(p.issue?.title))}`,

  issue_comment: (p) =>
    `<strong>${escape(p.sender?.login)}</strong> ${escape(p.action)} a comment on ${link(p.issue?.html_url, `#${p.issue?.number}`)}: ${escape(title(p.comment?.body))}`,

  release: (p) => {
    const release = p.release ?? {};
    const named =
      release.name && release.name !== release.tag_name
        ? ` — ${escape(title(release.name))}`
        : "";
    const changelog = notes(release.body);

    return `<strong>${escape(p.sender?.login)}</strong> ${escape(p.action)} ${
      release.prerelease ? "pre-release" : "release"
    } ${link(release.html_url, release.tag_name)}${named}${
      changelog ? `<br><br>${changelog}` : ""
    }`;
  },

  star: (p) =>
    `<strong>${escape(p.sender?.login)}</strong> ${p.action === "deleted" ? "unstarred" : "starred"} the repository`,

  workflow_run: (p) =>
    `Workflow ${link(p.workflow_run?.html_url, p.workflow_run?.name)} ${escape(p.workflow_run?.status)}${p.workflow_run?.conclusion ? ` (${escape(p.workflow_run.conclusion)})` : ""}`,
};

const format = (event: string, payload: TPayload) => {
  const repo = link(
    payload.repository?.html_url,
    payload.repository?.full_name,
  );
  const body =
    formatters[event]?.(payload) ??
    `<strong>${escape(payload.sender?.login)}</strong> triggered <code>${escape(event)}</code>${payload.action ? ` (${escape(payload.action)})` : ""}`;

  return `<p>${repo ? `[${repo}] ` : ""}${body}</p>`;
};

/**
 * Whether a hook subscribed to `spec` wants this delivery.
 *
 * An entry is an event name, optionally narrowed to a single action with
 * `event:action`. GitHub sends one release as several deliveries (`created`,
 * `edited`, `released`, `published`), so `release` takes all of them while
 * `release:published` takes only the one that means it went live.
 */
const matches = (spec: string, event: string, action?: string) =>
  spec.trim() === "*" ||
  spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => {
      const [name, wanted] = entry.split(":");

      return name === event && (!wanted || wanted === action);
    });

const hookIdFrom = (url: string | undefined) =>
  (url ?? "")
    .split("?")[0]!
    .split("/webhook/")[1]
    ?.split("/")
    .filter(Boolean)[0] ?? "";

export { format, hookIdFrom, matches, verify };
