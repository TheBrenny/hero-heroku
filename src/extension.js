const vscode = require('vscode');
const Heroku = require("./heroku");
const HerokuTreeProvider = require("./herokuDataProvider").HerokuTreeProvider;
const commands = require("./commands");

let tdpRefreshInterval;

function activate(context) {
	if (Heroku.getApiKey() !== "") {
		new Heroku();
	}

	let tdp = new HerokuTreeProvider();
	vscode.window.createTreeView("hero-heroku", {
		treeDataProvider: tdp
	});
	vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration("hero-heroku.apiCalls")) {
			destroyRefreshInterval();
			if (Heroku.getApiKey() !== "") createRefreshInterval();
		}
		if (e.affectsConfiguration("hero-heroku.apiKey")) {
			destroyRefreshInterval();
			Heroku.destroy();
			if (Heroku.getApiKey() !== "") {
				new Heroku();
				commands.refreshTreeView();
				createRefreshInterval();
			}
		}
	});

	// Overall
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.authenticate", commands.authenticate.bind(this)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.refreshAppTree", commands.refreshTreeView.bind(this, tdp)));
	// App
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.openUrl", commands.app.openUrl.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.openDashboard", commands.app.openDashboard.bind(this, tdp)));
	// Dyno
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.create", commands.dyno.create.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.scale", commands.dyno.scale.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.restart", commands.dyno.restart.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.stop", commands.dyno.stop.bind(this, tdp)));

	console.log('Hero Heroku is active!');
}

function createRefreshInterval() {
	let refreshCallsPerMinute = vscode.workspace.getConfiguration("hero-heroku").get("apiCalls");
	tdpRefreshInterval = setInterval(commands.refreshTreeView, 60000 / refreshCallsPerMinute); // every minute
}

function destroyRefreshInterval() {
	clearInterval(tdpRefreshInterval);
}

function deactivate() {
	destroyRefreshInterval();
}


module.exports = {
	activate,
	deactivate
};