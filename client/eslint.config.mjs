// @ts-nocheck
import eiConfig from '../../eslint.ei.config.mjs';
export default [
    ...eiConfig,
    {
        ignores: ['typed-event-emitter.ts', './build/*', '**/*.js']
    }
];
