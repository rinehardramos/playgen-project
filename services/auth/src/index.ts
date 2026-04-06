import { buildApp } from './app';

const app = buildApp();

const port = Number(process.env.PORT ?? 3001);
const host = '0.0.0.0';

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

export default app;
