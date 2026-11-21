// Backward compatibility alias: routes to direct audio stream engine
const musicHandler = require('./music.js');

module.exports = async function handler(req, res) {
  return musicHandler(req, res);
};
