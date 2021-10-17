const vscode = require('vscode');
const Heroku = require("./heroku");
const promisify = require("util").promisify;
const fetch = require("node-fetch");
const exec = promisify(require('child_process').exec);
const logger = require("./logger");
const {
    Dyno,
    HerokuTreeProvider
} = require("./herokuDataProvider");
const Rendezvous = require("rendezvous-protocol");

const {
    head,
    sleep,
} = require('./promutil');

function authenticate() {
    logger("Creating authorization");
    return exec("heroku authorizations:create -S -d \"Hero Heroku VSCode Extension\"")
        .then((std) => {
            const stderr = std.stderr;
            const stdout = std.stdout;
            if(stderr) throw {
                name: "HerokuCLI",
                message: stderr.trim()
            };
            return stdout.trim();
        }).then(token => {
            logger("Authorization token recieved");
            let config = vscode.workspace.getConfiguration("hero-heroku");
            return config.update("apiKey", token, true);
        }).then(() => {
            logger("Restarting Hero Heroku");
            Heroku.destroy();
            new Heroku();
            vscode.commands.executeCommand("hero-heroku.refreshAppTree");
        }).catch((err) => {
            throw err;
        });
}

function refreshTreeView(tdp) {
    logger("Refreshing app tree");
    return tdp.refresh();
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
        return Heroku.post("/apps/" + app.name + "/dynos", {
            command: cmd,
            attach: true,
            type: "run",
            time_to_live: 30 * 60 // TODO: make this configurable
        });
    }).then(async (data) => {
        logger("Creating done");
        refreshBranch(tdp, app);

        let rv = new Rendezvous(data.attach_url);
        await rv.connect();

        let command = "";
        const writeEmitter = new vscode.EventEmitter();
        const pty = {
            onDidWrite: writeEmitter.event,
            open: () => {
                logger("One-Off Dyno opened");
                rv.on("data", (d) => {
                    d = d.toString();
                    writeEmitter.fire(d);
                    if(d.trim() === "exit") {
                        rv.end();
                        terminal.dispose();
                    }
                });
            },
            close: () => {
                logger("Dyno closed");
                rv.end();
                writeEmitter.dispose();
            },
            handleInput: async (data) => rv.write(data)
        };
        const terminal = vscode.window.createTerminal({
            name: `${app.name}/${data.name} (One-off)`,
            pty: pty
        });
        terminal.show(true);
    }).catch(err => {
        if(err.name === "HH-UserChoice") logger(err.message);
        else throw err;
    });
}

function openAppUrl(tdp, app) {
    logger("Opening external app url");
    vscode.env.openExternal(app.web_url)
        .then(success => {
            if(!success) throw {
                name: "HH-UserChoice",
                message: "hero-heroku: User didn't want to open app."
            };
        })
        .then(() => pingAndRefresh(tdp, app.web_url, app))
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
    Heroku.get(`/apps/${app.name}/config-vars`)
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
        }).then(appName => HerokuTreeProvider.instance.getTreeItem(appName));
    }
    let vars = vscode.window.activeTextEditor.document.getText();
    return updateConfigVars(tdp, app, vars);
}
function updateConfigVars(tdp, app, vars) {
    logger("Updating config vars");
    if(vars instanceof vscode.TextDocument) {
        vars = vars.getText();
        vars = vars.split("\n").map(line => line.split("="));
        vars = vars.reduce((acc, [key, value]) => (acc[key] = value, acc), {});
    }
    return Heroku.patch(`/apps/${app.name}/config-vars`, vars)
        .then(() => {
            return showInfoMessage("Config Vars updated!");
        }).then(() => {
            return pingAndRefresh(tdp, app.web_url, app);
        }).catch((e) => {
            return showErrorMessage("update the Config Vars", e);
        });
}

function refreshBranch(tdp, app) {
    logger("Refreshing TDP branch");
    return tdp.refresh(app);
}

function scaleDyno(tdp, dynoBranch) {
    let formations;

    let formID;
    let formQty;
    let remainder = 0;

    logger("Scaling dyno");
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
            return Heroku.patch(`/apps/${dynoBranch.parent.name}/formation/${formID}`, {
                quantity: formQty
            });
        }).then(() => {
            logger("Scaling done");
            refreshBranch(tdp, dynoBranch.parent);
        }).catch(err => {
            if(err.name === "HH-UserChoice") logger(err.message);
            throw err;
        });
}

function restartDyno(tdp, dyno) {
    let endpoint = `/apps/${dyno.appParent.name}/dynos/${dyno.name}`;
    logger("Restarting dyno");
    Heroku.delete(endpoint).then(() => refreshBranch(tdp, dyno.parent));
}

function stopDyno(tdp, dyno) {
    logger("Stopping dyno");
    Heroku.post(`/apps/${dyno.appParent.name}/dynos/${dyno.name}/actions/stop`).then((d) => {
        logger(d);
        refreshBranch(tdp, dyno.appParent);
    }).catch(err => {
        logger(err);
    });
}

function logDyno(tdp, dyno) {
    logger("Logging dyno");
    // MAYBE: Colour the output of the log file and allow it to be configurable with RegExs?
    Heroku.post(`/apps/${dyno.appParent.name}/log-sessions`, {
        lines: 30, // TODO: Change this to be configurable
        tail: true,
        source: "app",
        dyno: dyno.name
    }).then(async (data) => {
        let logUrl = data.logplex_url;
        let logStream = await fetch(logUrl);

        const writeEmitter = new vscode.EventEmitter();
        const pty = {
            onDidWrite: writeEmitter.event,
            open: async () => {
                logger("Log stream opened");
                try {
                    for await(const chunk of logStream.body) {
                        if(chunk.toString() !== "\u0000") writeEmitter.fire(chunk.toString().replace(/\n/gm, "\r\n"));
                    }
                } catch(err) {
                    console.error(err);
                    logger(err);
                }
            },
            close: () => {
                // Close the fetch stream
                logger("Log stream closed");
                logStream.close();
                writeEmitter.dispose();
            },
            handleInput: (data) => {} // incoming keystrokes
        };
        const terminal = vscode.window.createTerminal({
            name: `${dyno.appParent.name}/${dyno.name} Log`,
            pty: pty
        });
        terminal.show(true);
        // node fetch the log url and pipe it to a stream that dumps it in a terminal
    }).catch((err) => {
        logger("Heroku Logger Failed: " + err);
        return showErrorMessage("get a dyno log stream", err);
    });
}

function pingAndRefresh(tdp, url, tdpElement) {
    return Promise.resolve()
        .then(() => head(url))
        .then(() => sleep(1000))
        .then(() => refreshBranch(tdp, tdpElement))
        .catch((e) => {
            return showErrorMessage("ping the app", e);
        });
}

function showInfoMessage(message, ...actions) {
    return vscode.window.showInformationMessage(message, ...actions);
}
function showErrorMessage(message, error, ...actions) {
    let readE = `${error?.name ?? "Error"} ${error?.code ?? error?.statusCode ?? "(?)"}\n${error?.message || "<no message>"}`;
    return vscode.window.showErrorMessage("Hero Heroku encountered an error while trying to " + message + ":\n" + readE, ...actions);
}

const commands = {
    authenticate,
    refreshTreeView,
    showInfoMessage,
    showErrorMessage,
    app: {
        openUrl: openAppUrl,
        openDashboard: openAppDashboard,
        refreshApp: refreshBranch,
        getConfigVars: getConfigVars,
        tryUpdateConfigVars: tryUpdateConfigVars,
        updateConfigVars: updateConfigVars,
    },
    dyno: {
        create: createDyno,
        scale: scaleDyno,
        restart: restartDyno,
        stop: stopDyno,
        logs: logDyno,
    },
};

module.exports = commands;