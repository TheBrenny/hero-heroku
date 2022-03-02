const path = require('path');
const vscode = require('vscode');
const Heroku = require('./heroku');
const logger = require('./logger');

let htpInstance = null;
class HerokuTreeProvider {
    constructor(_workspaceRoot) {
        if(!!htpInstance) return htpInstance;
        htpInstance = this;

        this.treeView = null;
        this._changeEvent = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._changeEvent.event;
        this.rootNode = {
            _children: [],
            _createApp: new CommandItem(this, "Create App", "hero-heroku.app.create", [], {iconPath: "add"}),
            // _createPipeline: new CommandItem(this, "Create Pipeline", "hero-heroku.pipeline.create", [], {iconPath: "add"}),
            get children() {
                return [
                    ...this._children,
                    this._createApp,
                    // this._createPipeline
                ];
            },
            allApps: [],
        };
    }
    setTreeView(tv) {
        this.treeView = tv;
    }

    async getTreeItem(element) { // returns the visual representation of the element
        logger("Getting tree item: " + element?.name);
        return element?.treeItem;
    }

    async getChildren(element) {
        logger("Getting children of: " + element?.name);

        if(!element) {
            if(this.rootNode._children.length == 0) await this.generateRootItems();
            return this.rootNode.children;
        }
        return element.children;
    }
    async refresh(element) {
        logger("Firing element change");
        if(element != null) {
            element = element.rootNode;
            element.makeDirty();
            await element.refresh();
        } else {
            await Promise.all(this.rootNode._children.map(child => {
                child.makeDirty();
                return child.refresh();
            }));
        }
        this._changeEvent.fire(element);
    }
    async reveal() {
        logger("Reveal not implemented");
    }

    async onDidChangeSelection(event) {
        if(event.selection[0].onSelect) return event.selection[0].onSelect();
    }

    clearChildren() {
        this.rootNode._children.splice(0, this.rootNode._children.length);
    }

    async generateRootItems() {
        let apps = await Heroku.get(`/apps`);
        apps = apps.map(appInfo => new App(null, appInfo));
        this.rootNode.allApps = apps.slice();

        let pipelines = await Heroku.get(`/pipelines`);
        pipelines = pipelines.map(pipelineInfo => new Pipeline(null, pipelineInfo));
        await Promise.all(this.rootNode.allApps.map(app => app.refresh()));
        await Promise.all(pipelines.map(pipeline => pipeline.refresh(apps)));

        this.rootNode._children.splice(0, this.rootNode._children.length);
        this.rootNode._children.push(...[
            ...apps,
            ...pipelines
        ].sort((a, b) => a.name.localeCompare(b.name)));
        return this.rootNode._children;
    }

    async addApp(herokuAppInfo) {
        let app = new App(null, herokuAppInfo);
        this.rootNode._children.push(app);
        await app.refresh();
        // We don't refresh the entire tree here because what if we're adding multiple apps?
    }

    static get instance() {
        if(!htpInstance) htpInstance = new HerokuTreeProvider();
        return htpInstance;
    }
}

class Parentable {
    constructor(parent) {
        this.parent = parent ?? null;
    }
    get rootNode() {
        if(this.parent) return this.parent.rootNode;
        return this;
    }
}

class HDPItem extends Parentable {
    constructor(parent, name) {
        super(parent);
        this.name = name;
        this._dirty = true;
        this._treeItem = new vscode.TreeItem(this.name, vscode.TreeItemCollapsibleState.Collapsed);
        this._treeItem.id = this.hID;
    }
    get children() {return [];}
    get treeItem() {return this._treeItem;}
    async refresh() {
        this._dirty = false;
    }
    get dirty() {
        return this._dirty;
    }
    makeDirty() {
        this._dirty = true;
        this.parent?.makeDirty();
    }
}

class Pipeline extends HDPItem {
    constructor(parent, plInfo) {
        super(parent, plInfo.name);
        this.hID = plInfo.id;
        this._treeItem.contextValue = "pipeline";
        this.branches = {}; // stage -> PipelineStage
        this.couplings = {}; // stage -> array of apps
    }
    get children() {
        return (async () => {
            if(!this.dirty && !!this.branches.all) return this.branches.all;
            await this.refresh();
            this.branches.all = [
                this.branches.test,
                this.branches.review,
                this.branches.development,
                this.branches.staging,
                this.branches.production
            ].filter(b => !!b);
            return this.branches.all;
        })();
    }
    get treeItem() {
        return (async () => {
            if(this.dirty) await this.refresh();
            this._treeItem.tooltip = pluralize(Object.values(this.couplings).length, "stage");
            this._treeItem.iconPath = new vscode.ThemeIcon("server", getDynoColor(this.state));
            return this._treeItem;
        })();
    }
    async refresh(allApps, couplings) { // we can splice from this array
        // MAYBE: We should handle the case where we don't get an allApps array
        allApps = allApps ?? HerokuTreeProvider.instance.rootNode.allApps.slice();

        // if we get couplings passed to us, then use those bc it probably saved energy getting them
        // otherwise get our own couplings
        couplings = couplings ?? await Heroku.get(`/pipelines/${this.hID}/pipeline-couplings`);

        // splice our apps from all apps -- this might need to change when we need to refresh without all apps?
        for(let c of couplings) {
            let app = allApps.find(a => a.hID === c.app.id);
            if(!app) continue; // FIXME: this shouldn't be a continue, because we'll need to add it to the stage and all apps!
            if(this.couplings[c.stage]?.includes(app)) continue;

            allApps.splice(allApps.indexOf(app), 1);

            if(!this.branches[c.stage]) this.branches[c.stage] = new PipelineStage(this, c.stage);
            this.couplings[c.stage] = this.couplings[c.stage] ?? [];
            this.couplings[c.stage].push(app);
            app.parent = this;
        }

        // if stages have no apps, then delete them
        for(let stage in this.branches) {
            if(!this.couplings[stage] || this.couplings[stage].length === 0) {
                delete this.branches[stage];
                delete this.couplings[stage];
            }
        }

        return await super.refresh();
    }

    get state() {
        // MAYBE: Get the state from a user-defined stage?
        return this.branches.production?.state ?? getBestDynoState(Object.values(this.branches).map(b => b.state));
    }
}

class PipelineStage extends Parentable {
    constructor(parent, stage) {
        super(parent);
        this.name = parent.name + " - " + stage;
        this._treeItem = new vscode.TreeItem(correctCase(stage), vscode.TreeItemCollapsibleState.Collapsed);
        this._treeItem.contextValue = "pipelineStage";
        this.pipeline = parent;
        this.stage = stage;
    }
    get children() {
        return (async () => {
            if(this.pipeline.dirty) await this.pipeline.refresh();
            return this.apps;
        })();
    }
    get treeItem() {
        return (async () => {
            this._treeItem.tooltip = pluralize(this.apps.length ?? 0, "app");
            this._treeItem.iconPath = PipelineStage.getStageImage(this.stage, this.state);
            return this._treeItem;
        })();
    }

    get apps() {
        return this.pipeline.couplings[this.stage];
    }
    get state() {
        return getBestAppState(this.apps.map(a => a.state));
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

class App extends HDPItem {
    constructor(parent, herokuAppInfo) {
        super(parent, herokuAppInfo.name);
        this.hID = herokuAppInfo.id;
        this.gitUrl = herokuAppInfo.git_url;
        this.webUrl = herokuAppInfo.web_url;
        this.dynos = [];
        this.addons = [];
        this.branches = {
            dyno: new DynoBranch(this),
            addon: new AddonBranch(this),
        };

        this._treeItem.contextValue = "app";

        this._state = null;
        this._addonState = null;
    }
    get children() {
        return (async () => {
            if(this.dirty) await this.refresh();
            return [this.branches.dyno, this.branches.addon];
        })();
    }
    get treeItem() {
        return (async () => {
            if(this.dirty) await this.refresh();
            this._treeItem.tooltip = "State: " + this.state;
            this._treeItem.iconPath = App.getIconPath(this.state);
            return this._treeItem;
        })();
    }
    async refresh() {
        let [dynos, addons] = await Promise.all([
            Heroku.get(`/apps/${this.hID}/dynos`),
            Heroku.get(`/apps/${this.hID}/addons`)
        ]);

        let refreshPromises = [];

        if(this.dynos.length === 0) this.dynos.push(...dynos.map(d => new Dyno(this, d)));
        else {
            let dynosToAdd = [];
            let dynosToUpdate = [];
            let dynosToRemove = this.dynos.slice();
            let i = 0;
            while(i < dynosToRemove.length) {
                let dyno = dynosToRemove[i];
                let herokuIndex = dynos.findIndex(d => d.id === dyno.hID);
                if(herokuIndex !== -1) { // Dyno still exists
                    let herokuDyno = dynos.splice(herokuIndex, 1)[0];
                    dynosToUpdate.push([dyno, herokuDyno]);
                    dynosToRemove.shift();
                    i--;
                }
                i++;
            }

            for(let herokuDyno of dynosToAdd) {
                let dyno = new Dyno(this, herokuDyno);
                this.dynos.push(dyno);
            }
            for(let [dyno, herokuDyno] of dynosToUpdate) {
                refreshPromises.push(dyno.refresh(herokuDyno));
            }
            for(let dyno of dynosToRemove) {
                this.dynos.splice(this.dynos.indexOf(dyno), 1);
            }
        }

        if(this.addons.length === 0) this.addons.push(...addons.map(a => new Addon(this, a)));
        else {
            let addonsToAdd = [];
            let addonsToUpdate = [];
            let addonsToRemove = this.dynos.slice();
            let i = 0;
            while(i < addonsToRemove.length) {
                let addon = addonsToRemove[i];
                let herokuIndex = addons.findIndex(a => a.id === addon.hID);
                if(herokuIndex !== -1) { // Dyno still exists
                    let herokuAddon = addons.splice(herokuIndex, 1)[0];
                    addonsToUpdate.push([addon, herokuAddon]);
                    addonsToRemove.shift();
                    i--;
                }
                i++;
            }

            for(let herokuAddon of addonsToAdd) {
                let addon = new Dyno(this, herokuAddon);
                this.addons.push(addon);
            }
            for(let [addon, herokuAddon] of addonsToUpdate) {
                refreshPromises.push(addon.update(herokuAddon));
            }
            for(let addon of addonsToRemove) {
                this.addons.splice(this.addons.indexOf(addon), 1);
            }
        }

        await Promise.all(refreshPromises);
        this.deleteCaches();
        await Promise.all([
            this.branches.dyno.refresh(),
            this.branches.addon.refresh(),
        ]);
        return await super.refresh();
    }

    get state() {
        if(this._state !== null) return this._state;
        this._state = getBestDynoState(this.dynos.map(d => d.state));
        return this._state;
    }
    get addonState() {
        if(this._addonState !== null) return this._addonState;
        this._addonState = getBestAddonState(this.addons.map(a => a.state));
        return this._addonState;
    }

    deleteCaches() {
        this._state = null;
        this._addonState = null;
    }

    static getIconPath(dynoState) {
        if(dynoState === "unknown") return new vscode.ThemeIcon("server");
        return path.join(__dirname, "..", "res", "dyno_states", "heroku-dyno-" + dynoState + ".svg");
    }
}

class AddonBranch extends Parentable {
    constructor(parent, opts) {
        super(parent);
        this.name = parent.name + " Addons";
        this._treeItem = new vscode.TreeItem("Addons", opts ?? vscode.TreeItemCollapsibleState.Collapsed);
        this._treeItem.contextValue = "addonBranch";
        this.appParent = parent;
    }
    get children() {
        return (async () => {
            if(this.appParent.dirty) await this.appParent.refresh();
            return this.appParent.addons;
        })();
    }
    get treeItem() {
        return (async () => {
            this._treeItem.tooltip = pluralize(this.appParent.addons.length ?? 0, "addon");
            this._treeItem.iconPath = new vscode.ThemeIcon("empty-window", getAddonColor(this.appParent.addonState));
            return this._treeItem;
        })();
    }
    async refresh() {}
}

class DynoBranch extends Parentable {
    constructor(parent, opts) {
        super(parent);
        this.name = parent.name + " Dynos";
        this._treeItem = new vscode.TreeItem("Dynos", opts ?? vscode.TreeItemCollapsibleState.Collapsed);
        this._treeItem.contextValue = "dynoBranch";
        this.appParent = parent;
    }
    get children() {
        return (async () => {
            if(this.appParent.dirty) await this.appParent.refresh();
            return this.appParent.dynos;
        })();
    }
    get treeItem() {
        return (async () => {
            this._treeItem.tooltip = pluralize(this.appParent.dynos.length ?? 0, "dyno");
            this._treeItem.iconPath = new vscode.ThemeIcon("server-process", getDynoColor(this.appParent.state));
            return this._treeItem;
        })();
    }
    async refresh() {}
}

class Addon extends HDPItem {
    constructor(parent, herokuAddonInfo) {
        super(parent, herokuAddonInfo.name);
        this.hID = herokuAddonInfo.id;
        this.service = herokuAddonInfo.addon_service;
        this.state = herokuAddonInfo.state;
        this.appParent = parent;
        this.configVars = herokuAddonInfo.config_vars;
        this._treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this._treeItem.contextValue = "addon";
    }
    get treeItem() {
        return (async () => {
            this._treeItem.tooltip = this.service.name;
            this._treeItem.iconPath = new vscode.ThemeIcon("extensions", getAddonColor(this.state));
            return this._treeItem;
        })();
    }
    async refresh() {
        let addon = await Heroku.get(`/apps/${this.appParent.hID}/addons/${this.hID}`);
        this.state = addon.state;
        this.configVars = addon.config_vars;
        return await super.refresh();
    }
}

class Dyno extends HDPItem {
    constructor(parent, herokuDynoInfo) {
        super(parent, herokuDynoInfo.name);
        this.hID = herokuDynoInfo.id;
        this.appParent = parent;
        this.state = herokuDynoInfo.state;
        this.command = herokuDynoInfo.command;
        this.attachUrl = herokuDynoInfo.attach_url;
        this._treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this._treeItem.contextValue = "dyno";
    }
    get treeItem() {
        return (async () => {
            this._treeItem.tooltip = "~$ " + this.command;
            this._treeItem.iconPath = new vscode.ThemeIcon("server-process", getDynoColor(this.state));
            return this._treeItem;
        })();
    }
    async refresh() {
        let dyno = await Heroku.get(`/apps/${this.appParent.hID}/dynos/${this.hID}`);
        this.state = dyno.state;
        this.command = dyno.command;
        return await super.refresh();
    }
}

class CommandItem extends Parentable {
    constructor(parent, name, vsCommand, args, opts) {
        super(parent);
        this.name = parent.name + " Command";
        this.command = {
            command: vsCommand,
            arguments: args
        };
        this._treeItem = new vscode.TreeItem(name, opts?.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
        this._treeItem.contextValue = "addonBranch";
        this._treeItem.command = this.command;
        this._treeItem.tooltip = vsCommand;
        this._treeItem.iconPath = new vscode.ThemeIcon(opts?.iconPath ?? "empty-window", opts?.iconColor);
        this.appParent = parent;
    }
    get children() {return null;}
    get treeItem() {
        return this._treeItem;
    }
    async refresh() {}
}

const stateLists = {
    dyno: ["up", "starting", "idle", "crashed", "down"],
    addon: ["provisioned", "provisioning", "", "", "deprovisioned"]
};

function getBestState(states, stateOrder) {
    if(!Array.isArray(states)) states = [states];
    stateOrder = stateOrder || stateLists.dyno;
    let state = stateOrder.length - 1;
    for(let i = 0; i < states.length && state > 0; i++) {
        const dyState = stateOrder.indexOf(states[i]);
        if(dyState < state) state = dyState;
    }
    return stateOrder[state];
}
function getBestAppState(states) {
    return getBestState(states, stateLists.dyno);
}
function getBestDynoState(states) {
    return getBestState(states, stateLists.dyno);
}
function getBestAddonState(states) {
    return getBestState(states, stateLists.addon);
}
function stateColorLookup(state) {
    return "heroheroku.dynoState." + state;
}
function getDynoColor(state) {
    return new vscode.ThemeColor(stateColorLookup(state));
}
function getAddonColor(state) {
    return new vscode.ThemeColor(stateColorLookup(stateLists.dyno[stateLists.addon.indexOf(state)]));
}

function pluralize(count, noun) {
    return count + " " + noun + (count !== 1 ? "s" : "");
}
function correctCase(word) {
    return word.substr(0, 1).toUpperCase() + word.substr(1);
}

module.exports = {
    HerokuTreeProvider,
    HDPItem,
    App,
    // Pipeline,
    // PipelineStage,
    AddonBranch,
    DynoBranch,
    Addon,
    Dyno,
};