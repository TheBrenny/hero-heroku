const path = require('path');
const vscode = require('vscode');
const Heroku = require('./heroku');

const dynoStates = ["up", "starting", "idle", "crashed", "down"];
const addonStates = ["provisioned", "provisioning", "", "", "deprovisioned"];

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
        if (!element) return await HerokuTreeProvider.getRootItems();

        if (element instanceof App) {
            let ret = [];
            if (element.dynos.length > 0) {
                ret.push(new GenericItem("Dynos", {
                    contextValue: "dynoBranch",
                    parent: element,
                    iconPath: new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(element.state)))
                }));
            }
            if (element.addons.length > 0) {
                ret.push(new GenericItem("Add-ons", {
                    contextValue: "addonBranch",
                    parent: element,
                    iconPath: new vscode.ThemeIcon("empty-window")
                }));
            }

            // build list and deployments and logs
            
            return ret;
        }

        if (element instanceof Pipeline) {
            return element.stages;
        }
        if (element instanceof PipelineStage) {
            return element.apps;
        }

        if (element instanceof GenericItem) {
            if (element.contextValue === "dynoBranch") {
                return HerokuTreeProvider.getDynoTree(element.parent);
            }
            if (element.contextValue === "addonBranch") {
                return HerokuTreeProvider.getAddonTree(element.parent);
            }
        }
    }

    static async getRootItems() {
        let apps = (await Heroku.get("/apps"));
        apps = apps.map(a => HerokuTreeProvider.getApp(a, {}));
        apps = await Promise.all(apps);

        let pipelines = await Heroku.get("/pipelines");
        pipelines = pipelines.map(pipe => HerokuTreeProvider.getPipeline(pipe, apps));
        pipelines = await Promise.all(pipelines);

        return [...apps, ...pipelines];
    }

    static async getApp(app) {
        app.dynos = await Heroku.get("/apps/" + app.id + "/dynos");
        app.addons = await Heroku.get("/apps/" + app.id + "/addons");
        return new App(app);
    }

    static async getPipeline(pipeline, allApps) {
        pipeline.stages = {};
        let couplings = await Heroku.get("/pipelines/" + pipeline.id + "/pipeline-couplings");

        couplings.forEach(coupling => {
            let appIndex = allApps.findIndex(app => app.id === coupling.app.id);
            if (appIndex === -1) return;
            let a = allApps.splice(appIndex, 1)[0]; // returns an App object
            pipeline.stages[coupling.stage] = pipeline.stages[coupling.stage] || []; // make sure we have an array
            pipeline.stages[coupling.stage].push(a);
        });

        return new Pipeline(pipeline);
    }

    static async getDynoTree(app) {
        let dynos = app.dynos.map(d => new Dyno(d, {
            parent: app
        }));
        return dynos;
    }

    static async getAddonTree(app) {
        let addons = app.addons.map(a => new Addon(a, {
            parent: app
        }));
        return addons;
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
        this.id = app.id;
        this.parent = opts.parent || null;
        this.contextValue = "app";
        this.web_url = app.web_url;
        this.state = getBestState(app.dynos);
        this.dynos = app.dynos;
        this.addons = app.addons;
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
        this.stages = Object.keys(pipeline.stages).map(stage => {
            return new PipelineStage(stage, {
                parent: this,
                apps: pipeline.stages[stage],
            });
        });
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
        for (let a of this.apps) a.parent = this;
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

class Addon extends vscode.TreeItem {
    constructor(addon, opts) {
        super(addon.name);
        opts = opts || {};
        this.label = this.name = addon.name;
        this.parent = opts.parent || null;
        this.contextValue = "addon";
        this.state = addon.state;
        this.tooltip = addon.addon_service.name;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.iconPath = new vscode.ThemeIcon("extensions", new vscode.ThemeColor(Addon.stateColorLookup(this.state)));
    }

    static stateColorLookup(addonState) {
        return Dyno.stateColorLookup(dynoStates[addonStates.findIndex(s => s === addonState)]);
    }
}

class Dyno extends vscode.TreeItem {
    constructor(dyno, opts) {
        super(dyno.name);
        opts = opts || {};
        this.label = this.name = dyno.name;
        this.parent = opts.parent || null;
        this.contextValue = "dyno";
        this.state = dyno.state;
        this.tooltip = "Command: " + dyno.command;
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.iconPath = new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(this.state)));
    }

    static stateColorLookup(dynoState) {
        return "heroheroku.dynoState." + dynoState;
    }
}

function getBestState(statefulArr, states) {
    states = states || dynoStates;
    let state = 4;
    for (let i = 0; i < statefulArr.length && state > 0; i++) {
        const dyState = states.indexOf(statefulArr[i].state);
        if (dyState < state) state = dyState;
    }
    return states[state];
}

module.exports = {
    HerokuTreeProvider,
    GenericItem,
    App,
    Dyno
};