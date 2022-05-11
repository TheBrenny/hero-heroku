const vscode = require('vscode');
const Heroku = require("./heroku");
const HerokuTreeProvider = require("./herokuDataProvider").HerokuTreeProvider;
const commands = require("./commands");
const logger = require("./logger");
const WordBuilder = require("mini-word-smith");

let tdpRefreshInterval;

async function activate(context) {
	logger("Activating...");

	logger("Generating word lists");
	if(WordBuilder.adjectives.length === 1) await WordBuilder.buildScript.downloadWordLists(150, 150);
	WordBuilder.reloadWordlists();

	let keyUpdated = await Heroku.hasUpdatedKey(context);
	if(!keyUpdated) {
		logger("Clearing old API Key");
		await Heroku.hasUpdatedKey(context, true).then(Heroku.clearApiKey);
		let updateMessage = "If you used Hero Heroku before 10 May 2022, your API Key has been cleared due to Heroku revoking all API Keys. Please update your API Key.";
		let updateAction = "Update API Key";
		let skip = "Do it manually";
		commands.showInfoMessage(updateMessage, updateAction, skip).then((action) => action === updateAction ? commands.authenticate() : null);
	}

	logger("API Key set? " + (Heroku.hasApiKey()).toString());
	if(Heroku.hasApiKey()) {
		new Heroku();
	}

	logger("Creating TDP");
	let tdp = new HerokuTreeProvider();
	let tv = vscode.window.createTreeView("hero-heroku", {
		showCollapseAll: true,
		treeDataProvider: tdp,
		canSelectMany: false
	});
	tdp.setTreeView(tv);
	// vscode.window.registerTreeDataProvider("hero-heroku", tdp);

	logger("Creating Config Change Listener");
	vscode.workspace.onDidChangeConfiguration((e) => {
		if(e.affectsConfiguration("hero-heroku.apiCalls")) {
			logger("apiCalls config changed");
			destroyRefreshInterval();
			if(Heroku.hasApiKey()) createRefreshInterval();
		}
		if(e.affectsConfiguration("hero-heroku.apiKey")) {
			logger("apiKey config changed");
			destroyRefreshInterval();
			Heroku.destroy();
			if(Heroku.hasApiKey()) {
				new Heroku();
				commands.refreshTreeView();
				createRefreshInterval();
			}
		}
	});

	logger("Registering commands");
	// Overall
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.authenticate", commands.authenticate.bind(this)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.refreshAppTree", commands.refreshTreeView.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.reloadAppTree", commands.refreshTreeView.bind(this, tdp, null, true)));
	// App
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.create", commands.app.create.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.openUrl", commands.app.openUrl.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.openDashboard", commands.app.openDashboard.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.configVars", commands.app.getConfigVars.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.updateConfigVars", commands.app.tryUpdateConfigVars.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.deploy.git", commands.app.deployViaGit.bind(this, tdp)));
	// Dyno
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.create", commands.dyno.create.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.scale", commands.dyno.scale.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.restart", commands.dyno.restart.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.stop", commands.dyno.stop.bind(this, tdp)));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.logs", commands.dyno.logs.bind(this, tdp)));

	logger("Activated");
}

function createRefreshInterval() {
	logger("Refresh interval created");
	let refreshCallsPerMinute = vscode.workspace.getConfiguration("hero-heroku").get("apiCalls");
	tdpRefreshInterval = setInterval(commands.refreshDirtyTreeView, 60000 / refreshCallsPerMinute); // every minute
}

function destroyRefreshInterval() {
	logger("Refresh interval cleared");
	clearInterval(tdpRefreshInterval);
}

function deactivate() {
	logger("Deactivating Hero Heroku");
	destroyRefreshInterval();
}


module.exports = {
	activate,
	deactivate
};