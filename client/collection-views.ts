import { getApiKey, getDeviceId, storeApiKey, storeDeviceId } from "./settings";
import { RemoteManagementConnection } from "./remote-mgmt";
import { ISensor } from "./sensors/isensor";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { MicrophoneSensor } from "./sensors/microphone";
import { CameraSensor } from "./sensors/camera";

export class DataCollectionClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connected: document.querySelector('#remote-mgmt-connected') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        sampling: document.querySelector('#sampling-in-progress') as HTMLElement,
        permission: document.querySelector('#permission-view') as HTMLElement,
        capture: document.querySelector('#capture-camera') as HTMLElement
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        samplingTimeLeft: document.querySelector('#sampling-time-left') as HTMLElement,
        samplingRecordingStatus: document.querySelector('#sampling-recording-data-message') as HTMLElement,
        samplingRecordingSensor: document.querySelector('#sampling-recording-sensor') as HTMLElement,
        grantPermissionsBtn: document.querySelector('#grant-permissions-button') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
    };

    private _sensors: ISensor[] = [];

    async init() {
        storeDeviceId(getDeviceId());

        const accelerometer = new AccelerometerSensor();
        if (await accelerometer.hasSensor()) {
            console.log('has accelerometer');
            this._sensors.push(accelerometer);
        }

        const microphone = new MicrophoneSensor();
        if (await microphone.hasSensor()) {
            console.log('has microphone');
            this._sensors.push(microphone);
        }

        const camera = new CameraSensor();
        if (await camera.hasSensor()) {
            console.log('has camera');
            this._sensors.push(camera);
        }

        if (getApiKey()) {
            this.switchView(this._views.loading);
            this._elements.loadingText.textContent = 'Connecting to Edge Impulse...';

            const connection = new RemoteManagementConnection({
                apiKey: getApiKey(),
                device: {
                    deviceId: getDeviceId(),
                    sensors: this._sensors.map(s => {
                        let p = s.getProperties();
                        return {
                            name: p.name,
                            frequencies: p.frequencies,
                            maxSampleLength: p.maxSampleLength
                        }
                    }),
                    deviceType: 'MOBILE_CLIENT'
                }
            }, this.beforeSampling.bind(this));

            connection.on('connected', () => {
                // persist keys now...
                storeApiKey(getApiKey());
                window.history.replaceState(null, '', window.location.pathname);

                this._elements.deviceId.textContent = getDeviceId();
                this.switchView(this._views.connected);
            });
            connection.on('error', err => {
                console.error('Connection failed', err);
                this._elements.connectionFailedMessage.textContent = err;
                this.switchView(this._views.connectionFailed);
            });

            let samplingInterval: number | undefined;

            connection.on('samplingStarted', length => {
                let remaining = length;

                this._elements.samplingRecordingStatus.textContent = 'Recording data';
                this._elements.samplingTimeLeft.textContent = Math.floor(remaining / 1000) + 's';

                samplingInterval = setInterval(() => {
                    remaining -= 1000;
                    if (remaining < 0) {
                        return clearInterval(samplingInterval);
                    }

                    this._elements.samplingTimeLeft.textContent = Math.floor(remaining / 1000) + 's';
                }, 1000);
            });
            connection.on('samplingUploading', () => {
                clearInterval(samplingInterval);

                this.switchView(this._views.loading);
                this._elements.loadingText.textContent = 'Uploading...';
            });
            connection.on('samplingProcessing', () => {
                clearInterval(samplingInterval);

                this.switchView(this._views.loading);
                this._elements.loadingText.textContent = 'Processing...';
            });
            connection.on('samplingFinished', () => {
                this.switchView(this._views.connected);
            });
            connection.on('samplingError', error => {
                alert(error);
            });
        }
        else {
            this.switchView(this._views.qrcode);
        }
    }

    private switchView(view: HTMLElement) {
        for (const k of Object.keys(this._views)) {
            (<{ [k: string]: HTMLElement }>this._views)[k].style.display = 'none';
        }
        view.style.display = '';
    }

    private async beforeSampling(sensorName: string): Promise<ISensor> {
        let sensor = this._sensors.find(s => s.getProperties().name === sensorName);

        if (!sensor) {
            throw new Error('Cannot find sensor with name "' + sensorName + '"');
        }

        this._elements.samplingRecordingSensor.textContent = sensor.getProperties().name.toLowerCase();

        if (sensorName !== 'Camera') {
            this._views.sampling.style.display = 'initial';
        } else {
            this._views.sampling.style.display = 'none';
        }

        if (await sensor.checkPermissions(false)) {
            if (sensorName !== 'Camera') {
                this.switchView(this._views.sampling);
                this._elements.samplingRecordingStatus.textContent = 'Starting in 2 seconds';
                this._elements.samplingTimeLeft.textContent = 'Waiting...';
                await this.sleep(2000);
            } else {
                this.switchView(this._views.capture);
            }
            return sensor;
        }
        else {
            this.switchView(this._views.permission);
            this._elements.grantPermissionsBtn.textContent =
                'Give access to the ' + sensor.getProperties().name;

            return new Promise((resolve, reject) => {
                let permissionTimeout = setTimeout(() => {
                    reject('User did not grant permissions within one minute');
                }, 60 * 1000);

                this._elements.grantPermissionsBtn.onclick = () => {
                    if (!sensor) return reject('Sensor is missing');

                    sensor.checkPermissions(true).then(async (result) => {
                        if (result) {
                            if (sensorName !== 'Camera') {
                                this.switchView(this._views.sampling);
                                this._elements.samplingRecordingStatus.textContent = 'Starting in 2 seconds';
                                this._elements.samplingTimeLeft.textContent = 'Waiting...';
                                await this.sleep(2000);
                            } else {
                                this.switchView(this._views.capture);
                            }
                            resolve(sensor);
                        }
                        else {
                            reject('User has rejected accelerometer permissions')
                        }
                    }).catch(reject);

                    clearInterval(permissionTimeout);
                }
            });
        }
    }

    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}