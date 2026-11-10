'use strict';
const http = require('http');
const { handler } = require('./app');
const port = process.env.PORT || 3000;
http.createServer(handler).listen(port, () => console.log('SplitPilot on http://localhost:' + port));
