/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/*
 * Copyright (c) 2014, Yahoo Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

'use strict';

exports.assign    = Object.assign;
exports.passError = passError;
exports.passValue = passValue;

// -----------------------------------------------------------------------------

function passError(callback: (arg: any) => void) {
    return (reason: any) => {
        setImmediate(() => {
            callback(reason);
        });
    };
}

function passValue(callback: (arg: null, v: any) => void) {
    return (value: any) => {
        setImmediate(() => {
            callback(null, value);
        });
    };
}
