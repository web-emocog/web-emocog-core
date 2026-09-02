// Legacy compatibility alias. The canonical runtime and shutdown behavior live
// in server.js; this file must never start a divergent Express application.
require('./server').startServer();
