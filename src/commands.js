const vscode = require('vscode');
const which = require("which");
const Heroku = require("./heroku");
const promisify = require("util").promisify;
const fetch = require("node-fetch");
const childProcess = require('child_process');
const exec = promisify(childProcess.exec);
const logger = require("./logger");
const WordBuilder = require("mini-word-smith");
const {
    Dyno,
    HerokuTreeProvider,
    DynoBranch
} = require("./herokuDataProvider");
const Rendezvous = require("rendezvous-protocol");
const https = require("https");

const terminal = require("./terminal");

const {
    head,
    sleep,
} = require('./promutil');
const {Stream, promises} = require('stream');

function authenticate() {
    logger("Creating authorization");

    const herokuAuthCmd = "heroku authorizations:create -S -d \"Hero Heroku VSCode Extension\"";

    const controller = new AbortController();
    let passed = false;
    setTimeout(() => !passed && controller.abort(), 150);

    // Wrapped in a promise.resolve because we want to resolve the exec and the abort onto the next "then"
    return Promise.resolve(exec(herokuAuthCmd, {
        signal: controller.signal
    }).catch((err) => {
        if(err.code === "ABORT_ERR") return {
            stdout: "",
            stderr: "Request timed out past 15 seconds."
        };
        else throw err;
    })).then((std) => {
        const stderr = std.stderr;
        const stdout = std.stdout;
        if(stderr) throw {
            name: "HerokuCLI",
            message: stderr.trim()
        };
        return stdout.trim();
    }).then(token => {
        logger("Authorization token recieved");
        return vscode.workspace.getConfiguration("hero-heroku").update("apiKey", token, vscode.ConfigurationTarget.Global);
    }).then(() => {
        logger("Restarting Hero Heroku");
        Heroku.destroy();
        new Heroku();
        vscode.commands.executeCommand("hero-heroku.refreshAppTree");
    }).catch((err) => {
        return showErrorMessage("authorize with Heroku", err, "Run in Terminal")
    }).then((action) => {
        if(action === "Run in Terminal") {
            let term = vscode.window.createTerminal("Hero-Heroku Authorization");
            term.show();
            term.sendText(herokuAuthCmd);
            vscode.commands.executeCommand("workbench.action.openSettings", "hero-heroku.apiKey");
        }
    });
}

function refreshTreeView(tdp, app, clear = false) {
    tdp = tdp ?? HerokuTreeProvider.instance;
    logger("Refreshing TDP branch");
    if(clear) tdp.clearChildren();
    return tdp.refresh(app);
}

async function createApp(tdp) {
    logger("Creating app");
    let name, stack, region;
    try { // Get app details
        name = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            password: false,
            placeHolder: "Let Heroku decide...",
            value: new WordBuilder("an").toString("-").toLocaleLowerCase(),
            title: "App Name",
            prompt: "Enter the name of the new app"
        });
        stack = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            password: false,
            placeHolder: "Let Heroku decide...",
            value: "",
            title: "App Stack",
            prompt: "Enter the stack for the new app"
        });
        region = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            password: false,
            placeHolder: "Let Heroku decide...",
            value: "",
            title: "App Region",
            prompt: "Enter the region for the new app"
        });
    } catch(err) {
        if(err.name === "HH-UserChoice") logger(err.message);
        else throw err;
    }

    let payload = {};
    if(name) payload.name = name;
    if(stack) payload.stack = stack;
    if(region) payload.region = region;

    return Heroku.post("/apps", payload).then(async (app) => {
        logger("App created: " + app.name);
        // tdp.clearChildren();
        await tdp.addApp(app);
        refreshTreeView(tdp, null); // refresh entire tree
        return app;
    }).catch(async (err) => {
        logger("App creation failed: " + err.body.message);
        let tryAgain = await showErrorMessage(null, {wholeMessage: err.body.message}, "Try again", "Dismiss");
        if(tryAgain === "Try again") setImmediate(createApp.bind(this, tdp));
    });
}

function createDyno(tdp, app) {
    logger("Creating dyno");
    return vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: false,
        placeHolder: "bash",
        prompt: "Enter the command for the new dyno",
        value: "bash",
    }).then(cmd => {
        if(typeof cmd === "undefined") throw {
            name: "HH-UserChoice",
            message: "hero-heroku: User canceled action."
        };
        return Heroku.post(`/apps/${app.hID}/dynos`, {
            command: cmd,
            attach: true,
            type: "run",
            time_to_live: 30 * 60 // TODO: make this configurable
        });
    }).then(async (data) => {
        logger("Creating done");
        refreshTreeView(tdp, app);

        let rv = new Rendezvous(data.attach_url);
        await rv.connect();

        const term = terminal.makeInteractiveTerminal(rv, `${app.name}/${data.name} (One-off)`);
        term.show(true);
    }).catch(err => {
        if(err.name === "HH-UserChoice") logger(err.message);
        else throw err;
    });
}

function openAppUrl(tdp, app) {
    logger("Opening external app url");
    vscode.env.openExternal(app.webUrl)
        .then(success => {
            if(!success) throw {
                name: "HH-UserChoice",
                message: "hero-heroku: User didn't want to open app."
            };
        })
        .then(() => pingAndRefresh(tdp, app.webUrl, app))
        .catch(error => {
            if(error.name === "HH-UserChoice") logger(error.message);
            else throw error;
        });
}

function openAppDashboard(_tdp, app) {
    logger("Opening app dashboard");
    vscode.env.openExternal("https://dashboard.heroku.com/apps/" + app.name);
}

function getConfigVars(tdp, app) {
    logger("Getting config vars");
    let starterVars = {};
    Heroku.get(`/apps/${app.hID}/config-vars`)
        .then(async (cfg) => {
            starterVars = cfg;
            let entries = Object.entries(cfg);
            let output = entries.map(([key, value]) => `${key}=${value}`).join("\n");
            let hasDotEnv = await vscode.languages.getLanguages().then(langs => langs.includes("dotenv"));
            let doc = await vscode.workspace.openTextDocument({
                content: output,
                language: hasDotEnv ? "dotenv" : "shellscript"
            });
            return vscode.window.showTextDocument(doc);
            // MAYBE: on save, push changes to the heroku app
        });
}

async function tryUpdateConfigVars(tdp, app) {
    if(app === undefined) {
        app = await vscode.window.showInputBox({
            prompt: "Enter the name of the app",
        }).then(appName => HerokuTreeProvider.instance.getAppByName(appName));
    }
    let vars = vscode.window.activeTextEditor.document.getText();
    vars = vars.split("\n").map(line => line.split("=")).reduce((acc, [key, value]) => (acc[key] = value, acc), {});
    return updateConfigVars(tdp, app, vars);
}
function updateConfigVars(tdp, app, vars) {
    logger("Updating config vars");
    if(typeof vars !== "object") throw new Error("Config Vars passed must be an object!");
    return Heroku.patch(`/apps/${app.hID}/config-vars`, vars)
        .then(() => {
            return showInfoMessage("Config Vars updated!");
        }).then(() => {
            return pingAndRefresh(tdp, app.webUrl, app);
        }).catch((e) => {
            return showErrorMessage("update the Config Vars", e);
        });
}

async function deployViaGit(tdp, app) {
    const gitUrl = new URL(app.gitUrl);
    gitUrl.username = "heroheroku"; // My testing indicated that the username doesn't matter...
    gitUrl.password = Heroku.getApiKey();

    try {
        // Create the passthru stream and the pty
        let passThru = new Stream.PassThrough();
        const term = terminal.makeStreamTerminal(passThru, `Deploying ${app.name}`);
        term.show(false);

        // Do all the git stuff
        let gitArgs = [
            "push",
            gitUrl.toString(),
            // "2>&1" // Redirect STDERR to STDOUT so we capture that in our term as well!
        ];
        let vsGitPath = vscode.workspace.getConfiguration("git").get("path");
        vsGitPath = await (vsGitPath ? Promise.resolve(vsGitPath) : which("git"));
        let gitProcess = childProcess.spawn(vsGitPath, gitArgs, {
            cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
        });

        passThru.write(`[${new Date().toJSON()}] pushing to heroku...\n`);
        gitProcess.stdout.pipe(passThru, {end: false});
        gitProcess.stderr.pipe(passThru, {end: false});

        gitProcess.on("error", (err) => {
            console.error(err);
            passThru.write("[nodejs error]\n" + err.message);
        });
        gitProcess.on("close", (code) => {
            if(code !== 0) {
                console.log("bad exit code: " + code);
            }
            refreshTreeView(tdp, app);
            passThru.write(`[${new Date().toJSON()}] Done!\n`);
            passThru.end();
            term.name = "Deployed " + app.name;
            console.log("Done!");
        });
    } catch(err) {
        console.error(err);
    }
}

function scaleDyno(tdp, dynoBranch) {
    let formations;

    let formID;
    let formQty;
    let remainder = 0;

    logger("Scaling dyno");
    Heroku.get(`/apps/${dynoBranch.appParent.hID}/formation`)
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
            if(typeof choice === "undefined") throw {
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
                    if(/[^\d]/.test(d)) return "The value must be an integer >= 0!";
                    return "";
                    // add more tests to determine the max qty for the formation?
                }
            });
        }).then(qty => {
            if(typeof qty === "undefined") throw {
                name: "HH-UserChoice",
                message: "hero-heroku: User canceled action."
            };

            formQty = qty;
            return Heroku.patch(`/apps/${dynoBranch.appParent.hID}/formation/${formID}`, {
                quantity: formQty
            });
        }).then(() => {
            logger("Scaling done");
            refreshTreeView(tdp, dynoBranch.rootNode);
        }).catch(err => {
            if(err.name === "HH-UserChoice") logger(err.message);
            throw err;
        });
}

function restartDyno(tdp, dyno) {
    let endpoint = `/apps/${dyno.appParent.hID}/dynos`;
    if(dyno instanceof Dyno) {
        endpoint += `/${dyno.hID}`;
    }
    logger("Restarting dyno");
    Heroku.delete(endpoint).then(() => refreshTreeView(tdp, dyno.appParent));
}

function stopDyno(tdp, dyno) {
    logger("Stopping dyno");
    Heroku.post(`/apps/${dyno.appParent.hID}/dynos/${dyno.hID}/actions/stop`).then((d) => {
        logger(d);
        refreshTreeView(tdp, dyno.appParent);
    }).catch(err => {
        logger(err);
    });
}

function logDyno(tdp, dyno) {
    logger("Logging dyno");
    // MAYBE: Colour the output of the log file and allow it to be configurable with RegExs?
    Heroku.post(`/apps/${dyno.appParent.hID}/log-sessions`, {
        lines: 30, // TODO: Change this to be configurable
        tail: true,
        source: "app",
        dyno: dyno.name
    }).then(async (data) => {
        let logUrl = data.logplex_url;
        let logStream = await fetch(logUrl);

        const term = terminal.makeStreamTerminal(logStream.body, `${dyno.appParent.name}/${dyno.name} Log`);
        term.show(true);
    }).catch((err) => {
        logger("Heroku Logger Failed: " + err);

        if(err.code === "CERT_HAS_EXPIRED") {
            err.message = "NodeJS is reporting an expired certificate.\n\nSet 'http.systemCertificates' to 'false' in your vscode settings to fix this. If the problem persists, report this on the hero-heroku github page.";
            return showErrorMessage("get a dyno log stream", err, "Open Settings", "Open GitHub Issue")
                .then(choice => {
                    if(choice === undefined) return;
                    if(choice === "Open Settings") {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'http.systemCertificates');
                    } else if(choice === "Open GitHub Issue") {
                        vscode.env.openExternal("https://github.com/thebrenny/hero-heroku/issues/new")
                            .then(success => {
                                if(!success) throw {
                                    name: "HH-UserChoice",
                                    message: "hero-heroku: User didn't want to open app."
                                };
                            })
                            .catch(error => {
                                if(error.name === "HH-UserChoice") logger(error.message);
                                else throw error;
                            });
                    }
                });
        } else {
            return showErrorMessage("get a dyno log stream", err);
        }
    });
}

function pingAndRefresh(tdp, url, tdpElement) {
    return Promise.resolve()
        .then(() => head(url))
        .then(() => sleep(1000))
        .then(() => refreshTreeView(tdp, tdpElement))
        .catch((e) => {
            return showErrorMessage("ping the app", e);
        });
}

function showInfoMessage(message, ...actions) {
    return vscode.window.showInformationMessage(message, ...actions);
}
function showErrorMessage(hhAction, error, ...actions) {
    let readE = `${error?.name ?? "Error"} ${error?.code ?? error?.statusCode ?? ""}\n${error?.message || "<no message>"}`;
    return vscode.window.showErrorMessage(error?.wholeMessage ?? ("Hero Heroku encountered an error while trying to " + hhAction + ":\n" + readE), ...actions);
}

const commands = {
    authenticate,
    refreshTreeView,
    showInfoMessage,
    showErrorMessage,
    app: {
        create: createApp,
        openUrl: openAppUrl,
        openDashboard: openAppDashboard,
        getConfigVars: getConfigVars,
        tryUpdateConfigVars: tryUpdateConfigVars,
        updateConfigVars: updateConfigVars,
        deployViaGit: deployViaGit
    },
    dyno: {
        create: createDyno,
        scale: scaleDyno,
        restart: restartDyno,
        stop: stopDyno,
        logs: logDyno,
    },
    showInfoMessage,
    showErrorMessage,
};

module.exports = commands;