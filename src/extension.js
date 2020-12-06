const promisify = require("util").promisify;
const vscode = require('vscode');
const Heroku = require("./heroku");
const exec = promisify(require('child_process').exec);
const {
	HerokuTreeProvider,
	Dyno
} = require("./herokuDataProvider");
const {
	head,
	sleep,
	promiseWhile
} = require('./promutil');

let tdp;
let tdpRefreshInterval;

function activate(context) {
	if (Heroku.getApiKey() !== "") {
		new Heroku();
	}

	tdp = new HerokuTreeProvider();
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
				commands.refreshAppTree();
				createRefreshInterval();
			}
		}
	});

	// Overall
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.authenticate", commands.authenticate));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.refreshAppTree", commands.refreshAppTree));
	// App
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.openUrl", commands.app.openUrl));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.app.openDashboard", commands.app.openDashboard));
	// Dyno
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.create", commands.dyno.create));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.scale", commands.dyno.scale));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.restart", commands.dyno.restart));
	context.subscriptions.push(vscode.commands.registerCommand("hero-heroku.dyno.stop", commands.dyno.stop));

	console.log('Hero Heroku is active!');
}

function createRefreshInterval() {
	let refreshCallsPerMinute = vscode.workspace.getConfiguration("hero-heroku").get("apiCalls");
	tdpRefreshInterval = setInterval(commands.refreshAppTree, 60000 / refreshCallsPerMinute); // every minute
}

function destroyRefreshInterval() {
	clearInterval(tdpRefreshInterval);
}
const commands = {
	authenticate() {
		// run 'heroku authorizations:create' and store the Token in settings.
		exec("heroku authorizations:create -S -d \"Hero Heroku VSCode Extension\"").then((std) => {
			const stderr = std.stderr;
			const stdout = std.stdout;
			if (stderr) throw {
				name: "HerokuCLI",
				message: stderr.trim()
			};
			return stdout.trim();
		}).then(token => {
			let config = vscode.workspace.getConfiguration("hero-heroku");
			return config.update("apiKey", token, true);
		}).then(() => {
			Heroku.destroy();
			new Heroku();
			vscode.commands.executeCommand("hero-heroku.refreshAppTree");
		}).catch((err) => {
			throw err;
		});

	},
	refreshAppTree() {
		tdp.refresh();
	},
	app: {
		openUrl(app) {
			vscode.env.openExternal(app.web_url)
				.then(success => {
					if (!success) throw {
						name: "HH-UserChoice",
						message: "hero-heroku: User didn't want to open app."
					};
				})
				.then(() => head(app.web_url))
				.then(() => sleep(500))
				.then(() => commands.app.refreshApp(app))
				.catch(error => {
					if (error.name === "HH-UserChoice") console.error(error.message);
					else throw error;
				});
		},
		openDashboard(app) {
			vscode.env.openExternal("https://dashboard.heroku.com/apps/" + app.name);
		},
		async refreshApp(app) {
			tdp.refresh(app);
		}
	},
	dyno: {
		create(dynoBranch) {
			vscode.window.showInputBox({
				ignoreFocusOut: true,
				password: false,
				placeHolder: "npm start... ?",
				prompt: "Enter the command for the new dyno",
			}).then(cmd => {
				if (typeof cmd === "undefined") throw {
					name: "HH-UserChoice",
					message: "hero-heroku: User canceled action."
				};
				return Heroku.post("/apps/" + dynoBranch.parent.name + "/dynos", {
					command: cmd
				});
			}).then(() => {
				commands.app.refreshApp(dynoBranch.parent);
			}).catch(err => {
				if (err.name === "HH-UserChoice") console.error(err.message);
				else throw err;
			});
		},
		scale(dynoBranch) {
			let formations;

			let formID;
			let formQty;
			let remainder = 0;

			Heroku.get("/apps/" + dynoBranch.parent.name + "/formation")
				.then(fList => fList.map(f => {
					remainder += f.quantity;
					return {
						type: f.type,
						quantity: f.quantity,
						command: f.command,
						id: f.id
					};
				})).then(forms => {
					formations = forms;

					let choices = forms.map(f => {
						return `${f.type} ×${f.quantity}: \`${f.command}\` (id: ${f.id})`;
					});

					return vscode.window.showQuickPick(choices, {
						canPickMany: false,
						ignoreFocusOut: true,
					});
				}).then(choice => {
					if (typeof choice === "undefined") throw {
						name: "HH-UserChoice",
						message: "hero-heroku: User canceled action."
					};

					formID = choice.substring(choice.lastIndexOf("(id: ") + 5, choice.lastIndexOf(")"));
					let defaultValue = formations.find(f => f.id === formID).quantity;
					remainder -= defaultValue;

					return vscode.window.showInputBox({
						ignoreFocusOut: true,
						password: false,
						value: defaultValue,
						valueSelection: [0, 1],
						prompt: "Enter the new formation size",
						validateInput(d) {
							if (/[^\d]/.test(d)) return "The value must be an integer >= 0!";
							return "";
							// add more tests to determine the max qty for the formation?
						}
					});
				}).then(qty => {
					if (typeof qty === "undefined") throw {
						name: "HH-UserChoice",
						message: "hero-heroku: User canceled action."
					};

					formQty = qty;
					return Heroku.patch(`/apps/${dynoBranch.parent.name}/formation/${formID}`, {
						quantity: formQty
					});
				}).then(() => {
					commands.app.refreshApp(dynoBranch.parent);
				}).catch(err => {
					if (err.name === "HH-UserChoice") console.error(err.message);
				});
		},
		restart(dyno) {
			let endpoint = `/apps/${dyno.parent.name}/dynos`;
			if (dyno instanceof Dyno) endpoint += `/${dyno.name}`;
			Heroku.delete(endpoint).then(() => commands.app.refreshApp(dyno.parent));
		},
		stop(dyno) {
			Heroku.post(`/apps/${dyno.parent.name}/dynos/${dyno.name}/actions/stop`).then(() => commands.app.refreshApp(dyno.parent));
		}
	},

};

function deactivate() {
	destroyRefreshInterval();
}


module.exports = {
	activate,
	deactivate
};