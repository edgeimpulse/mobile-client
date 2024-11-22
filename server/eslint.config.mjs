// @ts-nocheck
import eiConfig from '../../eslint.ei.noconsole.config.mjs';
export default [
    ...eiConfig,
    {
        ignores: ['./build/*', '**/*.js']
    }
];
