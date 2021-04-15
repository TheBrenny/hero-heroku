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
        return element;
    }
    async getParent(element) {
        return element.parent;
    }

    async getChildren(element) {
        if (!element) return await this.getRootItems();

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

        if (element instanceof Pipeline) {
            let stageKeys = Object.keys(element.stages);
            return stageKeys.map(stage => {
                return new PipelineStage(stage, {
                    parent: element,
                    apps: element.stages[stage],
                });
            });
        }
        if (element instanceof PipelineStage) {
            return element.apps;
        }

        if (element instanceof GenericItem) {
            if (element.contextValue === "dynoBranch") {
                return this.getDynoTree(element.parent);
            }
        }
    }

    async getRootItems() {
        let apps = (await Heroku.get("/apps"));
        apps = apps.map(a => this.getApp(a));
        apps = await Promise.all(apps);

        let pipelines = await Heroku.get("/pipelines");
        pipelines = pipelines.map(pipe => this.getPipeline(pipe, apps));
        pipelines = await Promise.all(pipelines);

        return [...apps, ...pipelines];
    }

    async getApp(app) {
        let dynos = await Heroku.get("/apps/" + app.id + "/dynos");
        app.dynos = dynos;
        return new App(app);
    }

    async getPipeline(pipeline, allApps) {
        pipeline.stages = {};
        let couplings = await Heroku.get("/pipelines/" + pipeline.id + "/pipeline-couplings");

        couplings.forEach(coupling => {
            let appIndex = allApps.findIndex(app => app.appID === coupling.app.id);
            if (appIndex === -1) return;
            let a = allApps.splice(appIndex, 1)[0]; // returns an App object
            pipeline.stages[coupling.stage] = pipeline.stages[coupling.stage] || []; // make sure we have an array
            pipeline.stages[coupling.stage].push(a);
        });

        return new Pipeline(pipeline);
    }

    async getDynoTree(app) {
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
        this.extra = opts.extra;
    }
}

class App extends vscode.TreeItem {
    constructor(app, opts) {
        super(app.name);
        opts = opts || {};
        this.label = this.name = app.name;
        this.appID = app.id;
        this.parent = null;
        this.contextValue = "app";
        this.web_url = app.web_url;
        this.state = getBestState(app.dynos);
        this.dynos = app.dynos;
        this.tooltip = `State: ${this.state}`;
        this.collapsibleState = opts.collapsibleState || vscode.TreeItemCollapsibleState.Collapsed;
        this.iconPath = App.getIconPath(this.state);
    }

    static getIconPath(dynoState) {
        return path.join(__dirname, "..", "res", "dyno_states", "heroku-dyno-" + dynoState + ".svg");
    }
}

class Pipeline extends vscode.TreeItem {
    constructor(pipeline, opts) {
        super(pipeline.name);
        opts = opts || {};
        this.label = this.name = pipeline.name;
        this.parent = opts.parent || null;
        let allApps = Object.values(pipeline.stages).reduce((a, c) => a = a.concat(c), []);
        this.state = getBestState(allApps);
        this.stages = pipeline.stages;
        this.contextValue = "pipeline";
        this.tooltip = allApps.length + " app" + (allApps.length !== 1 ? "s" : "");
        this.collapsibleState = opts.collapsibleState || vscode.TreeItemCollapsibleState.Collapsed;
        this.iconPath = new vscode.ThemeIcon("server", new vscode.ThemeColor("heroheroku.dynoState." + this.state));
    }
}

class PipelineStage extends vscode.TreeItem {
    constructor(stage, opts) {
        super(stage);
        opts = opts || {};
        this.label = this.name = (stage.substr(0, 1).toUpperCase() + stage.substr(1).toLowerCase());
        this.parent = opts.parent || null;
        this.contextValue = "stage";
        this.tooltip = opts.apps.length + " app" + (opts.apps.length !== 1 ? "s" : "");
        this.apps = opts.apps;
        this.collapsibleState = opts.collapsibleState || vscode.TreeItemCollapsibleState.Collapsed;
        this.state = getBestState(opts.apps);
        this.iconPath = PipelineStage.getStageImage(stage, this.state);
    }

    static getStageImage(stage, state) {
        let colour = new vscode.ThemeColor("heroheroku.dynoState." + state);
        let icon = "cloud";

        if (stage === "test") icon = "beaker";
        else if (stage === "review") icon = "checklist";
        else if (stage === "development") icon = "tools";
        else if (stage === "staging") icon = "cloud-upload";
        else if (stage === "production") icon = "cloud";

        return new vscode.ThemeIcon(icon, colour);
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

function getBestState(statefulArr) {
    let state = 4;
    for (let i = 0; i < statefulArr.length && state > 0; i++) {
        const dyState = dynoStates.indexOf(statefulArr[i].state);
        if (dyState < state) state = dyState;
    }
    return dynoStates[state];
}

module.exports = {
    HerokuTreeProvider,
    GenericItem,
    App,
    Dyno
};