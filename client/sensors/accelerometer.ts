import { ISensor, ISamplingOptions } from "./isensor";
import { Sample } from "../models";

export class AccelerometerSensor implements ISensor {
    private _permissionGranted = false;

    constructor() {
        /* noop */
    }

    async hasSensor() {
        return typeof DeviceMotionEvent !== 'undefined';
    }

    checkPermissions(fromClick: boolean): Promise<boolean> {
        if (!this.hasSensor()) {
            throw new Error('Accelerometer not present on this device');
        }

        if (typeof (DeviceMotionEvent as any).requestPermission !== 'function') {
            return Promise.resolve(true);
        }

        if (this._permissionGranted) {
            return Promise.resolve(true);
        }

        return (DeviceMotionEvent as any).requestPermission().then((response: string) => {
            return response === 'granted';
        }).catch((err: Error | string) => {
            let msg = typeof err === 'string' ? err : (err.message || err.toString());
            if (msg.indexOf('requires a user gesture to prompt') > -1) {
                return Promise.resolve(false);
            }
            else {
                throw err;
            }
        });
    }

    getProperties() {
        return {
            name: 'Accelerometer',
            maxSampleLength: 5 * 60,
            frequencies: [ 62.5 ]
        };
    }

    takeSample(samplingOptions: ISamplingOptions) {
        return new Promise<Sample>((resolve, _reject) => {
            if (!samplingOptions.frequency) {
                throw new Error('Frequency not specified')
            }
            if (!samplingOptions.length) {
                throw new Error('Frequency not specified')
            }
            let frequency = samplingOptions.frequency;
            let length = samplingOptions.length;
            let currentSample: { x: number, y: number, z: number } | undefined;
            let sampleValues: number[][] = [];

            let firstEvent = true;
            let iv: number | undefined;

            // check if we have any data in the first second...
            const checkSensorTimeout = window.setTimeout(() => {
                if (sampleValues.length === 0) {
                    clearInterval(iv);
                    return _reject('Was not able to capture any measurements from this device. ' +
                        'This is probably a permission issue on the mobile client.');
                }
            }, 1000);

            const newSensorEvent = (event: DeviceMotionEvent) => {
                if (event.accelerationIncludingGravity) {
                    if (firstEvent) {
                        firstEvent = false;

                        console.log('setting interval', 1000 / frequency, 'length', length);
                        iv = setInterval(() => {
                            if (currentSample) {
                                sampleValues.push([
                                    currentSample.x,
                                    currentSample.y,
                                    currentSample.z
                                ]);
                            }
                        }, 1000 / frequency);

                        setTimeout(() => {
                            clearTimeout(checkSensorTimeout);
                            clearInterval(iv);

                            window.removeEventListener('devicemotion', newSensorEvent);
                            console.log('done', sampleValues.length, 'samples');
                            resolve({
                                values: sampleValues.slice(0, Math.floor(length / (1000 / frequency))),
                                intervalMs: 1000 / frequency,
                                sensors: [{
                                        name: "accX",
                                        units: "m/s2"
                                    },
                                    {
                                        name: "accY",
                                        units: "m/s2"
                                    },
                                    {
                                        name: "accZ",
                                        units: "m/s2"
                                    }
                                ],
                            });
                        }, length + 200);
                    }

                    currentSample = {
                        x: event.accelerationIncludingGravity.x || 0,
                        y: event.accelerationIncludingGravity.y || 0,
                        z: event.accelerationIncludingGravity.z || 0
                    };
                }
            };

            window.addEventListener('devicemotion', newSensorEvent);
        });
    };
}
