const path = require('path');
const vscode = require('vscode');
const Heroku = require('./heroku');
const logger = require('./logger');

const dynoStates = ["up", "starting", "idle", "crashed", "down"];
const addonStates = ["provisioned", "provisioning", "", "", "deprovisioned"];

class HerokuTreeProvider {
    constructor(_workspaceRoot) {
        this._changeEvent = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._changeEvent.event;
    }

    refresh(element) {
        logger("Firing element change");
        this._changeEvent.fire(element);
    }

    async getTreeItem(element) {
        return element;
    }

    async getParent(element) {
        return element.parent;
    }

    async getChildren(element) {
        if(!element) return await HerokuTreeProvider.getRootItems();

        if(element instanceof App) {
            let ret = [];
            if(element.dynos.length > 0) {
                ret.push(new GenericItem("Dynos", {
                    contextValue: "dynoBranch",
                    parent: element,
                    iconPath: new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(element.state)))
                }));
            }
            if(element.addons.length > 0) {
                ret.push(new GenericItem("Add-ons", {
                    contextValue: "addonBranch",
                    parent: element,
                    iconPath: new vscode.ThemeIcon("empty-window")
                }));
            }

            // build list and deployments and logs

            return ret;
        }

        if(element instanceof Pipeline) {
            return element.stages;
        }
        if(element instanceof PipelineStage) {
            return element.apps;
        }

        if(element instanceof GenericItem) {
            if(element.contextValue === "dynoBranch") {
                return HerokuTreeProvider.getDynoTree(element.parent);
            }
            if(element.contextValue === "addonBranch") {
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
            if(appIndex === -1) return;
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

class HDPTreeItem extends vscode.TreeItem {
    constructor(name, context, parent, opts) {
        super(name);
        this.setName(name);
        this.setContext(context);
        this.setParent(parent);
        this.setOptions(opts);

        this.children = [];
        this.dirty = false;
    }
    setName(name) {
        this.label = this.name = name;
        return this;
    }
    setContext(context) {
        this.contextValue = context;
        return this;
    }
    setParent(parent) {
        if((this.parent ?? null) === parent) return this;
        this.parent = parent;
        this.parent.addChild(this);
        return this;
    }
    setOptions(opts) {
        this.tooltip = opts?.tooltip;
        this.collapsibleState = opts?.collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed;
        this.iconPath = opts?.iconPath;
    }

    addChild(child) {
        if(Array.isArray(child)) {
            child.forEach(c => this.addChild(c));
            return this;
        }
        if(this.children.includes(child)) return this;

        this.children.push(child);
        child.setParent(this);
        return this;
    }

    removeChild(child) {
        if(!this.children.includes(child)) return this;

        this.children = this.children.filter(c => c !== child);
        child.setParent(null);
        return this;
    }
}

class GenericItem extends HDPTreeItem {
    constructor(name, context, parent, opts) {
        super(name, context, parent, opts);
    }
}

class App extends HDPTreeItem {
    constructor(app, parent, opts) {
        super(app.name, "app", parent, opts);
        this.id = app.id;
        this.web_url = app.web_url;
        this.state = getBestState(app.dynos);
        this.dynos = app.dynos;
        this.addons = app.addons;

        this.setOptions({
            tooltip: `State: ${this.state}`,
            iconPath: App.getIconPath(this.state)
        });
    }

    static getIconPath(dynoState) {
        return path.join(__dirname, "..", "res", "dyno_states", "heroku-dyno-" + dynoState + ".svg");
    }
}

class Pipeline extends HDPTreeItem {
    constructor(pipeline, parent, opts) {
        super(pipeline.name, "pipeline", parent, opts);
        this.allApps = Object.values(pipeline.stages).reduce((a, c) => a = a.concat(c), []);
        this.state = getBestState(this.allApps);
        this.stages = Object.keys(pipeline.stages).map(stage => {
            return new PipelineStage(stage, this, {
                apps: pipeline.stages[stage],
            });
        });

        this.setOptions({
            tooltip: pluralize(this.allApps.length, "app"),
            iconPath: new vscode.ThemeIcon("server", new vscode.ThemeColor("heroheroku.dynoState." + this.state)),
        });
    }
}

class PipelineStage extends HDPTreeItem {
    constructor(stage, parent, opts) {
        super(stage, "stage", parent, opts);
        this.stage = stage;
        this.setName((stage.substr(0, 1).toUpperCase() + stage.substr(1).toLowerCase()));
        this.apps = opts.apps;
        this.state = getBestState(opts.apps);

        this.addChild(this.apps);
        this.setOptions({
            tooltip: pluralize(this.apps.length, "app"),
            iconPath: PipelineStage.getStageImage(stage, this.state),
        });
    }

    static getStageImage(stage, state) {
        let colour = new vscode.ThemeColor("heroheroku.dynoState." + state);
        let icon = "cloud";

        if(stage === "test") icon = "beaker";
        else if(stage === "review") icon = "checklist";
        else if(stage === "development") icon = "tools";
        else if(stage === "staging") icon = "cloud-upload";
        else if(stage === "production") icon = "cloud";

        return new vscode.ThemeIcon(icon, colour);
    }
}

class Addon extends HDPTreeItem {
    constructor(addon, parent, opts) {
        super(addon.name, "addon", parent, opts);
        this.state = addon.state;
        this.setOptions({
            tooltip: addon.addon_service.name,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            iconPath: new vscode.ThemeIcon("extensions", new vscode.ThemeColor(Addon.stateColorLookup(this.state)))
        });
    }

    static stateColorLookup(addonState) {
        return Dyno.stateColorLookup(dynoStates[addonStates.findIndex(s => s === addonState)]);
    }
}

class Dyno extends HDPTreeItem {
    constructor(dyno, parent, opts) {
        super(dyno.name, "dyno", parent, opts);
        this.state = dyno.state;
        this.setOptions({
            tooltip: "Command: " + dyno.command,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            iconPath: new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(this.state))),
        });
    }

    static stateColorLookup(dynoState) {
        return "heroheroku.dynoState." + dynoState;
    }
}

function getBestState(statefulArr, states) {
    states = states || dynoStates;
    let state = 4;
    for(let i = 0; i < statefulArr.length && state > 0; i++) {
        const dyState = states.indexOf(statefulArr[i].state);
        if(dyState < state) state = dyState;
    }
    return states[state];
}

function pluralize(count, noun) {
    return count + " " + noun + (count !== 1 ? "s" : "");
}

module.exports = {
    HerokuTreeProvider,
    GenericItem,
    App,
    Pipeline,
    PipelineStage,
    Addon,
    Dyno,
};