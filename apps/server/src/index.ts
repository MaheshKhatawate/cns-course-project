import { config } from './config.js';
import { createApp } from './app.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`Auth server listening on http://localhost:${config.port}`);
});
