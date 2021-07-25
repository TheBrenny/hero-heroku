const vscode = require('vscode');
const Heroku = require("./heroku");
const promisify = require("util").promisify;
const exec = promisify(require('child_process').exec);
// const logger = console.log;
const logger = require("./logger");
const {
    Dyno,
    HerokuTreeProvider
} = require("./herokuDataProvider");

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
            if (stderr) throw {
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

function openAppUrl(tdp, app) {
    logger("Opening external app url");
    return vscode.env.openExternal(app.web_url)
        .then(success => {
            if (!success) throw {
                name: "HH-UserChoice",
                message: "hero-heroku: User didn't want to open app."
            };
        })
        .then(() => head(app.web_url))
        .then(() => sleep(500))
        .then(async () => {
            return Object.assign(app, await HerokuTreeProvider.getApp(app), {
                parent: app.parent
            });
        })
        .then(t => (console.log(t), t))
        .then((target) => {
            while (target.parent != null) target = target.parent;
            return target;
        })
        .then(t => (console.log(t), t))
        .then((target) => refreshBranch(tdp, target))
        .catch(error => {
            if (error.name === "HH-UserChoice") logger(error.message);
            else throw error;
        });
}

function openAppDashboard(_tdp, app) {
    logger("Opening app dashboard");
    return vscode.env.openExternal("https://dashboard.heroku.com/apps/" + app.name);
}

function refreshBranch(tdp, app) {
    logger("Refreshing TDP branch");
    return tdp.refresh(app);
}

function createDyno(tdp, dyno) {
    logger("Creating dyno");
    return vscode.window.showInputBox({
        ignoreFocusOut: true,
        password: false,
        placeHolder: "npm start... ?",
        prompt: "Enter the command for the new dyno",
    }).then(cmd => {
        if (typeof cmd === "undefined") throw {
            name: "HH-UserChoice",
            message: "hero-heroku: User canceled action."
        };
        return Heroku.post("/apps/" + dyno.parent.name + "/dynos", {
            command: cmd
        });
    }).then(() => {
        logger("Creating done");
        refreshBranch(tdp, dyno.parent);
    }).catch(err => {
        if (err.name === "HH-UserChoice") logger(err.message);
        else throw err;
    });
}

function scaleDyno(tdp, dyno) {
    let formations;

    let formID;
    let formQty;
    let remainder = 0;

    logger("Scaling dyno");
    Heroku.get("/apps/" + dyno.parent.name + "/formation")
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
            if (typeof choice === "undefined") throw {
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
                    if (/[^\d]/.test(d)) return "The value must be an integer >= 0!";
                    return "";
                    // add more tests to determine the max qty for the formation?
                }
            });
        }).then(qty => {
            if (typeof qty === "undefined") throw {
                name: "HH-UserChoice",
                message: "hero-heroku: User canceled action."
            };

            formQty = qty;
            return Heroku.patch(`/apps/${dyno.parent.name}/formation/${formID}`, {
                quantity: formQty
            });
        }).then(() => {
            logger("Scaling done");
            refreshBranch(tdp, dyno.parent);
        }).catch(err => {
            if (err.name === "HH-UserChoice") logger(err.message);
            throw err;
        });
}

function restartDyno(tdp, dyno) {
    let endpoint = `/apps/${dyno.parent.name}/dynos${dyno.name}`;
    logger("Restarting dyno");
    Heroku.delete(endpoint).then(() => refreshBranch(tdp, dyno.parent));
}

function stopDyno(tdp, dyno) {
    logger("Stopping dyno");
    Heroku.post(`/apps/${dyno.parent.name}/dynos/${dyno.name}/actions/stop`).then(() => refreshBranch(tdp, dyno.parent));
}

const commands = {
    authenticate,
    refreshTreeView,
    app: {
        openUrl: openAppUrl,
        openDashboard: openAppDashboard,
        refreshApp: refreshBranch
    },
    dyno: {
        create: createDyno,
        scale: scaleDyno,
        restart: restartDyno,
        stop: stopDyno,
    },
};

module.exports = commands;