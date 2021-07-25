const vscode = require('vscode');
const logger = vscode.window.createOutputChannel("Hero Heroku");

function log(message) {
    let d = new Date().toJSON();
    logger.appendLine(`[${d}] ` + (typeof message === 'object' ? JSON.stringify(message) : message));
}

module.exports = log;
module.exports.logger = logger;