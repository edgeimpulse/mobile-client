// tslint:disable: no-unsafe-any
import { FormattableValue, toKeyValue } from "./format";
import tracer, { TRACING } from "./tracer";

export type LogLevel = 'info' | 'debug' | 'warn' | 'error';
export type KeyValueDict<T> = {
    [P in keyof T]: FormattableValue
};

function isError(ex: any): ex is Error {
    return ex && ex.stack !== undefined;
}
export class Logger {

    constructor(private name: string) {
    }

    private log<T>(message: string, level: LogLevel, keyvalues?: KeyValueDict<T> | T, exception?: any) {
        const exceptionStack = exception ? '\n' + exception.toString() : '';

        if (TRACING) {
            const span = tracer!.scope().active();
            const ctx = span?.getBaggageItem('ctx');
            if (ctx) {
                keyvalues = keyvalues || { } as KeyValueDict<T>;
                (keyvalues as any).ctx = ctx;
            }

        }

        const extraInfo = keyvalues ? ' ' + toKeyValue(keyvalues) : '';
        // tslint:disable-next-line: no-console
        console.log(`${new Date().toISOString()} logger=${this.name} level=${level}${extraInfo} ${message}${exceptionStack}`);
    }

    info<T>(message: string, keyvalues?: KeyValueDict<T> | T) {
        this.log(message, 'info', keyvalues);
    }

    debug<T>(message: string, keyvalues?: KeyValueDict<T> | T) {
        this.log(message, 'debug', keyvalues);
    }

    warn<T>(message: string, exceptionOrkeyvalues?: any | KeyValueDict<T> | T, keyvalues?: KeyValueDict<T> | T) {
        if (keyvalues || isError(exceptionOrkeyvalues)) {
            this.log(message, 'warn', keyvalues, exceptionOrkeyvalues);
        } else {
            this.log(message, 'warn', exceptionOrkeyvalues);
        }

    }

    error<T>(message: string, exceptionOrkeyvalues?: any | KeyValueDict<T> | T, keyvalues?: KeyValueDict<T> | T) {
        if (keyvalues || isError(exceptionOrkeyvalues)) {
            this.log(message, 'error', keyvalues, exceptionOrkeyvalues);
        } else {
            this.log(message, 'error', exceptionOrkeyvalues);
        }
    }
}

export function logger(name: string) {
    return new Logger(name);
}