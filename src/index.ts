import type { Env } from "./config";
import { createProductionApp } from "./app";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createProductionApp(env).fetch(request);
  }
};
