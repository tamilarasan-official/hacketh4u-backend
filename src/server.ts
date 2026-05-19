import { env } from "./config/env";
import { createApp } from "./app";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Hacketh4u backend listening on port ${env.PORT}`);
});
