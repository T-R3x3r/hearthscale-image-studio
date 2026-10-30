import {
  App,
  McpUiMessageResultSchema,
  PostMessageTransport,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps';
import { extensionCall } from '@hearthscale/app/view';
import type { ViewExtensionNotification, ViewHostContext, ViewHostMethods } from '@hearthscale/app';

export const app = new App({ name: 'Image Studio', version: '0.1.0' }, {}, { autoResize: false });

/** A typed `hearthscale/*` extension call. */
export const call = extensionCall(app);

/** A typed `hearthscale/ui/*` request every view may make. */
export function host<M extends keyof ViewHostMethods>(
  method: M,
  params: ViewHostMethods[M]['params'],
): Promise<ViewHostMethods[M]['result']> {
  return app.request({ method, params } as never, McpUiMessageResultSchema) as never;
}

/** Saves a picture where the person picks, from a click. */
export function download(name: string, blob: Blob): Promise<{ isError?: boolean }> {
  return app.request(
    {
      method: 'ui/download-file',
      params: { contents: [{ type: 'resource', resource: { uri: `file:///${name}`, mimeType: blob.type, blob } }] },
    } as never,
    McpUiMessageResultSchema,
  ) as never;
}

/** Runs a tool of the app's backend and answers its structured result. */
export async function tool<T>(name: string, args: Record<string, unknown>, label?: string): Promise<T> {
  const result = await app.callServerTool({
    name,
    arguments: args,
    ...(label ? { _meta: { 'hearthscale/label': label } } : {}),
  });
  if (result.isError) {
    const words = result.content
      ?.map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .trim();
    throw new Error(words || `${name} failed`);
  }
  return result.structuredContent as T;
}

type Notification = ViewExtensionNotification;
type Listener<M extends Notification['method']> = (params: Extract<Notification, { method: M }>['params']) => void;
const listeners = new Map<string, Set<(params: unknown) => void>>();

/** Hears one kind of `hearthscale/*` notification; answers the unsubscribe. */
export function on<M extends Notification['method']>(method: M, fn: Listener<M>): () => void {
  const set = listeners.get(method) ?? new Set();
  set.add(fn as (params: unknown) => void);
  listeners.set(method, set);
  return () => set.delete(fn as (params: unknown) => void);
}

app.fallbackNotificationHandler = async ({ method, params }) => {
  for (const fn of listeners.get(method) ?? []) fn(params);
};

export async function connect(): Promise<void> {
  await app.connect(new PostMessageTransport(window.parent, window.parent));
}

export function hostContext(): McpUiHostContext & Partial<ViewHostContext> {
  return (app.getHostContext() ?? {}) as McpUiHostContext & Partial<ViewHostContext>;
}

/** The address a file of the app's data folder streams from. */
export function fileUrl(path: string): string {
  return hostContext()['hearthscale/dataBytes']!.url + path.split('/').map(encodeURIComponent).join('/');
}

/** The address an asset of the app streams from. */
export function assetUrl(asset: string): string {
  return hostContext()['hearthscale/assetBytes']!.url + asset;
}

/** The absolute path of a file or folder of the app's data folder. */
export function dataPath(path: string): string {
  const root = hostContext()['hearthscale/data']!.path;
  const separator = root.includes('\\') ? '\\' : '/';
  return [root, ...path.split('/')].join(separator);
}

/** The words of a refusal, without the protocol's prefix. */
export function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^MCP error -?\d+:\s*/, '');
}
