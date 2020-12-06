const path = require('path');
const vscode = require('vscode');
const Heroku = require('./heroku');

const dynoStates = ["up", "starting", "idle", "crashed", "down"];

class HerokuTreeProvider {
    constructor(_workspaceRoot) {
        this._changeEvent = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._changeEvent.event;
    }

    refresh(element) {
        this._changeEvent.fire(element);
    }

    async getTreeItem(element) {
        if (element instanceof App) return (await this.getAppTree([element]))[0];
        return element;
    }
    getParent(element) {
        return element.parent;
    }
    getChildren(element) {
        if (!element) {
            return Heroku.get("/apps").then(a => this.getAppTree(a));
        }

        if (element instanceof App) {
            return [
                new GenericItem("Dynos", {
                    contextValue: "dynoBranch",
                    parent: element,
                    iconPath: new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(element.state)))
                }),
                new GenericItem("Add-ons", {
                    contextValue: "addonBranch",
                    parent: element,
                    iconPath: new vscode.ThemeIcon("empty-window")
                }),
                // build list and deployments and logs
            ];
        }

        if (element instanceof GenericItem && element.contextValue === "dynoBranch") {
            return this.getDynoTree(element.parent);
        }
    }

    getAppTree(apps) {
        return new Promise(async (resolve, _reject) => {
            let proms = [];

            apps.forEach(app => {
                app.state = "down";

                let p = Heroku.get("/apps/" + app.name + "/dynos").then(dynos => {
                    let state = 4;

                    for (let i = 0; i < dynos.length && state > 0; i++) {
                        const dyState = dynoStates.indexOf(dynos[i].state);
                        if (dyState < state) state = dyState;
                    }
                    app.state = dynoStates[state];

                    app.dynos = dynos;
                });
                proms.push(p);
            });

            await Promise.all(proms);
            resolve(apps.map(app => new App(app)));
        });
    }

    getDynoTree(app) {
        let dynos = app.dynos.map(d => new Dyno(d, {
            parent: app
        }));
        return dynos;
    }
}

class GenericItem extends vscode.TreeItem {
    constructor(name, opts) {
        super(name);
        opts = opts || {};
        this.label = this.name = name;
        this.parent = opts.parent;
        this.contextValue = opts.contextValue;
        this.tooltip = opts.tooltip;
        this.collapsibleState = opts.collapsibleState !== undefined ? opts.collapsibleState : vscode.TreeItemCollapsibleState;
        this.iconPath = opts.iconPath;
    }
}

class App extends vscode.TreeItem {
    constructor(app, opts) {
        super(app.name);
        opts = opts || {};
        this.label = this.name = app.name;
        this.parent = null;
        this.contextValue = "app";
        this.web_url = app.web_url;
        this.state = app.state;
        this.dynos = app.dynos;
        this.tooltip = `State: ${this.state}`;
        this.collapsibleState = opts.collapsibleState || vscode.TreeItemCollapsibleState.Collapsed;
        this.iconPath = App.getIconPath(this.state);
    }

    static getIconPath(dynoState) {
        return path.join(__dirname, "..", "res", "dyno_states", "heroku-dyno-" + dynoState + ".svg");
    }
}

class Dyno extends vscode.TreeItem {
    constructor(dyno, opts) {
        super(dyno);
        opts = opts || {};
        this.label = this.name = dyno.name;
        this.parent = opts.parent || null;
        this.contextValue = "dyno" + (dyno.state === "down" ? "Down" : "Up");
        this.state = dyno.state;
        this.tooltip = "Command: " + dyno.command;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.iconPath = new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(dyno.state)));
    }

    static stateColorLookup(dynoState) {
        return "heroheroku.dynoState." + dynoState;
    }
}

module.exports = {
    HerokuTreeProvider,
    GenericItem,
    App,
    Dyno
};