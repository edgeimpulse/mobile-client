import { ApiAuth, getAuth, getDeviceId, getStudioEndpoint,
    storeApiKeyAndImpulseId, storeDeviceId } from "./settings";
import { ISensor } from "./sensors/isensor";
import { Uploader } from "./uploader";
import { SampleDetails } from "./models";
import { ClassificationLoader } from "./classification-loader";
import { dataMessage } from "./messages";
import { Notify } from "./notify";
import { MicrophoneSensor } from "./sensors/microphone";
import { AccelerometerSensor } from "./sensors/accelerometer";
import { getErrorMsg } from "./utils";

export class TimeSeriesDataCollectionClientViews {
    private _views = {
        loading: document.querySelector('#loading-view') as HTMLElement,
        qrcode: document.querySelector('#qrcode-view') as HTMLElement,
        connectionFailed: document.querySelector('#remote-mgmt-failed') as HTMLElement,
        capture: document.querySelector('#capture-camera') as HTMLElement,
        permission: document.querySelector('#permission-view') as HTMLElement
    };

    private _elements = {
        deviceId: document.querySelector('#connected-device-id') as HTMLElement,
        connectionFailedMessage: document.querySelector('#connection-failed-message') as HTMLElement,
        grantPermission: document.querySelector('#grant-permissions-button') as HTMLElement,
        loadingText: document.querySelector('#loading-view-text') as HTMLElement,
        recordButton: document.querySelector('#time-series-capture-button') as HTMLElement,
        labelLink: document.querySelector('#time-series-label-link') as HTMLAnchorElement,
        labelText: document.querySelector('#time-series-label-text') as HTMLElement,
        lengthLink: document.querySelector('#time-series-length-link') as HTMLAnchorElement,
        lengthText: document.querySelector('#time-series-length-text') as HTMLElement,
        categoryLink: document.querySelector('#time-series-category-link') as HTMLAnchorElement,
        categoryText: document.querySelector('#time-series-category-text') as HTMLElement,
        categorySelect: document.querySelector('#time-series-category-select') as HTMLSelectElement,
        capturedCount: document.querySelector('#time-series-capture-count') as HTMLElement,
        samplingCircle: document.querySelector('#sampling-circle') as HTMLElement,
        progressCircle: document.querySelector('#sampling-circle .sampling-circle') as HTMLElement,
        samplingTimeLeft: document.querySelector('#sampling-time-left') as HTMLElement,
    };

    private _sensors: ISensor[] = [];
    private _numCaptures: number = 0;
    private _uploader: Uploader | undefined;
    private _hmacKey: string = '0';
    private _activeSensor: 'microphone' | 'accelerometer' | undefined;
    private _auth: ApiAuth | undefined;

    async init(sensorType: 'microphone' | 'accelerometer') {
        console.log('init time-series-collection-views');
        storeDeviceId(getDeviceId());

        let sensorIcon: string;
        let activeSensor: ISensor;
        this._activeSensor = sensorType;

        let targetFrequency = 100;

        if (sensorType === 'microphone') {
            const microphone = new MicrophoneSensor();
            if (!await microphone.hasSensor()) {
                this._elements.connectionFailedMessage.textContent = 'No microphone detected';
                this.switchView(this._views.connectionFailed);
                return;
            }
            this._sensors.push(microphone);
            sensorIcon = 'fa-microphone';
            activeSensor = microphone;
            targetFrequency = 16000;
        }
        else if (sensorType === 'accelerometer') {
            const accelerometer = new AccelerometerSensor();
            if (!await accelerometer.hasSensor()) {
                this._elements.connectionFailedMessage.textContent = 'No accelerometer detected';
                this.switchView(this._views.connectionFailed);
                return;
            }
            this._sensors.push(accelerometer);
            sensorIcon = 'fa-wave-sine';
            activeSensor = accelerometer;
            targetFrequency = 62.5;
        }

        console.log('targetFrequency', targetFrequency);

        this._elements.categoryText.style.display = 'none';
        this._elements.categoryText.parentNode?.insertBefore(this._elements.categorySelect,
            this._elements.categoryText);

        const auth = this._auth = getAuth();

        // data collection can only be done with apiKey
        if (auth && auth.auth === 'apiKey') {
            storeApiKeyAndImpulseId(auth.apiKey, auth.impulseId);

            const searchParams = new URLSearchParams(window.location.search);
            searchParams.delete('apiKey');
            searchParams.delete('studio');
            searchParams.delete('env');
            window.history.replaceState(null, '', window.location.pathname +
                (searchParams.toString().length > 0) ? `?${searchParams.toString()}` : ``);

            try {
                this.switchView(this._views.loading);

                let devKeys = await this.getDevelopmentApiKeys(auth);
                if (devKeys.hmacKey) {
                    this._hmacKey = devKeys.hmacKey;
                }

                const lengthStr = searchParams.get('sampleLength') ??
                    localStorage.getItem(`last-${this._activeSensor}-length`) ??
                    '1';

                const onStartState = {
                    label: searchParams.get('label') ??
                        localStorage.getItem(`last-${this._activeSensor}-label`) ??
                        'unknown',
                    length: !isNaN(Number(lengthStr)) ?
                        Number(lengthStr) :
                        1,
                    category: searchParams.get('category') ??
                        localStorage.getItem(`last-${this._activeSensor}-category`) ??
                        'split'
                };
                if ([ 'training', 'testing', 'split' ].indexOf(onStartState.category) === -1) {
                    onStartState.category = 'split';
                }

                console.log('onStartState', onStartState);

                this._elements.labelText.dataset.label = onStartState.label;
                this._elements.labelText.textContent = onStartState.label === '' ?
                    'Unlabeled' :
                    onStartState.label;
                this._elements.lengthText.textContent = onStartState.length.toString();
                this._elements.categoryText.textContent = onStartState.category;
                this._elements.categorySelect.value = onStartState.category;

                localStorage.setItem(`last-${this._activeSensor}-label`, onStartState.label);
                localStorage.setItem(`last-${this._activeSensor}-length`, onStartState.length.toString());
                localStorage.setItem(`last-${this._activeSensor}-category`, onStartState.category);

                this._uploader = new Uploader(auth.apiKey);

                this._elements.grantPermission.textContent = `Give access to the ${sensorType}`;

                let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === sensorType);
                if (sensor && await sensor.checkPermissions(false)) {
                    console.log('sensor checkPermissions OK');
                    this.grantPermission();
                }
                else {
                    this.switchView(this._views.permission);
                    this._elements.grantPermission.onclick = ev => {
                        this.grantPermission();
                    };
                }
            }
            catch (ex) {
                console.error('Failed to load', ex);
                if (ex instanceof Error) {
                    this._elements.connectionFailedMessage.textContent = (ex.message || ex.toString());
                }

                this.switchView(this._views.connectionFailed);
            }
        }
        else {
            this.switchView(this._views.qrcode);
        }

        this._elements.recordButton.onclick = async (ev) => {
            ev.preventDefault();

            if (!this._uploader) return;

            let origHtml = this._elements.recordButton.innerHTML;
            let samplingInterval: number | undefined;

            try {
                if (!this._auth || this._auth.auth !== 'apiKey') {
                    throw new Error('Not authenticated');
                }

                this._elements.recordButton.innerHTML = `<i class="fas ${sensorIcon} mr-2"></i>Waiting...`;
                this._elements.recordButton.classList.add('disabled');

                this._elements.progressCircle.classList.remove('no-spin');

                let length = Number(this._elements.lengthText.textContent) * 1000;
                let remaining = length;

                this._elements.samplingTimeLeft.textContent = '...';

                this._elements.samplingCircle.style.opacity = '1';

                await this.sleep(500); // give a bit of time for the user

                this._elements.samplingTimeLeft.textContent = Math.floor(remaining / 1000) + 's';

                samplingInterval = setInterval(() => {
                    remaining -= 1000;
                    if (remaining < 0) {
                        return clearInterval(samplingInterval);
                    }

                    this._elements.samplingTimeLeft.textContent = Math.floor(remaining / 1000) + 's';
                }, 1000);

                this._elements.recordButton.innerHTML = `<i class="fas ${sensorIcon} mr-2"></i>Recording...`;

                let sample = await activeSensor.takeSample({
                    frequency: targetFrequency,
                    length: length
                });

                clearInterval(samplingInterval);

                this._elements.samplingCircle.style.opacity = '0';

                this._elements.recordButton.innerHTML = `<i class="fas ${sensorIcon} mr-2"></i>Uploading...`;

                console.log('took sample');

                let category = this._elements.categoryText.textContent || 'training';
                if (this._elements.categoryText.textContent === 'split') {
                    if (this._numCaptures > 0) {
                        category = await this.getCategoryFromString(JSON.stringify(sample.values));
                    }
                    else {
                        category = 'training';
                    }
                }

                this._numCaptures = this._numCaptures + length;

                let details: SampleDetails = {
                    hmacKey: this._hmacKey,
                    interval: 0,
                    label: (this._elements.labelText.dataset.label || '') !== '' ?
                        this._elements.labelText.dataset.label :
                        undefined,
                    length: 0,
                    path: '/api/' + category + '/data',
                    sensor: activeSensor.getProperties().name
                };

                let data = dataMessage({
                    apiKey: this._auth.apiKey,
                    device: {
                        deviceId: getDeviceId(),
                        sensors: [ activeSensor ].map(s => {
                            let p = s.getProperties();
                            return {
                                name: p.name,
                                frequencies: p.frequencies,
                                maxSampleLength: p.maxSampleLength
                            };
                        }),
                        deviceType: 'MOBILE_CLIENT'
                    }
                }, sample);

                console.log('details', details, 'data', data, 'sample', sample);

                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                (async () => {
                    if (!this._uploader) return;
                    try {
                        let filename = await this._uploader.uploadSample(details, data, sample);
                        // eslint-disable-next-line
                        (<any>$).notifyClose();
                        Notify.notify('', 'Uploaded "' + filename + '" to ' + category + ' category', 'top', 'center',
                        'far fa-check-circle', 'success');
                    }
                    catch (ex) {
                        // eslint-disable-next-line
                        (<any>$).notifyClose();
                        Notify.notify('Failed to upload', getErrorMsg(ex), 'top', 'center',
                            'far fa-times-circle', 'danger');
                    }
                })();

                let minutes = Math.floor(this._numCaptures / 1000 / 60);
                let seconds = (this._numCaptures / 1000) % 60;
                if (minutes > 0) {
                    this._elements.capturedCount.textContent = `${minutes}m${seconds}s`;
                }
                else {
                    this._elements.capturedCount.textContent = `${seconds}s`;
                }
            }
            catch (ex) {
                alert('Failed to upload: ' + getErrorMsg(ex));
            }
            finally {
                this._elements.recordButton.innerHTML = origHtml;
                this._elements.recordButton.classList.remove('disabled');
                this._elements.progressCircle.classList.add('no-spin');
                this._elements.samplingCircle.style.opacity = '0';

                if (samplingInterval) {
                    clearInterval(samplingInterval);
                }
            }
        };

        this._elements.labelLink.onclick = async (ev) => {
            ev.preventDefault();
            const v = await Notify.prompt(
                'Enter a label',
                '',
                'Set label',
                this._elements.labelText.dataset.label ?? this._elements.labelText.textContent ?? '',
                'info',
                'info');
            if (v !== false) {
                if (v && this._elements.labelText.textContent !== v) {
                    this._numCaptures = 0;
                    this._elements.capturedCount.textContent = '0s';
                }

                this._elements.labelText.textContent = v ?
                    v :
                    'Unlabeled';
                this._elements.labelText.dataset.label = v;

                localStorage.setItem(`last-${this._activeSensor}-label`, v);
            }
        };

        this._elements.lengthLink.onclick = async (ev) => {
            ev.preventDefault();
            let v = await Notify.prompt('Set length in seconds', '', 'Set length',
                this._elements.lengthText.textContent || '', 'info', 'info');
            if (v && !isNaN(Number(v))) {
                if (v && this._elements.lengthText.textContent !== v) {
                    this._numCaptures = 0;
                    this._elements.capturedCount.textContent = '0s';
                }

                this._elements.lengthText.textContent = v.toLowerCase();

                localStorage.setItem(`last-${this._activeSensor}-length`, this._elements.lengthText.textContent);
            }
        };

        this._elements.categorySelect.oninput = () => {
            if (this._elements.categoryText.textContent !== this._elements.categorySelect.value) {
                this._numCaptures = 0;
                this._elements.capturedCount.textContent = '0s';
            }

            this._elements.categoryText.textContent = this._elements.categorySelect.value;

            localStorage.setItem(`last-${this._activeSensor}-category`, this._elements.categorySelect.value);
        };

        this._elements.categoryLink.onclick = ev => {
            ev.preventDefault();

            console.log('category link click', ev);

            let element = this._elements.categorySelect;

            let event;
            event = document.createEvent('MouseEvents');
            event.initMouseEvent('mousedown', true, true, window, 0, 0, 0, 0, 0,
                false, false, false, false, 0, null);
            element.dispatchEvent(event);

            // this._elements.categorySelect.focus();
        };
    }

    private switchView(view: HTMLElement) {
        for (const k of Object.keys(this._views)) {
            (<{ [k: string]: HTMLElement }>this._views)[k].style.display = 'none';
        }
        view.style.display = '';
    }

    private grantPermission() {
        if (!this._activeSensor) return;

        let sensor = this._sensors.find(s => s.getProperties().name.toLowerCase() === this._activeSensor);
        if (!sensor) {
            this._elements.connectionFailedMessage.textContent = `Could not find ${this._activeSensor}`;
            this.switchView(this._views.connectionFailed);
            return;
        }

        sensor.checkPermissions(true).then(result => {
            if (result) {
                this.switchView(this._views.capture);

                if (!this._elements.labelText.textContent) {
                    this._elements.labelLink.click();
                }
            }
            else {
                alert(`User has rejected ${this._activeSensor} permissions`);
            }
        }).catch(err => {
            console.error(err);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            this._elements.connectionFailedMessage.textContent = err;
            this.switchView(this._views.connectionFailed);
        });
    }

    private sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async getDevelopmentApiKeys(auth: ApiAuth) {
        const loader = new ClassificationLoader(getStudioEndpoint(), auth);

        let projectId = await loader.getProject();

        try {
            return await loader.getDevelopmentKeys(projectId.id);
        }
        catch (ex) {
            console.warn('Could not find development keys for project ' + projectId, ex);
            return {
                apiKey: undefined,
                hmacKey: undefined
            };
        }
    }

    private async getCategoryFromString(str: string) {
        let encoded = new TextEncoder().encode(str);
        let hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        let hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        while (hash.length > 0 && hash[0] === 'f') {
            hash = hash.substr(1);
        }
        if (hash.length === 0) {
            throw new Error('Failed to calculate SHA256 hash of buffer');
        }
        let firstHashChar = hash[0];

        if ([ '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b' ].indexOf(firstHashChar) > -1) {
            return 'training';
        }
        else {
            return 'testing';
        }
    }
}
