export default {
  schema: './server/db/schema.js',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: { url: './kitchen-keeper.db' }
};
