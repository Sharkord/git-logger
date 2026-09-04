import { createCallAction, useStoreSelector } from "@sharkord/plugin-sdk/client";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@sharkord/ui";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { buildEvents, KNOWN, parseEvents } from "../events";
import type { THook, TPlugin } from "../types";

const callAction = createCallAction<TPlugin>();

const Webhooks = memo(() => {
  const channels = useStoreSelector((state) => state.channels);

  const [hooks, setHooks] = useState<THook[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // the draft the form edits. `picked` and `other` are kept apart from a single
  // events string so typing in "Other events" is not rewritten mid-keystroke.
  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState(0);
  const [secret, setSecret] = useState("");
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");

  // compared as a literal rather than importing ChannelType: the enum is in the
  // server half of the SDK, and there is no reason to reach into it from here
  const textChannels = useMemo(
    () => channels.filter((channel) => channel.type === "TEXT"),
    [channels],
  );

  const isNew = selectedId === "";
  const selected = hooks.find((hook) => hook.id === selectedId);

  const run = useCallback(async (work: () => Promise<THook[]>) => {
    setBusy(true);
    setError("");

    try {
      const list = await work();

      setHooks(list);

      return list;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");

      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    run(() => callAction("list", {})).finally(() => setLoading(false));
  }, [run]);

  const edit = useCallback((hook: THook | undefined) => {
    const events = parseEvents(hook?.events ?? "*");

    setSelectedId(hook?.id ?? "");
    setName(hook?.name ?? "");
    setChannelId(hook?.channelId ?? 0);
    setSecret("");
    setAll(events.all);
    setPicked(events.picked);
    setOther(events.other);
    setError("");
    setCopied(false);
  }, []);

  const onSave = useCallback(async () => {
    const events = buildEvents(all, picked, other);

    const payload = { name, channelId, events, secret };
    const known = hooks.map((hook) => hook.id);
    const list = await run(() =>
      selected
        ? callAction("update", { ...payload, id: selected.id })
        : callAction("create", payload),
    );

    if (!list) return;

    setSecret("");

    // creating selects the new webhook, because its URL is the next thing the
    // admin needs and it is only known once the server has made it
    const created = list.find((hook) => !known.includes(hook.id));

    if (created) edit(created);
  }, [all, channelId, edit, hooks, name, other, picked, run, secret, selected]);

  const onDelete = useCallback(async () => {
    if (!selected || !confirm(`Delete "${selected.name}"?`)) return;

    if (await run(() => callAction("remove", { id: selected.id })))
      setSelectedId(undefined);
  }, [run, selected]);

  const url = selected
    ? `${location.origin}/plugins/git-logger/webhook/${selected.id}`
    : "";

  const onCopy = useCallback(() => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url]);

  const channelName = useCallback(
    (id: number) =>
      textChannels.find((channel) => channel.id === id)?.name ?? "unknown",
    [textChannels],
  );

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="w-full shrink-0 md:w-72">
        <Card className="py-2">
          <CardContent className="flex flex-col gap-1 px-2">
            {loading ? (
              <span className="text-muted-foreground p-4 text-center text-sm">
                Loading…
              </span>
            ) : hooks.length ? (
              hooks.map((hook) => (
                <button
                  key={hook.id}
                  type="button"
                  onClick={() => edit(hook)}
                  className={`hover:bg-accent hover:text-accent-foreground w-full rounded-md px-3 py-2 text-left ${
                    hook.id === selectedId ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  <span className="block truncate text-sm font-medium">
                    {hook.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    #{channelName(hook.channelId)} ·{" "}
                    {hook.events === "*" ? "all events" : hook.events}
                  </span>
                </button>
              ))
            ) : (
              <span className="text-muted-foreground p-4 text-center text-sm">
                No webhooks yet.
              </span>
            )}
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="mt-2 w-full"
          onClick={() => edit(undefined)}
        >
          New webhook
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        {selected || isNew ? (
          <Card>
            <CardHeader>
              <CardTitle>{selected ? selected.name : "New webhook"}</CardTitle>
              <CardDescription>
                Point a GitHub webhook here and its events are posted to the
                channel you choose.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="gl-name">Name</Label>
                <Input
                  id="gl-name"
                  value={name}
                  placeholder="my-org/my-repo"
                  onChange={(event) => setName(event.target.value)}
                />
                <span className="text-muted-foreground text-xs">
                  Only shown here, so you can tell your webhooks apart.
                </span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gl-channel">Channel</Label>
                <Select
                  value={channelId ? String(channelId) : undefined}
                  onValueChange={(value) => setChannelId(Number(value))}
                >
                  <SelectTrigger id="gl-channel" className="w-full">
                    <SelectValue placeholder="Pick a channel…" />
                  </SelectTrigger>
                  <SelectContent>
                    {textChannels.map((channel) => (
                      <SelectItem key={channel.id} value={String(channel.id)}>
                        #{channel.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <Label>Everything GitHub sends</Label>
                    <span className="text-muted-foreground text-sm">
                      Log every event this webhook delivers.
                    </span>
                  </div>
                  <Switch checked={all} onCheckedChange={setAll} />
                </div>

                {!all && (
                  <div className="space-y-3">
                    {KNOWN.map((event) => (
                      <div
                        key={event.value}
                        className="flex items-center justify-between gap-4"
                      >
                        <div className="flex flex-col">
                          <Label>{event.label}</Label>
                          {event.hint && (
                            <span className="text-muted-foreground text-sm">
                              {event.hint}
                            </span>
                          )}
                        </div>
                        <Switch
                          checked={picked.includes(event.value)}
                          onCheckedChange={(on) =>
                            setPicked((current) =>
                              on
                                ? [...current, event.value]
                                : current.filter((name) => name !== event.value),
                            )
                          }
                        />
                      </div>
                    ))}

                    <div className="space-y-2">
                      <Label htmlFor="gl-other">Other events</Label>
                      <Input
                        id="gl-other"
                        value={other}
                        placeholder="deployment, release:published"
                        onChange={(event) => setOther(event.target.value)}
                      />
                      <span className="text-muted-foreground text-xs">
                        Comma separated. Any GitHub event name works, the ones
                        above just get a nicer line. Add <code>:action</code> to
                        narrow one, like <code>release:published</code>.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="gl-secret">Secret</Label>
                <Input
                  id="gl-secret"
                  type="password"
                  value={secret}
                  // a webhook secret, not a credential to remember, so the
                  // password managers are waved off
                  autoComplete="off"
                  data-bwignore="true"
                  data-lpignore="true"
                  data-1p-ignore=""
                  data-form-type="other"
                  placeholder={
                    selected ? "Leave blank to keep the current secret" : ""
                  }
                  onChange={(event) => setSecret(event.target.value)}
                />
                <span className="text-muted-foreground text-xs">
                  Must match the secret on the GitHub webhook. Deliveries that
                  are not signed with it are rejected. Never shown again once
                  saved.
                </span>
              </div>

              {selected && (
                <div className="space-y-2">
                  <Label>Payload URL</Label>
                  <div className="flex items-center gap-2">
                    <code className="bg-muted text-muted-foreground min-w-0 flex-1 overflow-x-auto rounded-md px-3 py-2 text-xs whitespace-nowrap">
                      {url}
                    </code>
                    <Button variant="outline" size="sm" onClick={onCopy}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    Paste this into GitHub, with content type application/json.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                {selected ? (
                  <Button variant="destructive" disabled={busy} onClick={onDelete}>
                    Delete
                  </Button>
                ) : (
                  <span />
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setSelectedId(undefined)}
                  >
                    Cancel
                  </Button>
                  <Button disabled={busy} onClick={onSave}>
                    {busy ? "Saving…" : selected ? "Save changes" : "Create"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <p className="text-muted-foreground py-12 text-center text-sm">
                {hooks.length
                  ? "Pick a webhook to edit it, or create another one."
                  : "Create a webhook to start logging GitHub events into a channel."}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
});

export { Webhooks };
