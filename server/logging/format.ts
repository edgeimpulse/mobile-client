import { Formattable } from "./formattable";
import { KeyValueDict } from "./logger";

export type FormattableValue = Date | string | number | boolean
                               | object | Formattable | undefined | null;

/**
 * Format an object as a key=value series string
 * @param obj key value pairs
 * @returns formatted string
 */
export function toKeyValue<T>(obj: KeyValueDict<T> | T) {
    if (!obj) {
        return '';
    }

    if (typeof obj === 'string') {
        return obj;
    }

    // tslint:disable-next-line: no-unsafe-any
    return Object.entries(obj).map(([k, v]) => `${k}=${formatValue(v)}`).join(' ');
}

function isDate(obj: any): obj is Date {
    // tslint:disable-next-line: no-unsafe-any
    return typeof obj === 'object' && obj.toISOString;
}

function isFormattable(obj: any): obj is Formattable {
    return typeof obj === 'object'
    // tslint:disable-next-line: no-unsafe-any
            && obj.format && typeof obj.format === 'function';
}

function formatValue(value: FormattableValue) : string {
    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value === 'number') {
        return value.toString();
    }

    if (typeof value === 'string') {
        if (value.includes(' ')) {
            return '"' + value + '"';
        }
        return value;
    }

    if (isDate(value)) {
        return value.toISOString();
    }

    if (isFormattable(value)) {
        return value.format();
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return value.toString();
}

export function flatten<T>(obj: T): any {
    const _flatten = (o: any, path = ''): any => {
        if (!(o instanceof Object)) return { [path.replace(/\.$/g, '')]: o };

        // tslint:disable-next-line: no-unsafe-any
        return Object.keys(o).reduce((output: any, key: any) => {
            return o instanceof Array ?
                 { ...output, ..._flatten(o[key], path +  '[' + key + '].') } :
                 // tslint:disable-next-line: no-unsafe-any
                 { ...output, ..._flatten(o[key], path + key + '.') };
        }, { });
    };
    return _flatten(obj);
}