import { ISensor, ISamplingOptions } from './isensor';
import { Sample } from '../models';

type Angle = number;
type PositionalSample = {
    x: number;
    y: number;
    z: number;
    rx: Angle;
    ry: Angle;
    rz: Angle;
    yaw: Angle;
    pitch: Angle;
    roll: Angle;
};

export class Positional9DOFSensor implements ISensor {
    private _permissionGranted = false;

    constructor() {
        /* noop */
    }

    /**
     * This function is flawed, even if DeviceMotionEvent exists, it's not
     * guaranteed that the device has a gyroscope. The only way to know is
     * by checking the motion event itself. The problem with that is that it
     * potentially requires permissions to check, getting into a catch-22. The
     * proper way to check for gyroscope is something along these lines:
     *
     * return new Promise<boolean>(async (resolve) => {
     *     const checkForGyro = (ev: DeviceMotionEvent) => {
     *         window.removeEventListener('devicemotion', checkForGyro);
     *         const gyroIsAvailable =
     *             ev.rotationRate && (ev.rotationRate.alpha || ev.rotationRate.beta || ev.rotationRate.gamma);
     *         resolve(!!gyroIsAvailable);
     *     };
     *
     *     if (typeof DeviceMotionEvent === 'undefined') {
     *         return resolve(false);
     *     }
     *     window.addEventListener('devicemotion', checkForGyro);
     *  });
     * @returns boolean
     */
    async hasSensor() {
        return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceOrientationEvent !== 'undefined';
    }

    async checkPermissions(fromClick: boolean): Promise<boolean> {
        if (!this.hasSensor()) {
            throw new Error('9DOF not present on this device');
        }

        if (typeof DeviceMotionEvent.requestPermission !== 'function') {
            return true;
        }

        if (this._permissionGranted) {
            return true;
        }

        try {
            const response = await DeviceMotionEvent.requestPermission();
            return response === 'granted';
        } catch (err) {
            let msg = typeof err === 'string' ? err : err.message || err.toString();
            if (msg.indexOf('requires a user gesture to prompt') > -1) {
                return false;
            } else {
                throw err;
            }
        }
    }

    getProperties() {
        return {
            name: 'Positional',
            maxSampleLength: 5 * 60,
            frequencies: [ 62.5 ]
        };
    }

    takeSample(samplingOptions: ISamplingOptions) {
        return new Promise<Sample>((resolve, _reject) => {
            if (!samplingOptions.frequency) {
                throw new Error('Frequency not specified');
            }
            if (!samplingOptions.length) {
                throw new Error('Time length not specified');
            }
            let frequency = samplingOptions.frequency;
            let length = samplingOptions.length;
            let currentMotionSample: PositionalSample = {
                x: 0,
                y: 0,
                z: 0,
                rx: 0,
                ry: 0,
                rz: 0,
                yaw: 0,
                pitch: 0,
                roll: 0
            };

            let sampleValues: number[][] = [];

            let iv: number | undefined;

            // check if we have any data in the first second...
            const checkSensorTimeout = window.setTimeout(() => {
                if (sampleValues.length === 0) {
                    clearInterval(iv);
                    return _reject(
                        'Was not able to capture any measurements from this device. ' +
                            'This is probably a permission issue on the mobile client.'
                    );
                }
            }, 1000);

            console.log('setting interval', 1000 / frequency, 'length', length);
            iv = setInterval(() => {
                sampleValues.push([
                    currentMotionSample.x,
                    currentMotionSample.y,
                    currentMotionSample.z,
                    currentMotionSample.rx,
                    currentMotionSample.ry,
                    currentMotionSample.rz,
                    currentMotionSample.yaw,
                    currentMotionSample.pitch,
                    currentMotionSample.roll
                ]);
            }, 1000 / frequency);

            setTimeout(() => {
                clearTimeout(checkSensorTimeout);
                clearInterval(iv);

                window.removeEventListener('devicemotion', newMotionEvent);
                console.log('done', sampleValues.length, 'samples');
                resolve({
                    values: sampleValues.slice(0, Math.floor(length / (1000 / frequency))),
                    intervalMs: 1000 / frequency,
                    sensors: [
                        {
                            name: 'accX',
                            units: 'm/s2'
                        },
                        {
                            name: 'accY',
                            units: 'm/s2'
                        },
                        {
                            name: 'accZ',
                            units: 'm/s2'
                        },
                        {
                            name: 'gyroX',
                            units: 'deg/s'
                        },
                        {
                            name: 'gyroY',
                            units: 'deg/s'
                        },
                        {
                            name: 'gyroZ',
                            units: 'deg/s'
                        },
                        {
                            name: 'yaw',
                            units: 'deg'
                        },
                        {
                            name: 'pitch',
                            units: 'deg'
                        },
                        {
                            name: 'roll',
                            units: 'deg'
                        }
                    ]
                });
            }, length + 200);

            const newMotionEvent = (ev: DeviceMotionEvent) => {
                currentMotionSample.x = ev.accelerationIncludingGravity?.x || 0;
                currentMotionSample.y = ev.accelerationIncludingGravity?.y || 0;
                currentMotionSample.z = ev.accelerationIncludingGravity?.z || 0;
                currentMotionSample.rx = ev.rotationRate?.beta || 0;
                currentMotionSample.ry = ev.rotationRate?.gamma || 0;
                currentMotionSample.rz = ev.rotationRate?.alpha || 0;
            };

            const newOrientationEvent = (ev: DeviceOrientationEvent) => {
                currentMotionSample.yaw = ev.alpha || 0; // Z axis
                currentMotionSample.pitch = ev.beta || 0; // X axis
                currentMotionSample.roll = ev.gamma || 0; // Y axis
            };

            window.addEventListener('devicemotion', newMotionEvent);
            window.addEventListener('deviceorientation', newOrientationEvent);
        });
    }
}
