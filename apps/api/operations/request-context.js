const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
const validRequestId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
module.exports = { runWithRequest: (requestId, callback) => storage.run({ requestId }, callback),
  currentRequestId: () => storage.getStore()?.requestId, validRequestId };
