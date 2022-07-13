// tslint:disable: no-unsafe-any

/*
 * Copyright (c) 2015, Yahoo Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

'use strict';

import glob from 'glob';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
// tslint:disable-next-line: no-var-requires
const utils = require('./utils');

// -----------------------------------------------------------------------------

interface PartialTemplateOptions {
    cache?: boolean;
    precompiled?: boolean;
}

interface RenderOptions {
    cache?: boolean;
    data?: { };
    helpers?: any;
    partials?: any;
}

interface ExphbsOptions {
    handlebars?: any;
    extname?: string;
    layoutsDir?: string;
    partialsDir?: any;
    defaultLayout?: string;
    helpers?: any;
    compilerOptions?: any;
}

type ExphbsCallback = (err: any, content: string) => void;

export class ExpressHandlebars {
    engine: (path: string, options: object, callback: ExphbsCallback) => void;
    extname: string;

    private handlebars = Handlebars;
    private layoutsDir?: string;
    private partialsDir: string | (string | { templates: string, namespace: string, dir: string})[];
    private defaultLayout?: string;
    private helpers: any;
    private compilerOptions: any;
    private compiled: { [k: string]: any } = { };
    private precompiled: { [k: string]: any } = { };
    private _fsCache: { [k: string]: Promise<any> } = { };

    constructor(config: ExphbsOptions) {
        this.extname = config.extname || '.handlebars';
        this.layoutsDir = config.layoutsDir || undefined;
        this.partialsDir = config.partialsDir || [];
        this.defaultLayout = config.defaultLayout || 'main';
        this.helpers = config.helpers || undefined;
        this.compilerOptions = config.compilerOptions || undefined;

        // Express view engine integration point.
        this.engine = this.renderView.bind(this);

        // Normalize `extname`.
        if (this.extname.charAt(0) !== '.') {
            this.extname = '.' + this.extname;
        }

        Handlebars.registerHelper("when", (operand1, operator, operand2, options) => {
            let operators: { [k: string]: (a: any, b: any) => boolean } = {
                'eq': (l: any, r: any) => { return l === r; },
                'noteq': (l: any, r: any) => { return l !== r; },
                'gt': (l: any, r: any) => { return Number(l) > Number(r); },
                'or': (l: any, r: any) => { return l || r; },
                'and': (l: any, r: any) => { return l && r; },
                '%': (l: any, r: any) => { return (l % r) === 0; }
            };
            let result = operators[operator](operand1, operand2);
            if (result) return options.fn(this);
            else return options.inverse(this);
        });
    }

    getPartials(options?: PartialTemplateOptions): Promise<{ }> {
        let partialsDirs = Array.isArray(this.partialsDir) ?
        this.partialsDir : [this.partialsDir];

        let pd = partialsDirs.map((dir) => {
            let dirPath: any;
            let dirTemplates: any;
            let dirNamespace: any;

            // Support `partialsDir` collection with object entries that contain a
            // templates promise and a namespace.
            if (typeof dir === 'string') {
                dirPath = dir;
            } else if (typeof dir === 'object') {
                dirTemplates = dir.templates;
                dirNamespace = dir.namespace;
                dirPath      = dir.dir;
            }

            // We must have some path to templates, or templates themselves.
            if (!(dirPath || dirTemplates)) {
                throw new Error('A partials dir must be a string or config object');
            }

            // Make sure we're have a promise for the templates.
            let templatesPromise = dirTemplates ? Promise.resolve(dirTemplates) :
                    this.getTemplates(dirPath, options);

            return templatesPromise.then((templates) => {
                return {
                    templates: templates,
                    namespace: dirNamespace,
                };
            });
        });

        return Promise.all(pd).then((dirs) => {
            let getTemplateName = this._getTemplateName.bind(this);

            return dirs.reduce((partials, dir) => {
                let templates = dir.templates;
                let namespace = dir.namespace;
                let filePaths = Object.keys(templates);

                filePaths.forEach((filePath) => {
                    let partialName       = getTemplateName(filePath, namespace);
                    (<any>partials)[partialName] = templates[filePath];
                });

                return partials;
            }, { });
        });
    }

    getTemplate(filePath: string, options?: PartialTemplateOptions): Promise<() => void> {
        filePath = path.resolve(filePath);
        if (!options) options = { };

        let precompiled = options.precompiled;
        let cache       = precompiled ? this.precompiled : this.compiled;
        let template    = options.cache && cache[filePath];

        if (template) {
            return template;
        }

        // Optimistically cache template promise to reduce file system I/O, but
        // remove from cache if there was a problem.
        template = cache[filePath] = this._getFile(filePath, { cache: options.cache })
            .then((file: any) => {
                if (precompiled) {
                    return this._precompileTemplate(file, this.compilerOptions);
                }

                return this._compileTemplate(file, this.compilerOptions);
            });

        return template.catch((err: any) => {
            delete cache[filePath];
            throw err;
        });
    }

    getTemplates(dirPath: string, options?: PartialTemplateOptions): Promise<{ [k: string]: any }> {
        if (!options) options = { };
        let cache = options.cache;

        return this._getDir(dirPath, { cache: cache }).then((filePaths: any) => {
            let templates = filePaths.map((filePath: any) => {
                return this.getTemplate(path.join(dirPath, filePath), options);
            });

            return Promise.all(templates).then((t) => {
                return filePaths.reduce((hash: any, filePath: any, i: any) => {
                    hash[filePath] = t[i];
                    return hash;
                }, { });
            });
        });
    }

    render(filePath: string, context: { }, options?: RenderOptions): Promise<string> {
        if (!options) options = { };

        return Promise.all([
            this.getTemplate(filePath, { cache: options.cache }),
            // tslint:disable-next-line:no-promise-as-boolean
            options.partials || this.getPartials({ cache: options.cache }),
        ]).then((templates) => {
            if (!options) options = { };

            let template = templates[0];
            let partials = templates[1];
            let helpers  = options.helpers || this.helpers;

            // Add ExpressHandlebars metadata to the data channel so that it's
            // accessible within the templates and helpers, namespaced under:
            // `@exphbs.*`
            let data = utils.assign({ }, options.data, {
                exphbs: utils.assign({ }, options, {
                    filePath: filePath,
                    helpers : helpers,
                    partials: partials,
                }),
            });

            return this._renderTemplate(template, context, {
                data    : data,
                helpers : helpers,
                partials: partials,
            });
        });
    }

    renderView(viewPath: string, options: any, callback: ExphbsCallback): void {
        if (!options) options = { };

        let context = options;

        // Express provides `settings.views` which is the path to the views dir that
        // the developer set on the Express app. When this value exists, it's used
        // to compute the view's name. Layouts and Partials directories are relative
        // to `settings.view` path
        let view;
        let viewsPath = options.settings && options.settings.views;
        if (viewsPath) {
            view = this._getTemplateName(path.relative(viewsPath, viewPath));
            this.partialsDir = this.partialsDir || path.join(viewsPath, 'partials/');
            this.layoutsDir = this.layoutsDir || path.join(viewsPath, 'layouts/');
        }

        // Merge render-level and instance-level helpers together.
        let helpers = utils.assign({ }, this.helpers, options.helpers);

        // Merge render-level and instance-level partials together.
        let partials = Promise.all([
            this.getPartials({ cache: options.cache }),
            Promise.resolve(options.partials),
        ]).then((p) => {
            return utils.assign.apply(null, [{ }].concat(p));
        });

        // Pluck-out ExpressHandlebars-specific options and Handlebars-specific
        // rendering options.
        options = {
            cache : options.cache,
            view  : view,
            layout: 'layout' in options ? options.layout : this.defaultLayout,

            data    : options.data,
            helpers : helpers,
            partials: partials,
        };

        this.render(viewPath, context, options)
            .then((body) => {
                let layoutPath = this._resolveLayoutPath(options.layout);

                if (layoutPath) {
                    return this.render(
                        layoutPath,
                        utils.assign({ }, context, { body: body }),
                        utils.assign({ }, options, { layout: undefined })
                    );
                }

                return body;
            })
            .then(utils.passValue(callback))
            .catch(utils.passError(callback));
    }

    // -- Protected Hooks ----------------------------------------------------------

    _compileTemplate(template: any, options: any | undefined) {
        return this.handlebars.compile(template.trim(), options);
    }

    _precompileTemplate(template: any, options: any | undefined) {
        return this.handlebars.precompile(template, options);
    }

    _renderTemplate(template: any, context: any, options: any | undefined) {
        return template(context, options).trim();
    }

    // -- Private ------------------------------------------------------------------

    _getDir(dirPath: string, options: { cache?: any }) {
        dirPath = path.resolve(dirPath);
        if (!options) options = { };

        let cache = this._fsCache;
        // tslint:disable-next-line:no-promise-as-boolean
        let dir   = options.cache && cache[dirPath];

        // tslint:disable-next-line:no-promise-as-boolean
        if (dir) {
            return dir.then((d: any) => {
                return d.concat();
            }).catch((err: any) => {
                delete cache[dirPath];
                throw err;
            });
        }

        let pattern = '**/*' + this.extname;

        // Optimistically cache dir promise to reduce file system I/O, but remove
        // from cache if there was a problem.
        dir = cache[dirPath] = new Promise((resolve, reject) => {
            glob(pattern, {
                cwd   : dirPath,
                follow: true
            }, (err, d) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(d);
                }
            });
        });

        return dir.then((d: any) => {
            return d.concat();
        }).catch((err: any) => {
            delete cache[dirPath];
            throw err;
        });
    }

    _getFile(filePath: string, options: { cache?: any }): Promise<any> {
        filePath = path.resolve(filePath);
        if (!options) options = { };

        let cache = this._fsCache;
        // tslint:disable-next-line:no-promise-as-boolean
        let file  = options.cache && cache[filePath];

        // tslint:disable-next-line:no-promise-as-boolean
        if (file) {
            return file;
        }

        // Optimistically cache file promise to reduce file system I/O, but remove
        // from cache if there was a problem.
        file = cache[filePath] = new Promise((resolve, reject) => {
            fs.readFile(filePath, 'utf8', (err, f) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(f);
                }
            });
        });

        return file.catch((err: any) => {
            delete cache[filePath];
            throw err;
        });
    }

    _getTemplateName(filePath: string, namespace?: string) {
        let extRegex = new RegExp(this.extname + '$');
        let name     = filePath.replace(extRegex, '');

        if (namespace) {
            name = namespace + '/' + name;
        }

        return name;
    }

    _resolveLayoutPath(layoutPath: string) {
        if (!layoutPath) {
            return null;
        }

        if (!path.extname(layoutPath)) {
            layoutPath += this.extname;
        }

        return path.resolve(this.layoutsDir || '', layoutPath);
    }
}
