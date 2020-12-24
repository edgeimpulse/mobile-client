import { getApiKey, getDeviceId, getFrequency, getKeyword, getSampleLength, getStudioEndpoint,
    storeApiKey, storeDeviceId, storeFrequency, storeKeyword, storeSampleLength } from "./settings";
import { ISensor } from "./sensors/isensor";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { MicrophoneSensor } from "./sensors/microphone";
import { CameraSensor } from "./sensors/camera";
import { ClassificationLoader } from "./classification-loader";
import { FindSegments } from "./find-segments";
import { Uploader } from "./uploader";
import { dataMessage } from "./messages";
import { Sample } from "./models";

export class DataCollectionKeywordClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connected: document.querySelector('#remote-mgmt-connected') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        sampling: document.querySelector('#sampling-in-progress') as HTMLElement,
        permission: document.querySelector('#permission-view') as HTMLElement,
        uploadSucceeded: document.querySelector('#upload-succeeded') as HTMLElement
    };

    private _elements = {
        projectName: document.querySelector('#connected-project-name') as HTMLElement,
        keyword: document.querySelector('#keyword-name') as HTMLElement,
        startSampling: document.querySelector('#start-sampling') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        samplingTimeLeft: document.querySelector('#sampling-time-left') as HTMLElement,
        samplingRecordingStatus: document.querySelector('#sampling-recording-data-message') as HTMLElement,
        samplingRecordingSensor: document.querySelector('#sampling-recording-sensor') as HTMLElement,
        grantPermissionsBtn: document.querySelector('#grant-permissions-button') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        uploadSucceededProjectName: document.querySelector('#upload-succeeded-project-name') as HTMLElement,
        uploadSucceededCount: document.querySelector('#upload-succeeded-count') as HTMLElement,
    };

    private _sensors: ISensor[] = [];
    private _findSegments = new FindSegments();

    async init() {
        storeDeviceId(getDeviceId());

        if (!getKeyword()) {
            this._elements.connectionFailedMessage.textContent = 'Missing ?keyword= parameter in URL';
            return this.switchView(this._views.connectionFailed);
        }

        if (!getSampleLength() || isNaN(getSampleLength())) {
            this._elements.connectionFailedMessage.textContent = 'Missing ?sampleLength= parameter in URL';
            return this.switchView(this._views.connectionFailed);
        }

        if (!getFrequency() || isNaN(getFrequency())) {
            this._elements.connectionFailedMessage.textContent = 'Missing ?frequency= parameter in URL';
            return this.switchView(this._views.connectionFailed);
        }

        storeKeyword(getKeyword());
        storeSampleLength(getSampleLength());
        storeFrequency(getFrequency());

        this._elements.keyword.textContent = getKeyword();

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

            let project = await this.getProject(getApiKey());
            this._elements.projectName.textContent = project.name;
            this.switchView(this._views.connected);

            storeApiKey(getApiKey());

            window.history.replaceState(null, '', window.location.pathname);

            this._elements.startSampling.onclick = async (ev) => {
                ev.preventDefault();

                let samplingInterval: number | undefined;

                try {
                    let sensor = await this.beforeSampling('Microphone');

                    const sampleLength = getSampleLength();
                    const segmentWindowLength = 1000;
                    const frequency = getFrequency();
                    const minSegments = 1;

                    let remaining = sampleLength;

                    this._elements.samplingRecordingStatus.textContent = 'Recording data';
                    this._elements.samplingTimeLeft.textContent = Math.floor(remaining / 1000) + 's';

                    samplingInterval = setInterval(() => {
                        remaining -= 1000;
                        if (remaining < 0) {
                            return clearInterval(samplingInterval);
                        }

                        this._elements.samplingTimeLeft.textContent = Math.floor(remaining / 1000) + 's';
                    }, 1000);

                    const sampleData = await sensor.takeSample({
                        length: sampleLength,
                        frequency: frequency,
                        processing: () => { /* noop */ }
                    });

                    console.log('done recording', sampleData);

                    clearInterval(samplingInterval);

                    this.switchView(this._views.loading);
                    this._elements.loadingText.textContent = 'Finding keywords...';

                    let segments = this._findSegments.findSegments(<number[]>sampleData.values,
                        (segmentWindowLength / 1000) * frequency,
                        frequency, false);

                    if (segments.length < minSegments) {
                        throw new Error('Expected to find at least ' + minSegments + ' keywords, but only found ' +
                            segments.length);
                    }

                    this._elements.loadingText.textContent = 'Uploading ' + segments.length + ' keywords... (0%)';

                    let uploader = new Uploader(getApiKey());

                    console.log('segments', segments);

                    let done = 0;

                    for (let s of segments) {
                        let sample: Sample = {
                            intervalMs: sampleData.intervalMs,
                            sensors: sampleData.sensors,
                            values: sampleData.values.slice(s.start, s.end),
                        };

                        let data = dataMessage({
                            apiKey: getApiKey(),
                            device: {
                                deviceId: getDeviceId(),
                                sensors: [ camera ].map(x => {
                                    let p = x.getProperties();
                                    return {
                                        name: p.name,
                                        frequencies: p.frequencies,
                                        maxSampleLength: p.maxSampleLength
                                    }
                                }),
                                deviceType: 'MOBILE_CLIENT'
                            }
                        }, sample);

                        await uploader.uploadSample({
                            sensor: sensor.getProperties().name,
                            hmacKey: '0',
                            interval: sample.intervalMs,
                            label: getKeyword(),
                            length: sample.values.length,
                            path: '/api/' + (await this.getCategoryFromValueArray(<number[]>sample.values)) + '/data',
                        }, data, sample);

                        done++;

                        let pct = Math.round(done / segments.length * 100);
                        this._elements.loadingText.textContent = `Uploading ${segments.length} keywords... (${pct}%)`;
                    }

                    this._elements.uploadSucceededCount.textContent = done.toString();
                    this._elements.uploadSucceededProjectName.textContent = project.name;
                    this.switchView(this._views.uploadSucceeded);
                }
                catch (ex) {
                    alert('Failed to record data: ' + ex);
                    this.switchView(this._views.connected);
                }
                finally {
                    clearInterval(samplingInterval);
                }
            };
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

        if (await sensor.checkPermissions(true)) {
            if (sensorName !== 'Camera') {
                this.switchView(this._views.sampling);
                this._elements.samplingRecordingStatus.textContent = 'Starting in 2 seconds';
                this._elements.samplingTimeLeft.textContent = 'Waiting...';
                await this.sleep(2000);
            }
            else {
                throw new Error('Sensor not supported: ' + sensorName);
            }
            return sensor;
        }
        else {
            this.switchView(this._views.permission);
            this._elements.grantPermissionsBtn.textContent =
                'Give access to the ' + sensor.getProperties().name;

            return new Promise<ISensor>((resolve, reject) => {
                let permissionTimeout = setTimeout(() => {
                    reject('User did not grant permissions within one minute');
                }, 60 * 1000);

                this._elements.grantPermissionsBtn.onclick = () => {
                    if (!sensor) return reject('Sensor is missing');

                    sensor.checkPermissions(true).then(async (result) => {
                        if (!sensor) {
                            return reject('Sensor is missing');
                        }
                        if (result) {
                            this.switchView(this._views.sampling);
                            this._elements.samplingRecordingStatus.textContent = 'Starting in 2 seconds';
                            this._elements.samplingTimeLeft.textContent = 'Waiting...';
                            await this.sleep(2000);
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

    private async getProject(apiKey: string) {
        let l = new ClassificationLoader(getStudioEndpoint(), apiKey);

        let project = await l.getProject();

        return project;
    }

    private async getCategoryFromValueArray(values: number[]) {
        let arr = new Float32Array(values);

        let hashBuffer = await crypto.subtle.digest('SHA-256', arr);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        let hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        while (hash.length > 0 && hash[0] === 'f') {
            hash = hash.substr(1);
        }
        if (hash.length === 0) {
            throw new Error('Failed to calculate SHA256 hash of buffer');
        }
        let firstHashChar = hash[0];

        if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b' ].indexOf(firstHashChar) > -1) {
            return 'training';
        }
        else {
            return 'testing';
        }
    }
}