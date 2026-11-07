// Not ported: the entry of ./router, a transport that sends each message
// through the transport of its channel.

const { RouterTransport, createRouter } = require('./router-transport.js');

module.exports = { RouterTransport, createRouter };
