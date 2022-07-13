export const TRACING = ["test", "staging"].includes(process.env.K8S_ENVIRONMENT || "");
// tslint:disable: no-unsafe-any
import Tracer from 'signalfx-tracing';

import { Express } from "express";
import { logger } from './logger';
const tracer = TRACING ? Tracer.init({
    service: 'studio',
    tags: { environment: process.env.K8S_ENVIRONMENT }
}) : undefined;

function isTracingId(id: any) {
    return id && typeof id === 'string' && id.length === 16;
}

/**
 * Register the tracer on an Express app
 * Must be called after the cookieParser middleware
 * @param app
 */
export function useTracing(app: Express) {
    if (!TRACING) {
        return;
    }

    logger("tracer").debug("Tracing enabled");

    app.get('/tracing', (req, resp) => {
        if (isTracingId(req.query?.ctx)) {
            resp.cookie('ctx', req.query.ctx);
            resp.status(200).end();
            return;
        }
        resp.status(400).end();
    });

    app.use((req, res, next) => {
        // propagate ctx info in the request tracing scope
        // used while browsing
        if (isTracingId(req.cookies?.ctx)) {
            setCtx(req.cookies.ctx);
        }
        next();
    });
}

/**
 * Get ctx id
 * This id is propagated from web tests to identify all calls downstream (including jobs)
 */
export function getCtx() : string | undefined {
    if (!TRACING) {
        return;
    }

    const activeScope = tracer!.scope().active();
    if (activeScope) {
        return activeScope.getBaggageItem('ctx');
    }

    return;
}

/**
 * Set ctx id value in the current tracing scope
 * @param ctx
 */
export function setCtx(ctx: string | undefined) {
    if (!TRACING) {
        return;
    }

    const activeScope = tracer!.scope().active();
    if (activeScope && ctx) {
        return activeScope.setBaggageItem('ctx', ctx);
    }

    return;
}

/**
 * Bind the detached promise to the current active scope
 * This is needed to propagate the tracing scope and ctx id
 */
export function sameScope<T>(fn: () => Promise<T>) {
    if (!TRACING) {
        return fn;
    }

    const activeScope = tracer!.scope().active();
    if (activeScope) {
        return tracer!.scope().bind(fn);
    }

    return fn;

}

export default tracer;