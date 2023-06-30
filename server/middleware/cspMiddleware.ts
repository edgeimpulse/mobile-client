import express from 'express';
import { asyncMiddleware } from './asyncMiddleware';
import crypto from 'crypto';

export type NonceRequest = express.Request & { nonce: string };

export class CSPMiddleware {
    private _userCdnPrefix: string;

    constructor(userCdnPrefix: string) {
        this._userCdnPrefix = userCdnPrefix;
    }

    getMiddleware() {
        return asyncMiddleware(async (_req: express.Request, res: express.Response, next: express.NextFunction) => {
            let req = _req as NonceRequest;

            req.nonce = crypto.randomBytes(16).toString('base64');
            res.set('Content-Security-Policy',
                CSPMiddleware.generateCSP(req, _req.path === '/classifier.html', this._userCdnPrefix));
            res.set('X-Frame-Options', 'DENY');
            res.set('X-XSS-Protection', '1; mode=block');
            res.set('Referrer-Policy', 'strict-origin');
            if (process.env.K8S_ENVIRONMENT === "staging" || process.env.K8S_ENVIRONMENT === "prod") {
                res.set('Strict-Transport-Security', 'max-age=63072000');
            }

            next();
        });
    }

    static generateCSP(
        _req: express.Request,
        unsafeEval = true,
        userCdnPrefix: string
    ) {
        let req = _req as NonceRequest;

        let csp = `default-src 'self' blob: edgeimpulse.com *.edgeimpulse.com; `;
        let wsProtocols;
        if (process.env.K8S_ENVIRONMENT === "prod") {
            wsProtocols = "wss://studio.edgeimpulse.com wss://remote-mgmt.edgeimpulse.com";
        } else if (process.env.K8S_ENVIRONMENT === "staging") {
            wsProtocols = "wss://studio.acc2.edgeimpulse.com wss://remote-mgmt.acc2.edgeimpulse.com";
        } else {
            wsProtocols = "wss: ws:";
        }

        csp += `img-src 'self' 'unsafe-inline' edgeimpulse.com *.edgeimpulse.com www.google-analytics.com www.googletagmanager.com data: ${userCdnPrefix}; `;
        csp += "media-src 'self' edgeimpulse.com *.edgeimpulse.com blob: data: mediastream:; ";
        csp += `script-src 'self' ${unsafeEval ? "'unsafe-eval' " : ""} 'nonce-${req.nonce}' edgeimpulse.com *.edgeimpulse.com *.hsforms.net *.hsforms.com www.google-analytics.com fonts.googleapis.com youtube.com *.youtube.com browser.sentry-cdn.com js.sentry-cdn.com *.sentry.io www.googletagmanager.com d3js.org blob:; `;
        csp += `connect-src 'self' edgeimpulse.com *.edgeimpulse.com www.google-analytics.com *.hsforms.net *.hsforms.com *.amazonaws.com *.googleapis.com fonts.googleapis.com sentry.io *.sentry.io youtube.com *.youtube.com *.doubleclick.net localhost:4800 localhost:4810 localhost:4820 host.docker.internal:4800 host.docker.internal:4810 host.docker.internal:4820 data: ${wsProtocols}; `;
        csp += "style-src 'self' 'unsafe-inline' edgeimpulse.com *.edgeimpulse.com fonts.googleapis.com; ";
        csp += "base-uri 'self' edgeimpulse.com *.edgeimpulse.com; ";
        csp += "frame-ancestors 'self' edgeimpulse.com *.edgeimpulse.com mltools.arduino.cc mltools.oniudra.cc skillbuilder.optra.com skillbuilder.optraportal.com; ";
        csp += "form-action 'self'; ";
        csp += "frame-src 'self' edgeimpulse.com *.edgeimpulse.com youtube.com *.youtube.com localhost:4820; ";
        csp += "font-src 'self' edgeimpulse.com *.edgeimpulse.com fonts.gstatic.com; ";
        csp += "report-uri https://o333795.ingest.sentry.io/api/1887001/security/?sentry_key=3ad6405147234fac8ab65061c25d2334; ";

        return csp;
    }
}
