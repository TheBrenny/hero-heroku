const path = require('path');
const vscode = require('vscode');
const Heroku = require('./heroku');
const logger = require('./logger');

const dynoStates = ["up", "starting", "idle", "crashed", "down"];
const addonStates = ["provisioned", "provisioning", "", "", "deprovisioned"];

let htpInstance = null;
class HerokuTreeProvider {
    constructor(_workspaceRoot) {
        if(!!htpInstance) return htpInstance;
        htpInstance = this;

        this._changeEvent = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._changeEvent.event;
        this.rootNode = {
            children: [],
            everything: []
        };
    }

    refresh(element) {
        logger("Firing element change");
        element?.makeDirty();
        this._changeEvent.fire(element);
    }

    async getTreeItem(element) {
        logger("Getting tree item: " + element?.name);

        if(typeof element === "string") {
            // we only want to find root items for now.
            // MAYBE we should cache all items in the tree?
            element = this.rootNode.children.items.find(i => i.name === element);
        }

        // refresh item if dirty
        if(element.dirty) {
            await element.refresh();
        }

        return element;
    }

    async getParent(element) {
        logger("Getting parent of: " + element?.name);

        return element.parent;
    }

    async getChildren(element) {
        logger("Getting children of: " + element?.name);

        if(!element) {
            this.rootNode.children = await this.getRootItems();
            return this.rootNode.children;
        }
        return element.children;
    }

    async getRootItems() {
        let apps = (await Heroku.get("/apps"));
        apps = apps.map(a => treeItemGenerators.generateApp(a));
        apps = await Promise.all(apps);

        let pipelines = await Heroku.get("/pipelines");
        pipelines = pipelines.map(pipe => treeItemGenerators.generatePipeline(pipe, apps));
        pipelines = await Promise.all(pipelines);

        // This isn't all apps, only the standalones and pipelines -- the root items
        return [...apps, ...pipelines].sort((a, b) => a.name.localeCompare(b.name));
    }

    static get instance() {
        if(!htpInstance) htpInstance = new HerokuTreeProvider();
        return htpInstance;
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
        this.parent?.addChild(this);
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

    makeDirty() {
        if(this.dirty) return this;
        this.dirty = true;
        this.parent?.makeDirty();
        this.children.forEach(c => c?.makeDirty());
        return this;
    }

    async refresh() {}
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
        this.git_url = app.git_url;
        this.state = getBestState(app.dynos);
        this.dynos = app.dynos;
        this.addons = app.addons;

        this.setOptions({
            tooltip: `State: ${this.state}`,
            iconPath: App.getIconPath(this.state)
        });

        // Create the dyno tree now!
        this.addChild(new DynoBranch(this));
        if(this.addons.length > 0) {
            this.addChild(new AddonBranch(this));
        }
    }

    async refresh() {
        if(!this.dirty) return this;

        // Definitely not the best way to do this! 😭
        Object.assign(this, (await treeItemGenerators.generateApp(this)));
        this.dirty = false;
        return this;
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

        this.addChild(this.stages);
        this.setOptions({
            tooltip: pluralize(this.allApps.length, "app"),
            iconPath: new vscode.ThemeIcon("server", new vscode.ThemeColor("heroheroku.dynoState." + this.state)),
        });
    }

    async refresh() {
        if(!this.dirty) return this;

        // This is even worse! What happens when a new app is added?!
        Object.assign(this, (await treeItemGenerators.generatePipeline(this, this.allApps)));
        this.dirty = false;
        return this;
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

class AddonBranch extends HDPTreeItem {
    constructor(parent, opts) {
        super("Addons", "addonBranch", parent, opts);
        // this.state = getBestState(addon.apps);
        this.appParent = parent;
        this.setOptions({
            iconPath: new vscode.ThemeIcon("empty-window")
        });

        this.addChild(parent.addons.map(a => new Addon(a, this)));
    }
}

class DynoBranch extends HDPTreeItem {
    constructor(parent, opts) {
        super("Dynos", "dynoBranch", parent, opts);
        // this.state = getBestState(addon.apps);
        this.appParent = parent;
        this.setOptions({
            iconPath: new vscode.ThemeIcon("server-process", new vscode.ThemeColor(Dyno.stateColorLookup(parent.state)))
        });

        this.addChild(parent.dynos.map(d => new Dyno(d, this)));
        // MAYBE: add a "Create Dyno" action?
    }
}

class Addon extends HDPTreeItem {
    constructor(addon, parent, opts) {
        super(addon.name, "addon", parent, opts);
        this.state = addon.state;
        this.appParent = parent.appParent;
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
        this.appParent = parent.appParent;
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

const treeItemGenerators = {
    generateApp(app) {
        return Promise.all([
            Heroku.get("/apps/" + app.id + "/dynos"),
            Heroku.get("/apps/" + app.id + "/addons"),
        ]).then(([dynos, addons]) => {
            app.dynos = dynos;
            app.addons = addons;
            return new App(app);
        });
    },
    generatePipeline(pipeline, allApps) {
        pipeline.stages = {};
        return Heroku.get("/pipelines/" + pipeline.id + "/pipeline-couplings").then(couplings => {
            couplings.forEach(coupling => {
                let appIndex = allApps.findIndex(app => app.id === coupling.app.id);
                if(appIndex === -1) return;
                let a = allApps.splice(appIndex, 1)[0]; // returns an App object
                pipeline.stages[coupling.stage] = pipeline.stages[coupling.stage] || []; // make sure we have an array
                pipeline.stages[coupling.stage].push(a);
            });

            return new Pipeline(pipeline);
        });
    },
};

module.exports = {
    HerokuTreeProvider,
    HDPTreeItem,
    GenericItem,
    App,
    Pipeline,
    PipelineStage,
    AddonBranch,
    DynoBranch,
    Addon,
    Dyno,
};