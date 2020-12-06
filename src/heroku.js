const HerokuClient = require("heroku-client");
const vscode = require("vscode");

class Heroku {
    constructor() {
        if (Heroku.instance === undefined) Heroku.instance = this;
        let apiKey = vscode.workspace.getConfiguration("hero-heroku").get("apiKey");
        this.client = new HerokuClient({
            token: apiKey
        });
    }

    static getInstance() {
        if (Heroku.instance === undefined) new Heroku();
        return Heroku.instance;
    }
    static destroy() {
        Heroku.instance = undefined;
    }

    static getApiKey() {
        return vscode.workspace.getConfiguration("hero-heroku").get("apiKey");
    }

    static get(target) {
        return Heroku.getInstance().client.get(target);
    }
    static put(target, data) {
        return Heroku.getInstance().client.put(target, {body: data});
    }
    static post(target, data) {
        return Heroku.getInstance().client.post(target, {body: data});
    }
    static patch(target, data) {
        return Heroku.getInstance().client.patch(target, {body: data});
    }
    static delete(target) {
        return Heroku.getInstance().client.delete(target);
    }
}

module.exports = Heroku;