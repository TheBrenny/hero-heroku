const vscode = require("vscode");
const logger = require("./logger");

function makeStreamTerminal(stream, terminalName) {
    const writeEmitter = new vscode.EventEmitter();
    const pty = {
        onDidWrite: writeEmitter.event,
        open: async () => {
            logger("Stream terminal opened");
            try {
                stream.on("data", (chunk) => {
                    if(chunk.toString() !== "\u0000") writeEmitter.fire(chunk.toString().replace(/\n/gm, "\r\n"));
                });
            } catch(err) {
                console.error(err);
                logger(err);
            }
        },
        close: () => {
            // Close the fetch stream
            logger("Stream terminal closed");
            stream.close();
            writeEmitter.dispose();
        },
        handleInput: (data) => {} // incoming keystrokes
    };
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        pty: pty
    });
    return terminal;
}

function makeInteractiveTerminal(stream, name) {
    const writeEmitter = new vscode.EventEmitter();
    const pty = {
        onDidWrite: writeEmitter.event,
        open: () => {
            logger("Interactive terminal opened");
            stream.on("data", (d) => {
                d = d.toString();
                writeEmitter.fire(d);
                if(d.trim() === "exit") {
                    stream.end();
                    terminal.dispose();
                }
            });
        },
        close: () => {
            logger("Interactive terminal closed");
            stream.end();
            writeEmitter.dispose();
        },
        handleInput: async (data) => stream.write(data)
    };
    const terminal = vscode.window.createTerminal({
        name: name,
        pty: pty
    });
    return terminal;
}

module.exports = {
    makeStreamTerminal,
    makeInteractiveTerminal
};