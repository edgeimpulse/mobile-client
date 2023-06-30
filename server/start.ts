import express = require('express');
import expressHbs = require('./express-handlebars/hbs');
import Path = require('path');
import http = require('http');
import * as sentry from '@sentry/node';
import { CSPMiddleware, NonceRequest } from './middleware/cspMiddleware';
import cors from 'cors';
import fs from 'fs';
import { Logger } from './logging/logger';
import compression from 'compression';

const log = new Logger("mobileclient");

const revision = fs.existsSync(Path.join(process.cwd(), 'revision')) ?
    fs.readFileSync(Path.join(process.cwd(), 'revision'), 'utf-8').trim()
    : undefined;

const STATIC_ASSETS_MAX_AGE = revision && process.env.CDN_HOST ? '365d' : '0'; // 12 months
if (process.env.STATIC_ASSETS_PREFIX && process.env.CDN_HOST) {
    throw new Error('CDN_HOST and STATIC_ASSETS_PREFIX are set simultaneously. Only of of these variables can be.');
}

let STATIC_ASSETS_PREFIX = process.env.STATIC_ASSETS_PREFIX
    || (process.env.CDN_HOST ? process.env.CDN_HOST + (revision ? '/' + revision : '') : '');

// Web server and socket routing
const studioApp = express();
if (process.env.SENTRY_DSN) {
    studioApp.use(sentry.Handlers.requestHandler());
}
studioApp.use(new CSPMiddleware(STATIC_ASSETS_PREFIX).getMiddleware());
studioApp.disable('x-powered-by');

if (process.env.HTTPS_METHOD === "redirect") {
    studioApp.set('trust proxy', true);
    studioApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.secure) {
            next();
        } else {
            res.redirect('https://' + req.headers.host + req.url);
        }
    });
}

if (process.env.HTTPS_METHOD === "redirect") {
    studioApp.set('trust proxy', true);
    studioApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.secure) {
            next();
        } else {
            res.redirect('https://' + req.headers.host + req.url);
        }
    });
}

// set up web server options
let maxAgeObj = revision ? { maxAge: STATIC_ASSETS_MAX_AGE } : undefined;
if (!maxAgeObj && process.env.STATIC_ASSETS_MAX_AGE) {
    maxAgeObj = { maxAge: process.env.STATIC_ASSETS_MAX_AGE };
}

studioApp.use(compression());
const hbs = new expressHbs.ExpressHandlebars({
    extname: '.html',
    partialsDir: [ Path.join(process.cwd(), 'views', 'partials') ],
});

studioApp.use(express.json());
studioApp.set('view engine', 'html');
studioApp.set('views', (Path.join(process.cwd(), 'views')));
studioApp.engine('html', hbs.engine);
studioApp.enable('view cache');
if (process.env.NODE_ENV === 'development') {
    studioApp.disable('view cache');
}

if (process.env.K8S_ENVIRONMENT === 'staging') {
    const corsOptions = {
        origin: ["https://smartphone.acc2.edgeimpulse.com"],
        credentials: true
    };
    studioApp.options('*', cors(corsOptions));
    studioApp.use('/v1', cors(corsOptions));
}
else {
    studioApp.use('/v1/api', cors());
}

function getBaseView(req: NonceRequest) {
    let vm = {
        cdnPrefix: STATIC_ASSETS_PREFIX,
        layout: false,
        devMode: process.env.NODE_ENV === 'development',
        nonce: req.nonce,
        currentYear: new Date().getFullYear(),
        // tslint:disable-next-line: no-unsafe-any
        includeAnalytics: process.env.K8S_ENVIRONMENT === "prod" && !req.cookies?.ctx
    };

    return vm;
}

// routes
studioApp.get('/accelerometer.html', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('accelerometer.html', Object.assign({
        pageTitle: 'Accelerometer data collection - Edge Impulse',
        clientInitTag: 'data-collection-accelerometer',
    }, getBaseView(req)));
});

studioApp.get('/camera.html', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('camera.html', Object.assign({
        pageTitle: 'Camera data collection - Edge Impulse',
        clientInitTag: 'data-collection-camera',
    }, getBaseView(req)));
});

studioApp.get('/classifier.html', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('classifier.html', Object.assign({
        pageTitle: 'Mobile client - Edge Impulse',
        clientInitTag: 'classifier',
    }, getBaseView(req)));
});

studioApp.get('/', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('index.html', Object.assign({
        pageTitle: 'Mobile client - Edge Impulse',
        clientInitTag: 'data-collection',
    }, getBaseView(req)));
});

studioApp.get('/index.html', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('index.html', Object.assign({
        pageTitle: 'Mobile client - Edge Impulse',
        clientInitTag: 'data-collection',
    }, getBaseView(req)));
});

studioApp.get('/keyword.html', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('keyword.html', Object.assign({
        pageTitle: 'Keyword collector - Edge Impulse',
        clientInitTag: 'data-collection-keyword',
    }, getBaseView(req)));
});

studioApp.get('/microphone.html', (_req, res) => {
    const req = _req as NonceRequest;

    res.render('microphone.html', Object.assign({
        pageTitle: 'Audio data collection - Edge Impulse',
        clientInitTag: 'data-collection-microphone',
    }, getBaseView(req)));
});


if (process.env.STATIC_ASSETS_PREFIX) {
    const pathPrefix = (STATIC_ASSETS_PREFIX ? '/' + STATIC_ASSETS_PREFIX.replace(/^\/+|\/+$/g, '') : '');
    studioApp.use(express.static(Path.join(process.cwd(), 'public'), undefined));
    studioApp.use(pathPrefix, express.static(Path.join(process.cwd(), 'public'), maxAgeObj));
    studioApp.use(pathPrefix + '/client', express.static(Path.join(process.cwd(), 'build', 'client'), maxAgeObj));
    studioApp.use(pathPrefix + '/client', express.static(Path.join(process.cwd(), 'client'), maxAgeObj));
}
else {
    studioApp.use(express.static(Path.join(process.cwd(), 'public'), maxAgeObj));
    studioApp.use('/client', express.static(Path.join(process.cwd(), 'build', 'client'), maxAgeObj));
    studioApp.use('/client', express.static(Path.join(process.cwd(), 'client'), maxAgeObj));
}

if (process.env.SENTRY_DSN) {
    studioApp.use(sentry.Handlers.errorHandler());
}

studioApp.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
        return next(err);
    }

    let msg: string;
    if (process.env.NODE_ENV === 'development') {
        msg = (err.stack || (err.message || err.toString()));
    }
    else {
        msg = 'An error occurred when serving your request: ' + (err.message || err.toString());
    }

    res.status(500).header('Content-Type', 'text/plain').send(msg);
});

const studioServer = new http.Server(studioApp);
studioServer.listen(Number(process.env.PORT) || 4820, process.env.HOST || '0.0.0.0', async () => {
    const port = process.env.PORT || 4820;
    log.info(`Web server listening on port ${port}!`);
});
studioServer.keepAliveTimeout = 0;
studioServer.headersTimeout = 0;
studioServer.timeout = 0;
