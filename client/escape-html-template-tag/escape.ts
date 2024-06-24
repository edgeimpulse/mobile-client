const ENTITIES: {
    [key: string]: string
} = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
};

const inspect = Symbol.for('nodejs.util.inspect.custom');

const ENT_REGEX = new RegExp(Object.keys(ENTITIES).join('|'), 'g');

export function join(array: (string | HtmlSafeString)[], separator: string | HtmlSafeString) {
    if (separator === undefined || separator === null) {
        separator = ',';
    }
    if (array.length <= 0) {
        return new HtmlSafeString([''], []);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return new HtmlSafeString(['', ...Array(array.length - 1).fill(separator), ''], array);
}

export function safe(value: unknown) {
    return new HtmlSafeString([String(value)], []);
}

function escapehtml(unsafe: unknown): string {
    if (unsafe instanceof HtmlSafeString) {
        return unsafe.toString();
    }
    if (Array.isArray(unsafe)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        return join(unsafe, '').toString();
    }
    return String(unsafe).replace(ENT_REGEX, (char) => ENTITIES[char]);
}

export class HtmlSafeString {
    private _parts: readonly string[];
    private _subs: readonly unknown[];
    constructor(parts: readonly string[], subs: readonly unknown[]) {
        this._parts = parts;
        this._subs = subs;
    }

    toString(): string {
        return this._parts.reduce((result, part, i) => {
            const sub = this._subs[i - 1];
            return result + escapehtml(sub) + part;
        });
    }

    [inspect]() {
        return `HtmlSafeString '${this.toString()}'`;
    }
}

export default function escapeHtml(parts: TemplateStringsArray, ...subs: unknown[]) {
    return new HtmlSafeString(parts, subs);
}
