const HerokuClient = require("heroku-client");
const vscode = require("vscode");
const logger = require("./logger");

class Heroku {
    constructor() {
        logger("Constructing `Heroku` class");
        if(Heroku.instance === undefined) Heroku.instance = this;
        let apiKey = Heroku.getApiKey();
        this.client = new HerokuClient({
            token: apiKey
        });
    }

    static getInstance() {
        if(Heroku.instance === undefined) new Heroku();
        return Heroku.instance;
    }
    static destroy() {
        Heroku.instance = undefined;
    }

    static hasApiKey() {
        return vscode.workspace.getConfiguration("hero-heroku").get("apiKey", "") !== "";
    }
    static getApiKey() {
        return vscode.workspace.getConfiguration("hero-heroku").get("apiKey", "");
    }
    static clearApiKey() {
        return new Promise(async (resolve, _reject) => {
            let global = await vscode.workspace.getConfiguration("hero-heroku").update("apiKey", undefined, vscode.ConfigurationTarget.Global).then(() => true).catch(() => false);
            let workspace = await vscode.workspace.getConfiguration("hero-heroku").update("apiKey", undefined, vscode.ConfigurationTarget.Workspace).then(() => true).catch(() => false);
            let wsFolder = await vscode.workspace.getConfiguration("hero-heroku").update("apiKey", undefined, vscode.ConfigurationTarget.WorkspaceFolder).then(() => true).catch(() => false);

            resolve([global, workspace, wsFolder]);
        });
    }
    static async hasUpdatedKey(context, value) {
        if(value !== undefined) await context.globalState.update("hero-heroku-key-updated", value)
        return context.globalState.get("hero-heroku-key-updated", false)
    }

    static get(target) {
        logger("Heroku.get");
        return Heroku.getInstance().client.get(target);
    }
    static put(target, data) {
        logger("Heroku.put");
        return Heroku.getInstance().client.put(target, {
            body: data
        });
    }
    static post(target, data) {
        logger("Heroku.post");
        return Heroku.getInstance().client.post(target, {
            body: data
        });
    }
    static patch(target, data) {
        logger("Heroku.patch");
        return Heroku.getInstance().client.patch(target, {
            body: data
        });
    }
    static delete(target) {
        logger("Heroku.delete");
        return Heroku.getInstance().client.delete(target);
    }
}

module.exports = Heroku;