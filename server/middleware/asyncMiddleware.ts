import express from 'express';

export function asyncMiddleware(fn: express.RequestParamHandler) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
            Promise.resolve(fn(req, res, next, undefined, '')).catch(next);
    };
}
