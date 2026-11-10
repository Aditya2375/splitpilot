'use strict';
// Vercel entry point. Static files in /public are served by the platform.
const { handler } = require('../app');
module.exports = (req, res) => handler(req, res);
