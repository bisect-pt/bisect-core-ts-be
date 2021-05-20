export enum ConsoleStream {
    stdout,
    stderr,
}
export interface IConsoleMessage {
    stream: ConsoleStream;
    message: string;
}

type LogFunction = (message?: any, ...optionalParams: any[]) => void;

function makeLog(stream: ConsoleStream, messages: IConsoleMessage[]) {
    return (message?: any): void => {
        if (message) {
            messages.push({ stream, message: JSON.stringify(message) });
        }
    };
}

function fName(stream: ConsoleStream): 'log' | 'error' {
    switch (stream) {
        case ConsoleStream.stdout:
            return 'log';
        case ConsoleStream.stderr:
            return 'error';
    }
}

class StreamProxy {
    constructor(private readonly stream: ConsoleStream, private readonly messages: IConsoleMessage[]) {
        this.activate(messages);
    }

    private original?: LogFunction = undefined;
    private activate(messages: IConsoleMessage[]) {
        const name = fName(this.stream);
        this.original = console[name];
        console[name] = makeLog(this.stream, messages);
    }

    public deactivate() {
        if (this.original) {
            console[fName(this.stream)] = this.original;
        }
    }
}

export default class ConsoleProxy {
    private proxies: StreamProxy[] = [];
    private _messages: IConsoleMessage[] = [];

    public activate() {
        this.proxies.push(new StreamProxy(ConsoleStream.stdout, this._messages));
        this.proxies.push(new StreamProxy(ConsoleStream.stderr, this._messages));
    }

    public deactivate() {
        this.proxies.forEach((proxy) => proxy.deactivate());
    }

    public get messages() {
        return this._messages;
    }
}
