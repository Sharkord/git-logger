type THook = {
  id: string;
  name: string;
  channelId: number;
  events: string;
};

type TSaveHook = {
  name: string;
  channelId: number;
  events: string;
  secret: string;
};

type TPlugin = {
  actions: {
    list: { payload: Record<string, never>; response: THook[] };
    create: { payload: TSaveHook; response: THook[] };
    update: { payload: TSaveHook & { id: string }; response: THook[] };
    remove: { payload: { id: string }; response: THook[] };
  };
};

export type { THook, TPlugin, TSaveHook };
