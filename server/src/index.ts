import 'dotenv/config';
import { createApp } from './app.js';

const port = process.env.PORT || 8080;
const app = createApp();

app.listen(port, () => {
  console.log(`Meigaku Question Box API server listening on port ${port}`);
});
