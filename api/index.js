let handler;

module.exports = async (req, res) => {
  if (!handler) {
    const { default: app } = await import('../server/app.js');
    handler = app;
  }
  handler(req, res);
};
