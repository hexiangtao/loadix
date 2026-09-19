import type { ApiRequest } from './api/apiTypes';

/** Cross-feature intents are the only data contract exposed to the shell. */
export type ModuleIntent =
  | { type: 'open-loadtest'; request: ApiRequest }
  | { type: 'open-markdown'; markdown: string };
